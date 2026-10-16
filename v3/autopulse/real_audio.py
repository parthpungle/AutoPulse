"""Models trained on real engine sound (HF RashmiKarunarathne/MyDataSet), and classifying a new clip with them.

The same windowing and features are used by evaluate_real.py (cross-validation), train_real.py (final models)
and classify_clip() (a new recording), so a clip is seen exactly the way the models were trained.
"""
import json
from functools import lru_cache
from pathlib import Path

import numpy as np
from scipy.signal import resample_poly

from .signatures import FEATURE_NAMES, features, stft_image

CLASSES = ["healthy", "misfire", "valve_tick", "belt_squeal"]
FS, WINDOW_S, HOP_S = 24000, 1.0, 0.5
SOURCE = "real: HF RashmiKarunarathne/MyDataSet"
DIR = Path(__file__).resolve().parents[1] / "models" / "real_audio"
FILES = {"SVM (RBF)": "svm.joblib", "Softmax regression": "softmax.joblib", "ANN (MLP + softmax)": "ann.joblib"}
CNN_NAME, CNN_EPOCHS = "CNN (spectrogram)", 20

# Near-silence: real training windows are never below -45 dBFS, and 99% sit within 6.4 dB of their clip's RMS.
# -60 dBFS is 15 dB under the quietest real window (a muted or unplugged mic); -20 dB under the clip's own RMS is a
# pause or the engine switched off (0.16% of training windows, 6 of 3869). Either way the window is dropped.
SILENT_DBFS, SILENT_REL_DB = -60.0, -20.0


def to_mono(y):
    """Float mono; integer PCM is scaled to full scale = 1 so absolute levels mean dBFS."""
    y = np.asarray(y)
    scale = float(np.iinfo(y.dtype).max) + 1 if np.issubdtype(y.dtype, np.integer) else 1.0
    y = y.astype(np.float64) / scale
    return y.mean(axis=1) if y.ndim > 1 else y


def resample(y, fs):
    return resample_poly(y, FS, fs) if fs != FS else y


def clip_windows(y):
    """z-score the whole clip (24 kHz), then 1 s windows every 0.5 s. Returns (windows, start indices)."""
    y = (y - y.mean()) / (y.std() + 1e-9)
    n, hop = int(WINDOW_S * FS), int(HOP_S * FS)
    starts = list(range(0, len(y) - n + 1, hop))
    return [y[s:s + n].astype(np.float32) for s in starts], starts


def window_features(signals, fs=FS):
    """(rpm estimates, 28-feature matrix, STFT images) for a list of windows, exactly as in eval_audio()."""
    from .realdata import estimate_rpm  # realdata imports this module
    rpms = np.array([estimate_rpm(x, fs) for x in signals])
    X = np.array([features(x, fs, r) for x, r in zip(signals, rpms)])
    S = np.array([stft_image(x, fs)[2] for x in signals], dtype=np.float32)
    return rpms, X, S


def windows_from_signal(x, fs, times=False):
    """A new recording -> (kept windows, n_dropped). Mono, 24 kHz, z-scored, 1 s / 0.5 s hop, silence removed.
    times=True adds the start time (s) of every kept and every dropped window."""
    y = resample(to_mono(x), fs)
    y = y - y.mean()
    clip_rms = y.std() + 1e-12
    wins, starts = clip_windows(y)
    n = int(WINDOW_S * FS)
    keep, keep_t, drop_t = [], [], []
    for w, s in zip(wins, starts):
        rms = y[s:s + n].std() + 1e-12
        if 20 * np.log10(rms) >= SILENT_DBFS and 20 * np.log10(rms / clip_rms) >= SILENT_REL_DB:
            keep.append(w)
            keep_t.append(s / FS)
        else:
            drop_t.append(s / FS)
    return (keep, len(drop_t), keep_t, drop_t) if times else (keep, len(drop_t))


# ------------------------------------------------------------------ abstaining: "unsure" below a confidence threshold
HEALTHY = 0                                  # index of "healthy" in CLASSES
TARGET_HEALTHY_FPR = 0.05                    # at recording level, among the recordings the ensemble answers
THRESHOLD_GRID = np.round(np.arange(0.25, 0.951, 0.01), 2)   # 0.25 = never abstain with 4 classes


def ensemble_proba(models, X, S):
    """Window probabilities: the mean of every model's (SVM, Softmax, ANN, CNN)."""
    from .models import cnn_proba
    return np.mean([cnn_proba(m, S) if n == CNN_NAME else m.predict_proba(X) for n, m in models.items()], axis=0)


def oof_ensemble(X, S, y, groups, n_splits=3, seed=0):
    """Out-of-fold ensemble probabilities for every window, folds grouped by recording."""
    from sklearn.model_selection import StratifiedGroupKFold
    P = np.zeros((len(y), len(CLASSES)))
    for tr, te in StratifiedGroupKFold(n_splits, shuffle=True, random_state=seed).split(X, y, groups):
        P[te] = ensemble_proba(fit_real_models(X[tr], S[tr], y[tr]), X[te], S[te])
    return P


def recording_proba(P, y, groups):
    """Window probabilities -> (recording probabilities = mean over its windows, recording labels)."""
    ids = sorted(set(groups))
    idx = {g: i for i, g in enumerate(ids)}
    rows = np.array([idx[g] for g in groups])
    Pr = np.zeros((len(ids), P.shape[1]))
    np.add.at(Pr, rows, P)
    Pr /= np.bincount(rows)[:, None]
    yr = np.zeros(len(ids), int)
    yr[rows] = y
    return Pr, yr


def selective_stats(P, y, tau):
    """Answer only when max probability >= tau. Healthy FPR = healthy answered as a fault / healthy answered;
    healthy_alarm_rate = the same over all healthy items (an "unsure" is not an alarm)."""
    conf, pred = P.max(1), P.argmax(1)
    ans = conf >= tau
    h = y == HEALTHY
    fp = ans & h & (pred != HEALTHY)
    return {"threshold": float(tau), "coverage": float(ans.mean()), "n": int(len(y)), "n_answered": int(ans.sum()),
            "accuracy_answered": float((pred[ans] == y[ans]).mean()) if ans.any() else None,
            "healthy_fpr_answered": float(fp.sum() / max(1, (ans & h).sum())),
            "healthy_alarm_rate": float(fp.sum() / max(1, h.sum())),
            "healthy_answered": int((ans & h).sum()), "healthy_false_alarms": int(fp.sum())}


def choose_threshold(Pr, yr, target=TARGET_HEALTHY_FPR):
    """Lowest threshold (= most coverage) whose recording-level healthy FPR on answered is <= target.
    If none reaches it, the one with the lowest FPR (then the most coverage); met=False says so."""
    stats = [selective_stats(Pr, yr, t) for t in THRESHOLD_GRID]
    ok = [s for s in stats if s["healthy_fpr_answered"] <= target]
    best = ok[0] if ok else min(stats, key=lambda s: (s["healthy_fpr_answered"], -s["coverage"]))
    return float(best["threshold"]), bool(ok), best


# ------------------------------------------------------------------ train / save / load
def fit_real_models(X, S, y, use_cnn=True):
    """Every model on all given windows (same settings as the cross-validation in evaluate_real.py)."""
    from .models import HAS_TORCH, feature_models, train_cnn
    models = feature_models()
    for m in models.values():
        m.fit(X, y)
    if use_cnn and HAS_TORCH:
        models[CNN_NAME] = train_cnn(S, y, len(CLASSES), epochs=CNN_EPOCHS)
    return models


def save_real_models(models, meta):
    import joblib
    DIR.mkdir(parents=True, exist_ok=True)
    for name, f in FILES.items():
        joblib.dump(models[name], DIR / f)
    if CNN_NAME in models:
        import torch
        torch.save(models[CNN_NAME].state_dict(), DIR / "cnn.pt")
    (DIR / "meta.json").write_text(json.dumps(meta, indent=2))
    load_real_models.cache_clear()


@lru_cache(maxsize=1)
def load_real_models():
    """{model name: model} trained on real audio, or None if train_real.py has not been run."""
    if not (DIR / "meta.json").exists():
        return None
    import joblib
    from .models import HAS_TORCH, make_cnn
    models = {name: joblib.load(DIR / f) for name, f in FILES.items()}
    if HAS_TORCH and (DIR / "cnn.pt").exists():
        import torch
        cnn = make_cnn(len(CLASSES))
        cnn.load_state_dict(torch.load(DIR / "cnn.pt", map_location="cpu"))
        models[CNN_NAME] = cnn.eval()
    return models


def meta():
    return json.loads((DIR / "meta.json").read_text()) if (DIR / "meta.json").exists() else None


def new_meta(n_recordings, n_windows, models):
    import datetime
    return {"source": SOURCE, "classes": CLASSES, "fs": FS, "window_s": WINDOW_S, "hop_s": HOP_S,
            "feature_names": list(FEATURE_NAMES), "models": list(models), "n_recordings": int(n_recordings),
            "n_windows": int(n_windows), "trained_at": datetime.datetime.now().astimezone().isoformat(timespec="seconds"),
            "note": "trained on every window of every recording; held-out scores are in real_metrics.json (audio)"}


# ------------------------------------------------------------------ classify a new recording
def threshold():
    """The ensemble confidence below which a clip's verdict is "unsure" (chosen by train_real.py), else 0 = never."""
    m = meta()
    return float(m.get("threshold", {}).get("value", 0.0)) if m else 0.0


def classify_clip(x, fs, models=None, tau=None):
    """Classify a recording (any rate, mono or stereo) with the real-audio models, window by window.
    The verdict is "unsure" when the clip's ensemble confidence is below tau (default: the trained threshold)."""
    from .models import cnn_proba
    models = models or load_real_models()
    if models is None:
        raise FileNotFoundError("no real-audio models: run train_real.py (needs data/raw/engine_audio)")
    wins, dropped, keep_t, drop_t = windows_from_signal(x, fs, times=True)
    out = {"classes": CLASSES, "n_windows": len(wins), "n_dropped": dropped, "source": "real-audio models",
           "window_t": keep_t, "dropped_t": drop_t}
    if not wins:
        return {**out, "per_window": [], "per_model": {}, "ensemble": None, "verdict": None,
                "confidence": None, "rpm_est": None}
    rpms, X, S = window_features(wins)
    per_model_w = {name: (cnn_proba(m, S) if name == CNN_NAME else m.predict_proba(X)).astype(np.float64)
                   for name, m in models.items()}
    per_window = np.mean(list(per_model_w.values()), axis=0)  # ensemble probabilities for each window
    ens = per_window.mean(0)
    k = int(ens.argmax())
    tau = threshold() if tau is None else tau
    return {**out, "per_window": per_window.round(4).tolist(),
            "per_model": {n: p.mean(0).round(4).tolist() for n, p in per_model_w.items()},
            "ensemble": ens.round(4).tolist(), "verdict": CLASSES[k] if ens[k] >= tau else "unsure",
            "top_class": CLASSES[k], "confidence": float(round(ens[k], 4)), "threshold": tau,
            "rpm_est": float(np.median(rpms))}
