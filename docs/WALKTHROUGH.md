# AutoPulse walkthrough: every step, and how we use it

AutoPulse turns engine sound, vibration and OBD-II telemetry into **signatures**, recognises faults with **four model families**, learns **each car's own normal**, and tells the driver **what to do**. The pipeline below runs end to end on one laptop. Each step lists what it does, how to run it, what it produces, and **how we use it**.

```mermaid
flowchart LR
    A[1 · Simulated engines<br/>Python generator] --> C
    B[2 · Real public data<br/>audio · CWRU · carOBD] --> C
    M[3 · MATLAB engine<br/>crankshaft physics] --> V
    C[4 · Signatures<br/>28 features + STFT] --> D[5 · Models<br/>SVM · Softmax · ANN · CNN]
    D --> E[6 · Real-data scores]
    C --> V[7 · MATLAB cross-checks]
    F[8 · Adaptive baseline<br/>+ safety rules] --> G[9 · Dashboard]
    D --> G
    E --> R[10 · Report PDF]
    V --> R
    G --> R
```

> All numbers below are from our latest runs (October 2026) and are read from `models/*.json`.

---

## 0 · Setup (once per laptop)

```bash
python -m venv .venv
.venv\Scripts\python -m pip install -r requirements.txt --extra-index-url https://download.pytorch.org/whl/cpu
```

**How we use it:** every teammate gets the same pinned package versions, so results reproduce.

---

## 1 · Simulated engines: `autopulse/generator.py`

**What it does:** builds 1-second engine-block vibration windows from crank kinematics. A 4-cylinder engine fires every 180°, and each event (combustion, knock, valve impact, bearing defect) excites the block's resonances. Seven conditions: healthy, misfire, knock, valve wear, bearing, belt squeal, imbalance. Ten different simulated cars, each with its own resonances and geometry.

**Run:** used automatically by `train.py`. To see the signatures: `.venv\Scripts\python scripts\checks\smoke_test.py`

**How we use it:** for every fault on demand, with perfect labels, and the long ageing and seasonal histories that no public dataset has. These feed model pre-training (step 5) and the adaptive-baseline study (step 8).

---

## 2 · Real public data: `scripts/download_data.py`

**What it does:** downloads four free, no-login datasets into `data/raw/` (about 550 MB, not committed to git).

| Dataset | What it is | How we use it |
|---|---|---|
| Engine audio (Hugging Face) | 321 real engine recordings, 48 kHz: healthy, misfire, tappet, belt | Main real test of the fault classifiers |
| CWRU bearings | Real vibration, normal + 3 bearing faults, 4 motor loads | Real test of the vibration signatures |
| carOBD | 129 real OBD-II trips (Toyota Etios, 1 Hz) | Real test of the adaptive baseline; realistic drive cycles |
| Engine condition table | 19.5k telemetry rows, good/faulty | Checked, then rejected as a benchmark (labels don't track sensors) |

**Run:** `.venv\Scripts\python -I scripts\download_data.py`

**How we use it:** every score we report as a result comes from these real recordings, never from the simulator. Login-gated sets (UFPB acoustic on IEEE DataPort) are deliberately left out.

---

## 3 · MATLAB engine simulation: `matlab/crank_sim.m`

**What it does:** a second, independent engine simulator in MATLAB. It solves the crankshaft's equation of motion, `J·dω/dt = Σ gas torque − load torque`, for a 4-cylinder engine (firing order 1-3-4-2), with misfires injected on any cylinder at full or half severity. It records crank speed the way a 60-2 tooth wheel would.

**Run:** in MATLAB, `cd matlab` then `crank_sim`, or from a terminal:

```bash
matlab -batch "cd matlab; crank_sim"
```

**Produces:** `matlab/out/crank_runs.csv`: 84 runs at 800–3,500 rpm, 10,798 firing events.

**How we use it:** it's the brief's "MATLAB engine simulation" data source, and it tests the misfire detector on physics it was never built from (step 7).

---

## 4 · Signature extraction: `autopulse/signatures.py`

**What it does:** turns each window into 28 numbers plus one image:

| Domain | Features | Reveals |
|---|---|---|
| Time | RMS, crest factor, kurtosis, skewness, zero-crossing rate | Impacts, overall level |
| Frequency (FFT) | 10 band energies, spectral centroid, flatness | Knock band, belt squeal, resonances |
| Engine orders | Amplitude at 0.5×, 1×, 1.5×, 2×, 3×, 4× crank speed | Misfire (0.5×), imbalance (1×), firing (2×) |
| Envelope (Hilbert) | Impact repetition rate and prominence | Bearings, valve tick |
| Knock band | Kurtosis of the 5.5–8 kHz band | Detonation |
| Crank speed | Irregularity, deepest dip | Misfire per cylinder |
| Time-frequency | 64 × 95 STFT spectrogram | CNN input |

For real audio there is no tachometer, so engine speed is **estimated from the sound itself**: the sound's envelope repeats at the firing frequency.

**How we use it:** these are the signatures the brief asks for. Every model and the adaptive baseline work on them, and they make every alert explainable ("energy rose in the knock band").

---

## 5 · Train the models: `train.py`

**What it does:** trains SVM, Softmax regression, ANN (MLP) and a CNN, the four families the brief names, on simulated engines. It tests on two engines held out of training.

**Run:** `.venv\Scripts\python train.py` (about 1 minute)

**Produces:** `models/*.joblib`, `models/cnn.pt`, `models/metrics.json`

**Result on held-out simulated engines:** SVM 98.3% · ANN 97.9% · Softmax 97.4% · CNN 74.0%

**How we use it:** these models power the dashboard's live verdicts. The simulator scores are upper bounds; step 6 gives the honest numbers.

---

## 6 · Real-data train/test: `evaluate_real.py`

**What it does:** retrains and tests every model on real recordings, with splits that can't leak:

| Real test | Split | Best result |
|---|---|---|
| Engine sound, 4 classes | 5 folds, grouped by recording | **SVM 90.3%** of windows, **91.0%** of whole recordings |
| Bearing vibration (CWRU), 4 classes | Train on 3 motor loads, test on the 4th | 100% (a known easy benchmark) |
| carOBD adaptive baseline | Learn / calibrate / test on separate trips | False alarms on **14%** of healthy trips vs 31% for a fixed baseline; **91%** of vacuum leaks and **80%** of weak-charging faults caught |
| Engine-condition table | Stratified 5 folds | 66% vs 63% for guessing; rejected |

Models trained **only** on the simulator reach macro F1 0.39 at best on real audio. That is the sim-to-real gap round 2 will close.

**Run:** `.venv\Scripts\python evaluate_real.py` (about 15 minutes; `audio`, `cwru`, `condition` or `obd` runs one part)

**Produces:** `models/real_metrics.json`

**How we use it:** these are the numbers we present as results, and the dashboard's Models tab and the report read them straight from this file.

---

## 7 · MATLAB cross-checks: `scripts/matlab_crosscheck.py`

**7a · Misfire detection on MATLAB's engine.** A detector trained only on our Python simulator is tested on the MATLAB crankshaft data. The misfiring cylinder is also named from crank physics alone (the cylinder whose power stroke adds the least speed).

```bash
.venv\Scripts\python scripts\matlab_crosscheck.py crank
```

**Result:** misfire detection **100%** (84/84 runs). Cylinder named correctly **100%** at 800, 1,500, 2,500 and 3,500 rpm.

**7b · Our signal processing, re-done in MATLAB.** 60 real engine-audio windows are exported, MATLAB recomputes 23 of the 28 features from first principles (no toolboxes), and Python compares them.

```bash
.venv\Scripts\python scripts\matlab_crosscheck.py export
matlab -batch "cd matlab; signature_check"
.venv\Scripts\python scripts\matlab_crosscheck.py dsp
```

**Result:** all 23 features agree to within **6 × 10⁻¹⁴** (floating-point noise); correlation 1.000000.

**How we use it:** independent proof, in industry-standard MATLAB, that our misfire signature follows real crank physics and that our DSP computes what it claims. Results land in `models/matlab_crosscheck.json`.

> **To unlock more MATLAB work**, install these from MATLAB → Home → Add-Ons (all included in our college licence): Simulink, Powertrain Blockset, AUTOSAR Blockset, Signal Processing Toolbox. Then we can run MathWorks' own misfire example and check the 5 filter-based features.

---

## 8 · Adaptive baseline and safety rules: `autopulse/baseline.py`, `autopulse/rules.py`

**What it does:**
- **Adaptive baseline:** learns normal **per car and per context** (cold start vs warm idle, load band). It learns slowly, only from healthy-looking data, and freezes while an anomaly is open. Slow ageing becomes a health % bar; sudden change becomes an alert.
- **Safety rules:** hard limits that never adapt (puncture, oil pressure, overheating, charging, belt, fuel leak, CO). Each comes with instructions: AC off and heater max, minutes of battery left, the nearest mechanic.

**Results:** over 8 simulated months, a fixed baseline raised alarms on 74 days before any fault existed; the adaptive one on 0, and it caught the real fault in 3 days. On real carOBD trips: see step 6.

**How we use it:** decides when the dashboard shows "normal ageing" and when it shows "something changed, here's what to do".

---

## 9 · Dashboard: `app.py`

```bash
.venv\Scripts\python -m streamlit run app.py
```

| Tab | Shows | How we use it |
|---|---|---|
| Startup Check | Key-on scan, Tesla-style car view, health score | Opening demo for judges |
| Live Drive | 1 Hz OBD telemetry with injected faults, alerts and guidance | Shows the hard-limit rules acting |
| Signature Lab | Time, FFT, STFT, envelope and order views; all four models' votes | Shows signature extraction, the brief's core |
| Adaptive Baseline | Static vs adaptive over 8 months | Shows "normal is personal" |
| Wear & Health | Phone-battery-style health % per component | Shows wear prediction |
| Models | Simulator, real-data and MATLAB results | Evidence |

Add `?view=signature&engine=knock` (or `view=drive&obd=coolant_leak&t=440`) to the URL to open one screen with a preset scenario.

---

## 10 · Report: `report/`

```bash
.venv\Scripts\python report\figures.py
.venv\Scripts\python report\capture.py      # needs the dashboard running
.venv\Scripts\python report\build.py --png all
```

**Produces:** `report/AutoPulse-Concept-Report.pdf`. Its numbers are read from `models/*.json`, never typed by hand.

**How we use it:** the round-1 submission.
