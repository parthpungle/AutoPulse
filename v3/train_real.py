"""Train the dashboard's real-audio models on every real engine recording (no held-out set here:
held-out scores come from evaluate_real.py audio, which uses the same windows, features and settings).

    .venv\\Scripts\\python train_real.py

Needs data/raw/engine_audio (scripts/download_data.py engine_audio). Writes models/real_audio/:
svm.joblib, softmax.joblib, ann.joblib, cnn.pt, meta.json.
"""
import sys
import time
from pathlib import Path

import numpy as np

from autopulse import real_audio
from autopulse.realdata import RAW, load_engine_audio

QUICK = "--quick" in sys.argv   # smoke run: every 6th recording, CNN 3 epochs, written to models/quick/real_audio
if QUICK:
    real_audio.DIR = Path(__file__).parent / "models" / "quick" / "real_audio"
    real_audio.CNN_EPOCHS = 3

if __name__ == "__main__":
    if not any((RAW / "engine_audio").glob("*.wav")):
        raise SystemExit("data/raw/engine_audio is empty: run scripts/download_data.py engine_audio first")
    t0 = time.time()
    wins = load_engine_audio()
    if QUICK:
        keep = sorted({w["clip"] for w in wins})[::6]
        wins = [w for w in wins if w["clip"] in keep]
    y = np.array([real_audio.CLASSES.index(w["label"]) for w in wins])
    clips = {w["clip"] for w in wins}
    rpms, X, S = real_audio.window_features([w["signal"] for w in wins])
    print(f"real audio: {len(wins)} windows from {len(clips)} recordings, features in {time.time() - t0:.0f}s")
    print("  windows per class:", dict(zip(real_audio.CLASSES, np.bincount(y, minlength=4).tolist())))
    # abstain threshold: out-of-fold ensemble on all recordings (3 folds grouped by recording), the same rule
    # evaluate_real.py applies inside each training fold; its held-out effect is in real_metrics.json audio.selective
    groups = np.array([w["clip"] for w in wins])
    P = real_audio.oof_ensemble(X, S, y, groups, n_splits=3, seed=0)
    tau, met, st = real_audio.choose_threshold(*real_audio.recording_proba(P, y, groups))
    print(f"  threshold {tau:.2f} (target met: {met}): out-of-fold coverage {st['coverage']:.3f}, "
          f"healthy FPR on answered {st['healthy_fpr_answered']:.3f}")
    models = real_audio.fit_real_models(X, S, y)
    meta = real_audio.new_meta(len(clips), len(wins), models)
    meta["threshold"] = {"value": tau, "target_met": met, "target_healthy_fpr": real_audio.TARGET_HEALTHY_FPR,
                         "applies_to": "a clip's ensemble probability (mean over its windows); below it the verdict "
                                       "is 'unsure'", "chosen_on": "3-fold out-of-fold predictions grouped by recording",
                         "out_of_fold": st}
    real_audio.save_real_models(models, meta)
    train_acc = {n: float(np.mean(m.predict(X) == y)) for n, m in models.items() if n != real_audio.CNN_NAME}
    print("  training-set accuracy (not a test score):", {k: round(v, 3) for k, v in train_acc.items()})
    print(f"saved {', '.join(meta['models'])} to {real_audio.DIR} in {time.time() - t0:.0f}s")
