# Changes: Live Audio Monitoring

Branch `Sparsh`, commit `a98b505` on top of `main` (`4c91e27`). 33 files, +3,714 / −8 lines.

Adds a **Live audio** page: the computer's microphone, analysed by a model trained on real engine recordings, shown with an honest account of what the output does and does not mean. Added to both the root app and `polish/`.

## Why

- The app had no microphone input. Engine-audio results existed only as cross-validation on prerecorded files (`evaluate_real.py`); no real-audio model was ever saved.
- The shipped models (`svm/softmax/ann.joblib`) are trained on the simulator and score 15–41% on real engine sound (`real_metrics.json → audio.zero_shot_from_simulator`). They are deliberately not used for the microphone.
- A laptop mic usually hears voice, music, fans and room noise. Those must not be labelled as engine faults.

## How it works

```
browser mic ─► AudioWorklet (mono, 2048-sample chunks) ─► 4 s ring buffer
   every 0.5 / 1 / 2 s, one request at a time:
   last 1 s as raw float32 ─► POST /api/live-audio/analyze?sample_rate=…
backend: validate ─► mono ─► resample to 24 kHz ─► z-score ─► estimate_rpm
         ─► signatures.features (28) ─► quality gate ─► engine-likeness gate ─► SVM
page: waveform, level meter, spectrogram, measurements, scores, last 20 windows
```

- **Same chain as `evaluate_real.py`'s audio suite**, with one deliberate difference: a live stream has no recording to normalise over, so each 1 s window is z-scored on its own, and the saved model is trained the same way.
- **`log_rms` is pinned to 0.** Per-window z-scoring makes it constant; the leftover float32/float64 rounding noise was blown up by the scaler and turned every live window into "belt squeal". Found in end-to-end testing, fixed, and covered by regression tests.
- **Labels are withheld** unless the window passes both gates:
  - quality: not silent, RMS above −50 dBFS, no more than 0.1% clipped samples;
  - engine-likeness: IsolationForest on the training features, threshold rejecting ~2% of held-out real engine windows.
- **Browser voice processing is turned off** (echo cancellation, noise suppression, auto-gain), because it reshapes the spectrum.
- **Audio is analysed in memory and never stored or logged.** Requests are limited to 4 s and 8–192 kHz. At most 2 windows are analysed at once (extra requests get 429), with a 5 s timeout (504).

## Model

| | |
|---|---|
| Data | Hugging Face `RashmiKarunarathne/MyDataSet`: 321 phone recordings of real car engines. Licence not stated on the dataset card |
| Classes | healthy, misfire, valve_tick, belt_squeal |
| Model | SVM (RBF) on 28 signature features, `models/live_audio.joblib` (1.4 MB) |
| Accuracy | 5-fold cross-validation grouped by recording: **90.5% ± 2.1% of windows, 91.3% of recordings**. With the original per-recording normalisation: 90.4% |
| Engine-likeness gate | Rejected 100% of synthetic voice-like, tone, chord and fan probes; **passed 30% of white-noise windows** |

The accuracy is for phone recordings from the same dataset. It is not an accuracy for any other microphone, room or car.

## Files

### Root app

| File | Change |
|---|---|
| `autopulse/live_audio.py` | **New.** Validation, mono, resampling, normalisation, windowing, quality checks, features, model loading and checks, both gates |
| `train_live_audio.py` | **New.** Trains and saves the live model on real recordings; grouped CV under both normalisations; calibrates and probes the gate |
| `models/live_audio.joblib` | **New.** Trained model, gate and metadata |
| `models/live_audio_metrics.json` | **New.** Cross-validation, confusion matrices, gate results |
| `backend/app.py` | **Edited.** `GET /api/live-audio/status`, `POST /api/live-audio/analyze`; live model loaded once, warmed at startup |
| `frontend/src/live/mic.js` | **New.** Microphone lifecycle: permission, device loss, no double start, full cleanup on stop |
| `frontend/src/live/buffer.js` | **New.** Bounded ring buffer, bounded history, level meter maths |
| `frontend/src/live/analyzer.js` | **New.** API client (timeouts, error mapping) and the no-overlap scheduler |
| `frontend/src/live/live.test.js` | **New.** 14 Node tests with faked browser APIs |
| `frontend/src/pages/LiveAudio.jsx` | **New.** The Live Audio Monitoring page |
| `frontend/src/App.jsx` | **Edited.** Adds the "Live audio" page to the sidebar |
| `frontend/src/styles.css` | **Edited.** Styles for the new page |
| `frontend/package.json` | **Edited.** `npm test` script. `run.bat` will re-run `npm install` once because this file changed |
| `tests/test_live_audio.py` | **New.** Preprocessing, gates, model handling, real-recording consistency |
| `tests/test_live_audio_api.py` | **New.** Route validation, 413/415/422/429/500/504, model-unavailable state |
| `requirements-dev.txt` | **New.** pytest, httpx (tests only) |
| `README.md` | **Edited.** Live Audio section: setup, use, pipeline, troubleshooting, limitations |

### `polish/` (2-screen version: vehicle + dashboard)

The same Python module, training script, tests, model and frontend logic, adapted to `polish`'s own design:

| File | Change |
|---|---|
| `polish/autopulse/live_audio.py`, `polish/train_live_audio.py`, `polish/requirements-dev.txt` | **New.** Same as root |
| `polish/models/live_audio.joblib`, `polish/models/live_audio_metrics.json` | **New.** Same as root |
| `polish/tests/test_live_audio.py`, `polish/tests/test_live_audio_api.py` | **New.** Same as root |
| `polish/backend/app.py` | **Edited.** Same two routes and startup warm-up |
| `polish/frontend/src/liveaudio/*.js` | **New.** Same as root `src/live/`, renamed to avoid `polish`'s existing `live.jsx` |
| `polish/frontend/src/pages/LiveAudio.jsx` | **New.** Same page; CSS classes prefixed `la-` (polish already uses `.banner`, `.empty`, `.dot`) |
| `polish/frontend/src/App.jsx` | **Edited.** Adds "Live audio" (mic icon) to the rail; works without a paired vehicle |
| `polish/frontend/src/styles.css`, `polish/frontend/package.json` | **Edited.** Page styles and `npm test` |

Unchanged: all three `run.bat` launchers, `evaluate_real.py`, `signatures.py`, `realdata.py`, `models.py`, the existing models, and the `split/` and `test/` copies.

## Testing

| Check | Root | `polish/` |
|---|---|---|
| pytest | 46 passed | 46 passed* |
| `npm test` | 14 passed | 14 passed |
| `vite build` | passes | passes |
| Browser, real misfire recording as the mic | 13 / 14 windows Misfire | 15 / 15 Misfire |
| Browser, real healthy recording as the mic | 14 / 14 Healthy | 15 / 15 Healthy |
| Browser, Chrome's built-in fake beep | withheld as clipped | — |

\* 3 tests need `data/raw/engine_audio`, which `polish/` doesn't have; they were run against the root copy of the data.

The browser runs used headless Edge with a fake microphone. Round trip was 30–66 ms per window, about 17 ms of it on the server. The test recordings are in the model's training set, so these runs show the pipeline is consistent end to end, not that the model is accurate.

## Running it

```
.venv\Scripts\python -m pip install -r requirements-dev.txt
.venv\Scripts\python -m pytest tests
cd frontend && npm test
```

Root app: `run.bat` → http://localhost:5173 → **Live audio**.
`polish/`: `polish\run.bat`, option **3** (opens a vehicle tab and a dashboard tab) → dashboard → mic icon.

To retrain the model (optional; the trained file is included):

```
.venv\Scripts\python scripts\download_data.py engine_audio
.venv\Scripts\python train_live_audio.py
```

## Known limitations

- Not tested with a physical microphone or the real browser permission prompt; all browser tests used a fake device.
- Not a validated diagnosis for any microphone, room or vehicle. The page says so wherever a label appears.
- Broadband noise can pass the engine-likeness gate (30% of white-noise windows).
- The dataset licence is unknown.
- Retraining took 75 s on one run and 71 min on another; the cause wasn't investigated.
- Existing deprecation warnings (`SVC(probability=True)`, FastAPI `on_event`) are not from this change.
