"""Train the model used by Live Audio Monitoring, on real engine recordings only.

    .venv\\Scripts\\python scripts\\download_data.py engine_audio     (once, ~350 MB)
    .venv\\Scripts\\python train_live_audio.py

Data and features are those of evaluate_real.py's audio suite (Hugging Face RashmiKarunarathne/MyDataSet,
24 kHz, 1 s windows, 0.5 s hop, rpm estimated from sound). Each window is z-scored on its own, as live
inference must do (a stream has no recording to normalise over); the score with evaluate_real.py's
per-recording normalisation is computed alongside so the effect of that choice is on record.

Writes models/live_audio.joblib (model + novelty gate + metadata) and models/live_audio_metrics.json.
"""
import json
import time
from datetime import datetime, timezone
from pathlib import Path

import joblib
import numpy as np
import pandas as pd
import sklearn
from sklearn.ensemble import IsolationForest
from sklearn.metrics import accuracy_score, confusion_matrix, f1_score
from sklearn.model_selection import StratifiedGroupKFold

from autopulse.live_audio import ARTIFACT, ARTIFACT_VERSION, MODEL_FS, WINDOW_S, featurize, normalize
from autopulse.models import feature_models
from autopulse.realdata import load_engine_audio
from autopulse.signatures import FEATURE_NAMES

CLASSES = ["healthy", "misfire", "valve_tick", "belt_squeal"]
MODEL_NAME = "SVM (RBF)"          # best grouped-CV model in evaluate_real.py's audio suite
NOVELTY_REJECT = 0.02             # novelty threshold: ~2% of held-out real engine windows fall below it
METRICS = Path(__file__).parent / "models" / "live_audio_metrics.json"


def probe_signals(rng, fs=MODEL_FS):
    """Non-engine sounds a laptop mic hears, to measure how often the novelty gate lets them through.
    Synthetic stand-ins: they test the gate, they are not a substitute for real recordings."""
    t = np.arange(int(WINDOW_S * fs)) / fs
    out = {}
    for k in range(10):
        f0 = rng.uniform(100, 240) * (1 + 0.02 * np.sin(2 * np.pi * 5 * t))  # voice-like: harmonics + vibrato
        ph = 2 * np.pi * np.cumsum(f0) / fs
        formant = lambda h: np.exp(-((h * f0.mean() - 700) / 400) ** 2) + 0.5 * np.exp(-((h * f0.mean() - 1800) / 500) ** 2)  # noqa: E731
        v = sum(formant(h) * np.sin(h * ph) / h for h in range(1, 30))
        out.setdefault("voice-like harmonics", []).append(v * (0.6 + 0.4 * np.sin(2 * np.pi * 4 * t) ** 2))
        out.setdefault("pure tone", []).append(np.sin(2 * np.pi * rng.uniform(200, 4000) * t))
        chord = sum(np.sin(2 * np.pi * f * t) for f in rng.uniform(200, 900) * np.array([1, 1.26, 1.5, 2]))
        out.setdefault("music-like chord", []).append(chord)
        out.setdefault("white noise", []).append(rng.standard_normal(len(t)))
        n = np.cumsum(rng.standard_normal(len(t)))
        fan = n - np.convolve(n, np.ones(200) / 200, "same") + 0.3 * np.sin(2 * np.pi * rng.uniform(80, 200) * t)
        out.setdefault("fan-like hum + noise", []).append(fan)
    return out


def main():
    t0 = time.time()
    wins = load_engine_audio()
    y = np.array([CLASSES.index(w["label"]) for w in wins])
    clips = np.array([w["clip"] for w in wins])
    X = np.array([featurize(normalize(w["signal"].astype(np.float64)))[0] for w in wins])
    X_rec = np.array([featurize(w["signal"].astype(np.float64))[0] for w in wins])  # per-recording (evaluate_real)
    print(f"{len(wins)} windows from {len(set(clips))} recordings, features in {time.time() - t0:.0f}s")

    folds = list(StratifiedGroupKFold(5, shuffle=True, random_state=0).split(X, y, clips))  # as evaluate_real

    def cv(Xm):
        proba = np.zeros((len(y), len(CLASSES)))
        nov = np.zeros(len(y))
        acc, f1 = [], []
        for tr, te in folds:
            m = feature_models()[MODEL_NAME].fit(Xm[tr], y[tr])
            proba[te] = m.predict_proba(Xm[te])
            nov[te] = IsolationForest(random_state=0).fit(Xm[tr]).score_samples(Xm[te])
            acc.append(accuracy_score(y[te], proba[te].argmax(1)))
            f1.append(f1_score(y[te], proba[te].argmax(1), average="macro"))
        g = pd.DataFrame(proba).groupby(clips).mean()
        truth = pd.Series(y).groupby(clips).first().loc[g.index]
        return {"accuracy": {"mean": float(np.mean(acc)), "std": float(np.std(acc))},
                "macro_f1": {"mean": float(np.mean(f1)), "std": float(np.std(f1))},
                "recording_accuracy": float(accuracy_score(truth, g.to_numpy().argmax(1))),
                "confusion": confusion_matrix(y, proba.argmax(1), labels=range(len(CLASSES))).tolist()}, nov

    res, held_out_nov = cv(X)
    res_rec, _ = cv(X_rec)
    threshold = float(np.quantile(held_out_nov, NOVELTY_REJECT))
    print(f"{MODEL_NAME}, per-window normalisation: acc {res['accuracy']['mean']:.3f} ± {res['accuracy']['std']:.3f}, "
          f"recording acc {res['recording_accuracy']:.3f}")
    print(f"{MODEL_NAME}, per-recording normalisation (evaluate_real): acc {res_rec['accuracy']['mean']:.3f}")

    model = feature_models()[MODEL_NAME].fit(X, y)
    novelty = IsolationForest(random_state=0).fit(X)

    probes = {}
    for name, sigs in probe_signals(np.random.default_rng(7)).items():
        s = np.array([novelty.score_samples(featurize(normalize(x))[0][None])[0] for x in sigs])
        probes[name] = {"n": len(sigs), "passed_gate": float(np.mean(s >= threshold))}
        print(f"  novelty gate, {name:22s}: {probes[name]['passed_gate']:.0%} pass (should be ~0%)")

    metrics = {
        "model": MODEL_NAME, "classes": CLASSES, "n_windows": int(len(y)), "n_recordings": int(len(set(clips))),
        "class_recordings": {c: int(len(set(clips[y == i]))) for i, c in enumerate(CLASSES)},
        "split": "5-fold cross-validation grouped by recording (same folds as evaluate_real.py)",
        "per_window_normalization": res, "per_recording_normalization": res_rec,
        "novelty_gate": {"method": "IsolationForest on the 28 signature features",
                         "threshold": threshold, "target_reject_rate_real_engine": NOVELTY_REJECT,
                         "threshold_source": "quantile of held-out (cross-validated) real engine windows",
                         "synthetic_probe_pass_rate": probes},
    }
    bundle = {
        "version": ARTIFACT_VERSION, "model_name": MODEL_NAME, "model": model, "classes": CLASSES,
        "feature_names": FEATURE_NAMES, "fs": MODEL_FS, "window_s": WINDOW_S, "normalization": "per_window",
        "novelty": novelty, "novelty_threshold": threshold, "metrics": metrics,
        "dataset": {"name": "Hugging Face RashmiKarunarathne/MyDataSet",
                    "description": "Phone recordings of real car engines (7 small-car models), 44.1/48 kHz, 5-10 s; "
                                   "labels from file names: healthy, misfire, tappet_issue -> valve_tick, "
                                   "belt_issue -> belt_squeal",
                    "license": "not stated on the dataset card"},
        "trained_at": datetime.now(timezone.utc).isoformat(timespec="seconds"),
        "sklearn_version": sklearn.__version__,
    }
    joblib.dump(bundle, ARTIFACT)
    METRICS.write_text(json.dumps(metrics, indent=2))
    print(f"done in {time.time() - t0:.0f}s -> {ARTIFACT.name}, {METRICS.name}")


if __name__ == "__main__":
    main()
