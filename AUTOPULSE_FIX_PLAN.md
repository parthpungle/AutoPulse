# AutoPulse: Fix Plan for the Final Round

This plan comes from a judge-style review of AutoPulse against the Honeywell problem statement *"Operation with multivariable data: Automobile engine data, signature extraction and pattern recognition"*. It lists what must change in the **codebase** before the final round, and gives a ready-to-paste prompt for each change for an AI coding agent such as Claude Code, Cursor or Copilot.

> **Scope:** Codebase only. Repository work (branches, releases, cleaning up the duplicate folders, README badges, PRs) is deliberately left out for now.

---

## How to use this file

1. Open the project in your coding agent.
2. Paste **Prompt 0 (context primer)** once at the start of every new agent session.
3. Work through the tasks **in order**. Each one is a separate prompt. Don't paste several at once: let the agent finish, run its checks and report back first.
4. After each task, tick its **acceptance criteria** yourself before moving on. Don't accept "done" without seeing the numbers or the screen.
5. Expect the scores to change after tasks 3, 7 and 8. If the new numbers are lower but honest, keep them. Judges reward that.

### Priority at a glance

| # | Task | Problem it fixes | Priority | Effort |
|---|---|---|---|---|
| 1 | Save and serve the real-audio models | The live demo never touches real data | **Must** | S |
| 2 | Classify an uploaded or recorded clip in the UI | No real engine anywhere in the demo | **Must** | M |
| 3 | "Unsure" output + healthy false-alarm reporting | 12.5% of healthy windows called misfire | **Must** | S |
| 4 | Lead with real numbers in the app | The 98% headline is close to circular | **Must** | S |
| 5 | Separate mic and accelerometer channels, plus OBD fusion and an ablation table | "Multivariable" is not modelled | **Must** | L |
| 6 | Robustness stress-test benchmark | Accuracy falls under noise and early faults | Should | S |
| 7 | Domain randomisation + sim-to-real transfer | Simulator scores 0.07–0.39 F1 on real audio | Should | M–L |
| 8 | Real wear and remaining-life prediction (bearing run-to-failure data) | Wear "prediction" is odometer arithmetic | **Must** | L |
| 9 | Tighter evaluation + a better CNN | Possible leakage across recordings; CNN worse than SVM | Should | M |
| 10 | OBD residual models for drift and timing faults | MAP drift 14% and timing retard 11% detection | Could | M |
| 11 | Failure-case demo scenarios | Show judges where the system breaks | Should | S |
| 12 | Tests and a single results report | Prove everything still runs | **Must** | S |

---

## Review findings in brief (so the agent knows *why*)

- **Closed-loop demo.** `vehicle/node.py` → `autopulse/livecar.py` creates signals with `autopulse/generator.py`. `backend/live.py::LiveHub.engine()` classifies them with `models/svm.joblib`, `softmax.joblib`, `ann.joblib` and `cnn.pt`, all trained by `train.py` on that same simulator. `evaluate_real.py` writes **metrics only**, so no real-data model is ever saved.
- **Simulator accuracy is close to circular.** The fault generator and the 28 features in `autopulse/signatures.py` were written together. Stress test of the SVM trained on cars 0–7 and tested on cars 8–9:
  - normal conditions: 97.6%
  - background noise ×5: 53%
  - noise ×20: 16%
  - early faults (severity 0.1–0.3): **40%**
  - RPM 4,500–6,000 (outside training range): 80%
- **Real audio** (HF `RashmiKarunarathne/MyDataSet`, 321 recordings): SVM 90.3% accuracy, but 121 of 965 healthy windows are predicted as misfire. The CNN scores 83% ± 7.6, worse than the SVM.
- **Simulator → real zero-shot:** macro F1 0.07–0.39.
- **Wear** (`autopulse/baseline.py::simulate_wear`):
  - oil life = `km % 10000`
  - brake pads = `km/40000`, tyres = `km/45000`
  - battery = a simulated linear trend fitted with a straight line
  - Brakes and tyres are also outside the engine scope.
- **No multivariable model.** The generator emits one channel, called "vibration/sound". Real audio, CWRU (a motor test rig, not an engine) and OBD are each evaluated on their own. Signals are combined only in the dashboard and `rules.py`.
- **OBD** (carOBD with injected faults): false alarms on 14% of healthy trips. Detection rates: vacuum leak 91%, weak charging 80%, MAP drift 14%, timing retard 11%.

---

## Prompt 0: Context primer (paste at the start of every session)

```text
You are working on AutoPulse, a hackathon project for the Honeywell problem statement
"Operation with multivariable data – Automobile engine data: signature extraction and pattern
recognition". Goal of the problem: read multiple sensor streams (engine sound via microphone,
accelerometer vibration, OBD-II/CAN telemetry such as RPM, coolant temperature, throttle, fuel
trims), extract time/frequency signatures (FFT, STFT), learn normal baselines, predict component
wear, identify faults in real time, and show it all in a dashboard using CNN / SVM / ANN /
Softmax regression.

Codebase facts:
- Stack: Python 3 (numpy, scipy, scikit-learn, PyTorch CPU, FastAPI, uvicorn), React + Vite
  frontend (three.js for 3D cars), Windows launcher run.bat. Use `.venv\Scripts\python`.
- The repo contains several near-duplicate copies of the app (root, split/, test/, and on the
  latest version polish/). WORK ONLY IN THE CANONICAL TREE: use `polish/` if it exists,
  otherwise `split/`. Do not edit, move, or delete the other copies. All paths below are
  relative to that canonical tree.
- Key files:
  autopulse/generator.py   synthetic engine vibration/sound (7 faults, 10 simulated cars)
  autopulse/signatures.py  features(x, fs, rpm, crank_speed) -> 28 features; stft_image(); spectrum();
                           envelope_spectrum(); order_amplitudes()
  autopulse/models.py      feature_models() (SVM, Softmax, ANN), make_cnn/train_cnn/cnn_proba
  autopulse/realdata.py    load_engine_audio(), load_cwru(), load_carobd(), estimate_rpm()
  autopulse/baseline.py    AdaptiveBaseline, simulate_life(), simulate_wear(), predict_days_to()
  autopulse/telemetry.py   1 Hz OBD simulator; autopulse/rules.py hard safety limits
  autopulse/livecar.py     simulated car used by vehicle/node.py (streams to dashboard)
  backend/app.py           FastAPI dashboard API; backend/live.py LiveHub.engine() runs the models
  train.py                 trains on the simulator -> models/*.joblib, cnn.pt, metrics.json
  evaluate_real.py         real-data evaluation -> models/real_metrics.json (saves NO models)
  scripts/download_data.py downloads public datasets into data/raw/
  frontend/src/pages/      Overview, HealthCheck, LiveDrive, Signatures, Insights, Evidence
- Real datasets: HF engine audio (4 classes: healthy, misfire, valve_tick, belt_squeal, grouped
  by recording), CWRU bearings, carOBD real trips.

Working rules:
1. Before changing anything, read the files you will touch and summarise your plan in <10 lines.
2. Keep changes minimal and local; do not rename existing public functions or API routes, and do
   not break run.bat, train.py, evaluate_real.py, or the existing pages.
3. Never present simulator numbers as real-data numbers. Every metric you add must state its data
   source ("real", "simulator", "real + injected fault") in the JSON and in the UI.
4. Never tune on the test split. Use grouped splits (by recording / by car / by trip / by bearing).
5. Fixed random seeds. Any new script must run end-to-end from a clean checkout after
   `scripts/download_data.py`.
6. If a dataset cannot be downloaded from this machine, stop and tell me the exact URL and the
   folder to put it in. Do not fabricate data.
7. Finish every task by: running the relevant script(s), pasting the key numbers, listing files
   changed, and stating anything you could not do.
```

---

## Task 1: Save and serve the real-audio models

**Objective:** Produce deployable models trained on **real** engine audio and an inference function the backend can call.

**Acceptance criteria**
- `train_real.py` (new) trains SVM, Softmax, ANN and CNN on **all** real-audio windows and saves them to `models/real_audio/`. Metrics are still taken from `evaluate_real.py`'s grouped cross-validation.
- `autopulse/real_audio.py` exposes `classify_clip(signal, fs) -> dict` with per-window probabilities, a clip verdict, the estimated RPM and the class list.
- A metadata JSON stores the classes, sample rate, window/hop settings, feature names and the date trained.
- Running `classify_clip` on a held-out recording returns the expected label (show three examples).

```text
Task 1 – Save and serve the real-audio models.

Problem: evaluate_real.py::eval_audio() cross-validates SVM/Softmax/ANN/CNN on real engine audio
(90.3% SVM, grouped by recording) but saves no models, so the dashboard only ever uses
simulator-trained models.

Do this:
1. Create `train_real.py` at the tree root. Reuse autopulse/realdata.load_engine_audio(),
   estimate_rpm(), signatures.features() and stft_image() exactly as eval_audio() does, so features
   match. Train feature_models() and the CNN (models.train_cnn) on ALL real audio windows
   (classes: healthy, misfire, valve_tick, belt_squeal). Save to models/real_audio/:
   svm.joblib, softmax.joblib, ann.joblib, cnn.pt, meta.json (classes, fs=24000, window_s=1.0,
   hop_s=0.5, feature names, n_recordings, n_windows, trained_at, source="real: HF
   RashmiKarunarathne/MyDataSet").
   Refactor shared windowing/feature code into a helper in autopulse/real_audio.py rather than
   duplicating it; keep eval_audio() results identical (re-run `evaluate_real.py audio` and confirm
   numbers match real_metrics.json within ±0.5 pp).
2. In autopulse/real_audio.py add:
   - load_real_models() (lru_cached)
   - windows_from_signal(x, fs) -> resample to 24 kHz (scipy.signal.resample_poly), mono, 1 s
     windows with 0.5 s hop, drop windows that are near-silent (RMS below a threshold you
     justify) and report how many were dropped
   - classify_clip(x, fs) -> {"classes", "per_window": [[p...]], "per_model": {name: mean probs},
     "ensemble": mean probs, "verdict": class, "confidence", "rpm_est", "n_windows",
     "n_dropped", "source": "real-audio models"}
3. Add a quick check script scripts/checks/check_real_audio.py that holds out 3 recordings
   (one per class where possible), retrains without them, and prints classify_clip() output.
4. Make run.bat train the real models if models/real_audio/meta.json is missing AND
   data/raw/engine_audio exists; otherwise skip quietly.
Report the numbers and files changed.
```

---

## Task 2: Classify an uploaded or recorded clip in the UI

**Objective:** At least one screen in the demo shows a **real engine** being diagnosed live, ideally recorded on a phone or laptop mic at the venue.

**Acceptance criteria**
- `POST /api/classify-audio` accepts a WAV, MP3 or WebM upload of up to 30 s and returns the `classify_clip` output plus the same signature plots the Signatures page already draws (waveform, spectrum, spectrogram, envelope, orders).
- The Signatures page has a **"Real clip"** mode with *Upload file* and *Record 10 s* buttons, shows the verdict, per-model votes and per-window timeline, and carries a clear "real-audio models" badge.
- The vehicle node can optionally **replay a real dataset recording** instead of simulated vibration, so the live link also carries real sound.
- Simulated mode still works unchanged.

```text
Task 2 – Real clip classification in the UI.

Depends on Task 1 (autopulse/real_audio.py::classify_clip).

Backend (backend/app.py):
1. Add `POST /api/classify-audio` (multipart UploadFile). Decode with soundfile; if that fails
   (webm/mp3 from the browser), decode in the browser instead (see frontend step) – do NOT add an
   ffmpeg system dependency. Limit to 30 s / 10 MB, return HTTP 413/415 with a clear message
   otherwise. Return classify_clip(...) plus a "sig" block built the same way as
   backend/live.py::LiveHub.engine() builds `sig` (time, spectrum, spectrogram, envelope, orders),
   computed on the most confident window. Factor that sig-building code into a shared function so
   live.py and the new endpoint use the same code path.
2. Add python-multipart and soundfile to requirements.txt if missing.

Frontend (frontend/src/pages/Signatures.jsx + api.js):
3. Add a mode switch: "Simulated fault" (existing) | "Real clip".
4. Real clip mode: "Upload audio" (accept .wav,.mp3,.webm,.ogg,.m4a) and "Record 10 s" (MediaRecorder
   via getUserMedia). In the browser, decode with AudioContext.decodeAudioData, downmix to mono,
   and POST a 16-bit PCM WAV you encode in JS (small helper, no new npm dependency). Show a
   recording countdown and level meter.
5. Render: verdict + confidence, per-model probability bars (reuse components/charts/Bars.jsx),
   a per-window strip (one coloured cell per 0.5 s window), and the existing signature charts fed
   from the response. Show a badge "Real-audio models · trained on 321 real recordings" from
   meta.json. If the verdict is "unsure" (Task 3), show that state explicitly.
6. Add 3 sample clips (one healthy, one misfire, one belt squeal) from data/raw/engine_audio that
   were held out in Task 1's check into frontend/public/samples/ (keep each < 500 KB; trim to 8 s)
   with "Try a sample" buttons, so the demo works without a mic.

Vehicle node (optional but preferred):
7. In autopulse/livecar.py add a `source` option: "sim" (default) or "replay". In replay mode,
   step() streams consecutive 1 s windows from a chosen real recording (looping) instead of
   synth_window(); OBD still comes from the telemetry simulator. Expose it in the vehicle control
   panel (vehicle.html / VehicleApp.jsx) as "Engine sound: Simulated | Real recording <picker>".
   In backend/live.py, when the frame says source="replay", use the real-audio models; label the
   UI "real recording" vs "simulated".

Test: start the app, upload each sample, record from the mic, and report the verdicts. Confirm the
old simulated flow still works. List files changed.
```

---

## Task 3: An "unsure" output and an honest healthy false-alarm rate

**Objective:** Stop calling healthy engines faulty. Measure and report the false alarms that matter.

**Acceptance criteria**
- The real-audio evaluation reports **healthy false-positive rate** (per window and per recording), per-class recall, and a confidence threshold chosen on validation folds only.
- `classify_clip` and `LiveHub.engine()` return `"unsure"` when confidence is below the threshold. The UI shows "Not sure: record again closer to the engine".
- A small table shows coverage vs accuracy (for example: at threshold t, 85% of clips get an answer and 96% of those answers are right).

```text
Task 3 – Abstain option and healthy false-alarm reporting.

1. In evaluate_real.py::cv_signature_models (or a new function used by eval_audio), add per fold:
   - healthy false-positive rate at window level and recording level
     (= healthy predicted as any fault / all healthy)
   - per-class recall and precision
   - a confidence threshold for the ensemble (mean of SVM/Softmax/ANN/CNN probabilities) chosen
     using an INNER grouped split of the training folds only, targeting healthy FPR <= 5% at
     recording level while maximising coverage.
   - selective-prediction curve: for thresholds 0.3..0.95 step 0.05 -> coverage, accuracy on
     answered, healthy FPR on answered.
   Save under real_metrics.json["audio"]["selective"] and ["healthy_fpr"]. Do not change the
   existing keys.
2. Store the chosen threshold in models/real_audio/meta.json (Task 1) and apply it in
   autopulse/real_audio.classify_clip: verdict="unsure" when max ensemble prob < threshold.
3. In backend/live.py::LiveHub.engine(), apply the same idea for simulator models: the existing
   `sure` logic uses 0.5; make it read a threshold from models/metrics.json or a constant, and
   surface "unsure" as its own status (not "Healthy").
4. Evidence page: add a coverage-vs-accuracy line chart and the healthy FPR before/after the
   threshold. Signatures real-clip mode: show the unsure state.
Report the new numbers (before vs after threshold) and files changed.
```

---

## Task 4: Lead with real numbers in the app

**Objective:** The app's headline numbers must be **real-data** numbers. Simulator scores are shown as an upper bound.

**Acceptance criteria**
- The Overview and Evidence pages show real-data results first: real-audio accuracy and healthy FPR, CWRU (labelled "motor test rig, known-easy benchmark"), carOBD false alarms and per-fault detection **including the weak ones** (MAP drift, timing retard), Simulink 11/11, and the MATLAB cross-check.
- Simulator scores sit in a collapsed "Simulator (upper bound)" section with a one-line caveat.
- Every number on screen has a source tag: *Real*, *Real + injected fault*, *Simulink*, or *Simulator*.

```text
Task 4 – Real numbers first in the UI.

Edit frontend/src/pages/Evidence.jsx and Overview.jsx (and backend/app.py::results() only if you
need extra fields). No new numbers are invented – everything comes from models/*.json.

1. Evidence page order:
   a) Real engine audio – accuracy, macro-F1, healthy FPR (Task 3), recording-level accuracy,
      confusion matrix (reuse charts/Heatmap.jsx). Source tag "Real".
   b) MathWorks Simulink misfire (11/11, 2 false alarms in 71) and MATLAB DSP cross-check.
      Source tag "Simulink/MATLAB".
   c) carOBD adaptive baseline: false-alarm trip rate adaptive vs static, AND the full
      per-fault detection table including map_sensor_drift and timing_retard. Source tag
      "Real trips + injected faults".
   d) CWRU – labelled "Bearing test rig (motor), known-easy benchmark".
   e) Collapsed section "Simulator results (upper bound)" with the 98% numbers, the zero-shot
      sim→real macro-F1, and one sentence: "Generator and features were designed together, so
      these numbers are optimistic."
   f) Robustness (Task 6) and fusion ablation (Task 5) panels if their JSON exists; hide otherwise.
2. Add a reusable <SourceTag kind="real|real_injected|simulink|simulator"/> in components/ui.jsx
   with distinct, colour-blind-safe styling plus text (never colour alone).
3. Overview page: any accuracy/health headline must cite its source tag; replace any simulator
   headline with the real-audio one.
Screenshot or describe the result; list files changed.
```

---

## Task 5: Model multiple variables together (the core of the brief)

**Objective:** Make "multivariable" real. Use **separate microphone and accelerometer channels** plus **OBD context** as model inputs, and show a comparison of each input's contribution.

**Acceptance criteria**
- The generator outputs `mic` and `accel` as separate signals with different physical transfer paths, plus synchronised OBD context (RPM, coolant, load or throttle, STFT/LTFT).
- `autopulse/fusion.py` (new) builds one feature vector per window: mic features + accel features + OBD context. Feature-level fusion and late (probability) fusion are both implemented.
- `train_fusion.py` produces `models/fusion_metrics.json` comparing: mic only, accel only, OBD only, mic+accel, mic+accel+OBD (feature fusion), and late fusion. The split is by car, and results are reported at **two noise levels and with early faults**, not only clean conditions.
- The live dashboard uses the fusion model in simulated mode and shows which inputs drove the decision.
- All of it is labelled **Simulator**. On real data, fusion is limited to audio + estimated RPM, and the docs must say so.

```text
Task 5 – Multivariable fusion (mic + accelerometer + OBD context).

Background: autopulse/generator.py::synth_window returns ONE signal described as
"vibration/sound". The problem statement explicitly asks for microphone AND accelerometer AND
OBD/CAN telemetry. Currently these are never combined in a model.

1. Generator (keep synth_window's existing return keys for backward compatibility; add new ones):
   - "accel": structure-borne path – current signal (block resonances), sensor near the block,
     strong low-order content (1x, 2x), bearing and imbalance most visible, fs 24 kHz.
   - "mic": air-borne path – apply a different transfer function (e.g., high-pass ~80 Hz,
     radiation emphasis 1–5 kHz, a short room/bay reverb via a decaying noise impulse response,
     distance attenuation) and ADD independent background noise (road/wind/fan, other engines).
     Belt squeal and valve tick should be relatively stronger on mic; imbalance weaker.
   - "obd": dict for this window: rpm, coolant_c, throttle_pct, load_pct, stft_pct, ltft_pct,
     map_kpa – consistent with the fault (e.g., misfire raises STFT variance and lowers rpm
     stability; vacuum-leak-like lean shift is NOT one of the 7 engine faults, so keep OBD effects
     physically plausible and modest). Document each effect in a comment with the reasoning.
   - Keep "signal" == accel so existing code keeps working.
2. autopulse/fusion.py:
   - fused_features(mic, accel, fs, obd, crank_speed) -> concat(features(mic) prefixed "mic_",
     features(accel) prefixed "acc_", obd context features: rpm, coolant, load, throttle,
     stft_std, ltft) with a FEATURE_NAMES list.
   - late_fusion(prob_dicts, weights) – weighted mean of per-modality probabilities with weights
     learned on validation folds (simple logistic-regression stacker is fine).
3. train_fusion.py: cars 0-7 train, 8-9 test (same as train.py). Configurations: mic, accel, obd,
   mic+accel, mic+accel+obd (feature fusion, SVM and ANN), late fusion. Evaluate on test cars at
   noise x1, x5, and severity 0.1-0.3. Save models/fusion/*.joblib and models/fusion_metrics.json
   with source="simulator" and a short "caveats" string.
4. Live path: autopulse/livecar.py streams mic, accel and obd; backend/live.py uses the fusion
   model when available (fall back to the old models otherwise) and returns "modality_contrib":
   per-modality probability for the predicted class, so the UI can show
   "Mic 0.62 · Accel 0.88 · OBD 0.40 → Misfire". Keep wire.py frame size reasonable (downsample
   or send one channel for plots; models run on the dashboard side, so send both but compress as
   wire.py already does for vibration).
5. UI: Signatures page – a Mic/Accel toggle for the plots; Evidence page – the ablation table.
6. Update the MATLAB cross-check only if feature code changed (it should not).
Report the ablation table and files changed. Be explicit that this is simulator evidence.
```

---

## Task 6: Robustness stress-test benchmark

**Objective:** Measure, and show, where the models break, instead of reporting only clean-condition accuracy.

**Acceptance criteria**
- `scripts/robustness.py` evaluates the simulator models (and fusion models if present) on held-out cars under: noise ×1/×2/×5/×10/×20, severity bands 0.1–0.3 / 0.3–0.6 / 0.6–1.0, RPM bands 750–2,000 / 2,000–4,000 / 4,000–6,000, cold start vs warm, and mic gain ±10 dB.
- Output is `models/robustness.json` plus a heatmap on the Evidence page.
- A baseline run reproduces approximately: noise ×5 ≈ 53%, early faults ≈ 40%, high RPM ≈ 80% (SVM, before Task 7).

```text
Task 6 – Robustness benchmark.

Create scripts/robustness.py:
- Train exactly as train.py does (or load models/*.joblib) – cars 0-7; evaluate on cars 8-9.
- Sweep one factor at a time, others at default: noise multiplier on CarProfile.noise
  {1,2,5,10,20}; severity bands {0.1-0.3, 0.3-0.6, 0.6-1.0}; rpm bands {750-2000, 2000-4000,
  4000-6000}; coolant {cold 10-45 °C, warm 80-95 °C}; gain {-10, 0, +10 dB}.
- 12 windows per class per car per condition, fixed seeds.
- For each model (SVM, Softmax, ANN, CNN if torch, fusion models if present): accuracy, macro-F1,
  misfire recall, healthy FPR.
- Save models/robustness.json with source="simulator", and print a compact table.
Expected baseline for SVM (sanity check): ~0.98 clean, ~0.5 at noise x5, ~0.4 at severity 0.1-0.3,
~0.8 at 4000-6000 rpm. If you get very different numbers, investigate before continuing.
Add an Evidence-page heatmap (models × conditions) via charts/Heatmap.jsx, shown only if the JSON
exists. Make the script runnable as `.venv\Scripts\python scripts\robustness.py [--quick]`.
```

---

## Task 7: Domain randomisation and sim-to-real transfer

**Objective:** Make the simulator *useful* on real data, and show the improvement with numbers.

**Acceptance criteria**
- The generator gains a `randomize=True` mode: wider ranges for RPM (600–6,500), noise, gain, resonances and severity (0.05–1.0), reverb, and background noise mixed from **real healthy recordings in the training folds only**.
- Re-running Task 6 shows clearly better noise and early-fault robustness.
- The sim-to-real experiment in `evaluate_real.py` reports, under the same grouped folds:
  - (a) real only (current)
  - (b) simulator only, zero-shot (current: 0.07–0.39 F1)
  - (c) randomised simulator, zero-shot
  - (d) CNN pretrained on the simulator, fine-tuned on real
  - (e) real + randomised simulator mixed
- The results are kept even if they are not better. Explain why.

```text
Task 7 – Domain randomisation and sim→real transfer.

1. autopulse/generator.py: add synth_window(..., randomize=False, bg_noise_bank=None). With
   randomize=True: rpm 600-6500, severity 0.05-1.0, CarProfile resonances ±20%, gain ±12 dB,
   random EQ tilt, short random reverb, SNR 0-30 dB using background clips from bg_noise_bank
   (list of real 1 s healthy windows) when provided, else coloured noise. Default behaviour must
   be byte-identical to today (check with a fixed seed).
2. In evaluate_real.py::eval_audio, add a "transfer" block. For each existing grouped fold:
   - build bg_noise_bank ONLY from healthy windows of the TRAINING recordings of that fold
   - (c) train feature models on randomised simulator data for the 4 real classes -> test on the
     fold's test recordings
   - (d) pretrain the CNN on randomised sim spectrograms, fine-tune on the fold's real training
     windows (lower LR, ~6 epochs), test
   - (e) train feature models on real-train + randomised sim
   Report accuracy, macro-F1 and healthy FPR for (a)-(e) in real_metrics.json["audio"]["transfer"].
3. Re-run scripts/robustness.py with models trained on randomize=True data and save as
   models/robustness_randomized.json for a before/after comparison.
4. Evidence page: a small "Closing the sim-to-real gap" table (a)-(e).
Report numbers honestly; if (c)-(e) do not beat (a), say so and give your best explanation.
Watch runtime – add a --quick flag that uses 2 folds.
```

---

## Task 8: Real wear and remaining-life prediction

**Objective:** Replace odometer arithmetic with **real degradation data** and a genuine remaining-life (RUL) estimate with uncertainty.

**Acceptance criteria**
- Public run-to-failure data is downloaded by `scripts/download_data.py`: preferably the **NASA IMS bearing dataset** (or FEMTO/PRONOSTIA).
- `autopulse/wear.py` (new) builds a health indicator from vibration signatures (RMS, kurtosis, envelope energy at the bearing defect frequency, spectral band energy), smooths it, detects the onset of degradation, and predicts remaining life with an uncertainty band. It is evaluated **leave-one-bearing-out**, with error measured as time-to-failure at 50%, 70% and 90% of life.
- The Insights wear panel shows the real bearing's health indicator, the predicted failure time with its band, and the actual failure time.
- Brakes, tyres and oil are either **removed** or shown in a separate block clearly labelled "Service reminders (distance-based, not predicted)". The battery curve is labelled *Simulated*.

```text
Task 8 – Real wear / RUL on run-to-failure data.

Problem: autopulse/baseline.py::simulate_wear() computes oil life = km % 10000, brakes/tyres from
km, and the battery "months left" by fitting a line to a line it simulated. That is not prediction.

1. Data: extend scripts/download_data.py with a "ims" job for the NASA IMS bearing run-to-failure
   dataset (NASA Prognostics Data Repository). If it cannot be downloaded automatically from this
   machine (it is a large zipped archive, sometimes behind a landing page), print the exact URL and
   the expected folder data/raw/ims/ and STOP so I can download it manually. If IMS is unusable,
   propose FEMTO/PRONOSTIA instead and wait for my OK. Use only test-set runs that end in a
   documented bearing failure.
2. autopulse/wear.py:
   - hi_features(snapshot, fs, shaft_hz, bpfo_ratio) -> RMS, kurtosis, crest, envelope energy at
     BPFO/BPFI ±2 Hz (reuse signatures.envelope_spectrum), band energies.
   - health_indicator(series) -> robust z-score vs the first 10% of life (the bearing's own
     baseline – same idea as AdaptiveBaseline), EWMA-smoothed.
   - onset detection (e.g., CUSUM or HI > k·σ for N consecutive snapshots).
   - rul_estimate(t, hi, threshold) after onset: fit an exponential degradation model
     hi = a + b·exp(c·t) with bootstrap (or a particle-filter if you prefer) to give median and
     10–90% band for time-to-threshold. Threshold is learned from the TRAINING bearings' HI at
     failure.
   - Evaluate leave-one-bearing-out: RUL error at 50/70/90% of life, % of predictions where true
     failure falls inside the band. Save models/wear_metrics.json with source="real (NASA IMS)".
3. backend/app.py::wear(): return the real-bearing HI curve, onset, predicted failure + band at a
   chosen "today" point, and actual failure. Keep the old simulated battery curve but tag it
   source="simulated". Remove brakes and tyres from the component list, or move them (with oil)
   into a "service_reminders" block with basis="distance since service", explicitly not predicted.
4. frontend Insights page: rewrite the wear panel – HI line with onset marker, a vertical "today"
   slider, the predicted failure window as a shaded band, actual failure as a dashed line; source
   tags on every block.
Report the RUL error table and files changed. Do not tune the threshold on the held-out bearing.
```

---

## Task 9: Tighter evaluation and a better CNN

**Objective:** Close possible leakage and explain or fix the CNN's weaker result.

**Acceptance criteria**
- The audio dataset is checked for **vehicle or engine identity** (file names, metadata, HF card). If identities exist, cross-validation is grouped by vehicle and both results are reported (by recording and by vehicle).
- Bootstrap 95% confidence intervals are added for accuracy, macro-F1 and healthy FPR.
- The CNN uses SpecAugment (time and frequency masking), class weighting, early stopping on an inner validation split, and the average of 3 seeds. Report whether it now matches the SVM. If not, the Evidence page says why (about 320 recordings is small for a CNN; the hand-crafted features carry domain knowledge).

```text
Task 9 – Evaluation rigour and CNN improvements.

1. Inspect data/raw/engine_audio filenames and the HF dataset card for RashmiKarunarathne/MyDataSet
   (use what download_data.py saved; do not invent metadata). Report: number of distinct
   vehicles/engines if identifiable, recordings per vehicle per class, durations, sample rates.
   If vehicle IDs can be derived, add a vehicle-grouped CV variant (StratifiedGroupKFold on
   vehicle) to eval_audio and save it alongside the recording-grouped one. If not derivable, add a
   note in real_metrics.json: "vehicle identity unknown – recording-grouped CV may be optimistic".
2. Bootstrap (1000 resamples at RECORDING level) 95% CIs for accuracy, macro-F1, healthy FPR for
   each model. Save as "*_ci" fields.
3. CNN (autopulse/models.py): add optional SpecAugment (2 freq masks ≤8 bins, 2 time masks ≤10%),
   class-weighted cross-entropy, early stopping on an inner grouped validation split, and
   seed-averaging (3 seeds, average probabilities). Keep the old train_cnn signature working
   (new behaviour behind keyword args, defaults unchanged for train.py).
4. Re-run `evaluate_real.py audio`; report old vs new CNN with CIs. Update the Evidence page text
   with the honest explanation.
```

---

## Task 10: OBD residual models for slow-drift faults (optional)

**Objective:** Catch the faults the adaptive baseline misses (MAP sensor drift 14%, timing retard 11%) using cross-sensor consistency, and lower the 14% healthy-trip false-alarm rate.

**Acceptance criteria**
- `autopulse/residuals.py` learns, from healthy training trips, regressions that predict one sensor from the others: MAP from RPM + throttle + IAT, timing advance from RPM + load, and STFT from operating point. Residuals feed the adaptive baseline.
- The same carOBD split and calibration protocol is used (thresholds set on calibration trips; healthy false alarms ≤ 10%).
- A before/after table covers all four injected faults plus the healthy false-alarm rate.

```text
Task 10 – Cross-sensor residuals for OBD drift faults.

In evaluate_real.py::eval_obd the adaptive baseline uses per-window means of ltft, stft, map,
battery, timing, cat, iat. Drift faults (map_sensor_drift, timing_retard) are hard because each
signal alone stays in a plausible range.

1. autopulse/residuals.py: fit on LEARNING trips only (same split as eval_obd):
   - MAP ~ f(rpm, throttle, iat)        (gradient boosting or small MLP, scikit-learn)
   - timing ~ f(rpm, load, coolant)
   - stft_mean ~ f(rpm, load)
   Return per-window residual mean/std features.
2. Add these residual features to the adaptive and static baselines as an option ("+residuals"),
   choose settings and thresholds on CALIBRATION trips exactly like the existing code, score once
   on TEST trips. Keep the old results; add new ones under real_metrics.json["obd"]["residuals"].
3. Report the before/after table for all 4 faults + healthy false-alarm trip rate. If a fault is
   still missed, say so. Show the table on the Evidence page with source tag "Real trips + injected
   faults".
```

---

## Task 11: Failure-case demo scenarios

**Objective:** Show judges, in a controlled way, where the system is uncertain, and that it says so.

**Acceptance criteria**
- The vehicle control panel and scenario drawer gain *Noisy environment*, *Early-stage fault* and *Unusual RPM (5,500)* toggles.
- The dashboard visibly responds with an "unsure" state or lower confidence instead of a wrong confident answer, with a one-line explanation.
- The demo script in `docs/WALKTHROUGH.md` gets a 30-second "where it breaks" step.

```text
Task 11 – Failure-case demo scenarios.

1. autopulse/livecar.py + vehicle/node.py /api/control: add stress modifiers: noise multiplier
   (1, 5, 10), fault severity (normal 0.4-1.0 vs early 0.1-0.3), rpm override (e.g., 5500).
   Expose them in vehicle/VehicleApp.jsx (and the single-laptop ScenarioDrawer if it exists in
   this tree).
2. backend/live.py: include in the engine payload a short "why_unsure" string when status is
   unsure (e.g., "low signal-to-noise", "rpm outside training range 750-4000",
   "fault signature weak"), derived from simple checks (estimated SNR, rpm range from
   metrics/meta JSON, max probability).
3. UI: show the unsure state prominently on LiveDrive/HealthCheck with that explanation.
4. docs/WALKTHROUGH.md: add a "Where it breaks (30 s)" step to the demo script.
Verify each modifier changes the dashboard as expected; list files changed.
```

---

## Task 12: Tests and one results report

**Objective:** Make sure the whole pipeline still runs after all of the above, and that the numbers on screen match the JSON files.

**Acceptance criteria**
- `tests/` contains pytest tests covering: generator determinism and backward compatibility, the feature vector shape and names, `classify_clip` on a synthetic tone, fusion feature shapes, wear health-indicator monotonic behaviour on a synthetic degrading series, the backend routes (`/api/meta`, `/api/results`, `/api/classify-audio` with a tiny WAV, `/api/wear`) via FastAPI TestClient, and a fast `--quick` path for each training script.
- `scripts/report_results.py` prints one Markdown table of every headline metric with its source tag, built from the JSON files. This is what you quote in the pitch.
- `run.bat` still works from a clean checkout plus downloaded data.

```text
Task 12 – Tests and results summary.

1. Add pytest (and httpx for TestClient) to a requirements-dev.txt. Create tests/ with fast tests
   (< 60 s total, no dataset downloads; skip real-data tests with pytest.mark.skipif when
   data/raw is missing):
   - generator: same seed -> identical output; synth_window default keys unchanged; randomize mode
     runs; mic/accel/obd present (Task 5).
   - signatures.features: length == len(FEATURE_NAMES), finite values for silence, a sine, noise.
   - real_audio.classify_clip on a 3 s synthetic signal returns valid probabilities summing to 1
     (skip if models/real_audio missing).
   - fusion.fused_features shape and names.
   - wear.health_indicator rises on a synthetic exponentially degrading series; rul band contains
     the true failure for that synthetic case.
   - backend: TestClient for /api/meta, /api/results, /api/wear, /api/classify-audio (tiny WAV
     generated in the test), and 413 on an oversized upload.
2. Add --quick flags (if not already) to train.py, train_real.py, train_fusion.py,
   scripts/robustness.py, and evaluate_real.py so a smoke run finishes in a few minutes.
3. scripts/report_results.py: read models/*.json and print a Markdown table:
   Claim | Number | Data source | Split/protocol | File. Include healthy FPR, CIs, transfer
   results, fusion ablation, RUL error, OBD per-fault detection.
4. Run the full test suite and the report; paste both outputs. Then do a clean-run check of
   run.bat (delete models/ copies in a temp copy of the tree, not the original) and report.
```

---

## Final checklist before the demo

- [ ] At least one screen classifies a **real** clip live (upload, mic, or replay)
- [ ] The headline number shown to judges is a **real-data** number with its source tag
- [ ] Healthy false-alarm rate is reported and the app can say "unsure"
- [ ] Comparison table shows mic vs accelerometer vs OBD vs fused
- [ ] Wear panel uses real run-to-failure data; brakes, tyres and oil are not presented as predictions
- [ ] Robustness heatmap on the Evidence page, before and after domain randomisation
- [ ] Failure-case scenario rehearsed (30 s)
- [ ] `pytest` passes; `report_results.py` output saved for the pitch
- [ ] Rehearsed answers to:
  - "Which screen shows a real engine?"
  - "Why isn't the 98% circular?"
  - "How is wear prediction different from an odometer?"
  - "Where do the sensors combine?"
  - "What's your false-alarm rate on healthy cars?"
  - "Why is the CNN worse?"
