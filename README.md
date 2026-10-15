# AutoPulse: multi-sensor signature extraction & pattern recognition for vehicle health

Honeywell problem statement: *Automobile engine data: signature extraction and pattern recognition.*
Full research and plan: [PROJECT_PLAN.md](PROJECT_PLAN.md) · OBD-II primer: [docs/OBD2_EXPLAINED.md](docs/OBD2_EXPLAINED.md)

## Run

```bash
python -m venv .venv
.venv\Scripts\python -m pip install numpy scipy scikit-learn pandas streamlit plotly joblib
.venv\Scripts\python -m pip install torch --index-url https://download.pytorch.org/whl/cpu
.venv\Scripts\python train.py
.venv\Scripts\python -I scripts\download_data.py      # free public datasets, no login (~550 MB)
.venv\Scripts\python evaluate_real.py               # real-data scores -> models/real_metrics.json
.venv\Scripts\python -m streamlit run app.py
```

## What's inside

| File | What it does |
|---|---|
| `autopulse/generator.py` | Physics-inspired engine vibration/sound generator: crank kinematics, 4-cyl firing, structural resonances. Faults: misfire, knock, valve tick, bearing, belt squeal, imbalance. 10 different simulated cars |
| `autopulse/signatures.py` | Signature extraction: time features, FFT band energies, **engine-order spectrum**, **Hilbert envelope spectrum**, **STFT spectrogram**, crank-speed irregularity (28 features) |
| `autopulse/models.py` | **SVM**, **Softmax regression**, **ANN (MLP)**, **2D CNN** on spectrograms |
| `train.py` | Builds the dataset, trains all 4 models, evaluates **on unseen cars** (split by car, not by window) |
| `autopulse/baseline.py` | **Adaptive per-car, per-context baseline** vs. a static baseline over 8 simulated months (seasons + ageing + late fault); wear / health % trends |
| `autopulse/telemetry.py` | 1 Hz OBD-II drive simulator with faults: coolant leak, thermostat, alternator, belt, puncture, slow leak, vacuum leak, oil pressure, fuel leak |
| `autopulse/rules.py` | Hard safety limits that never adapt, with driver guidance (AC off / heater max, time left on battery, nearest help on Maps) |
| `autopulse/realdata.py` | Loaders for carOBD, engine-condition table, real engine audio, CWRU bearings |
| `evaluate_real.py` | Real-data train/test: audio grouped by recording, CWRU leave-one-load-out, carOBD baseline with calibration-only tuning |
| `app.py` | Streamlit dashboard: Startup Check · Live Drive · Signature Lab · Adaptive Baseline · Wear & Health · Models |

## Demo script (round 1, ~4 min)

1. **Startup Check**, healthy car 8 → *Start car* → score ~100. Switch the engine condition to *Misfire* → P0302 + AI detection.
2. **Signature Lab**: switch between Healthy / Knock / Bearing. Point at the knock resonance in the FFT, the BPFO peak in the envelope spectrum, and the crank-speed dips for misfire. All 4 models vote.
3. **Live Drive**: vehicle condition *Coolant leak* → *Replay drive* → warning with "AC off, heater max, ~X min to critical" → critical. Then *Alternator* → driving time left on battery. Then *Puncture* → nearest tyre shop.
4. **Adaptive Baseline**: the static baseline false-alarms every winter morning; the adaptive one stays quiet and catches the real valve fault within days.
5. **Wear & Health**: battery health like a phone's, with cold-weather dips compensated.
6. **Models**: accuracy on unseen cars + confusion matrices.
