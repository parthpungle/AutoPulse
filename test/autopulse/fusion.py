"""Multivariable fusion: microphone + block accelerometer + OBD-II context.

Feature fusion: one vector = mic signatures + accelerometer signatures + OBD context, one classifier.
Late fusion: one classifier per modality, their probabilities combined by a logistic-regression stacker
whose weights are learned on validation folds (never on the test cars).
"""
import json
from functools import lru_cache
from pathlib import Path

import numpy as np

from .signatures import FEATURE_NAMES as SIG_NAMES
from .signatures import features

OBD_NAMES = ["rpm", "coolant_c", "load_pct", "throttle_pct", "stft_std", "ltft_pct"]
FEATURE_NAMES = [f"mic_{n}" for n in SIG_NAMES] + [f"acc_{n}" for n in SIG_NAMES] + [f"obd_{n}" for n in OBD_NAMES]
MODALITIES = {  # column slices of the fused vector
    "mic": slice(0, len(SIG_NAMES)),
    "accel": slice(len(SIG_NAMES), 2 * len(SIG_NAMES)),
    "obd": slice(2 * len(SIG_NAMES), len(FEATURE_NAMES)),
}
DIR = Path(__file__).resolve().parents[1] / "models" / "fusion"


def obd_features(obd):
    return np.array([float(obd[k]) for k in OBD_NAMES])


def fused_features(mic, accel, fs, obd, crank_speed=None):
    """Concatenate mic signatures (mic_*), accelerometer signatures (acc_*) and OBD context (obd_*).
    Both signature sets use the OBD rpm for their order features and the same crank-speed sensor."""
    rpm = float(obd["rpm"])
    return np.concatenate([features(mic, fs, rpm, crank_speed), features(accel, fs, rpm, crank_speed),
                           obd_features(obd)])


def late_fusion(prob_dicts, weights):
    """Combine per-modality probabilities. weights is either a fitted stacker (anything with predict_proba,
    fed the concatenated probabilities in MODALITIES order) or a dict {modality: weight} for a weighted mean."""
    names = [m for m in MODALITIES if m in prob_dicts]
    if hasattr(weights, "predict_proba"):
        return weights.predict_proba(np.hstack([np.atleast_2d(prob_dicts[m]) for m in names]))
    w = np.array([weights.get(m, 0.0) for m in names], dtype=float)
    P = np.stack([np.atleast_2d(prob_dicts[m]) for m in names])
    return np.tensordot(w / w.sum(), P, axes=1)


# ------------------------------------------------------------------ the saved live models (train_fusion.py)
@lru_cache(maxsize=1)
def load_fusion():
    """{"models": {"Fused SVM", "Fused ANN"} (mic+accel+obd feature fusion), "per_modality": {mic, accel, obd},
    "meta"} or None when train_fusion.py has not been run."""
    if not (DIR / "meta.json").exists():
        return None
    import joblib
    meta = json.loads((DIR / "meta.json").read_text())
    live = meta.get("live_models", {"Fused SVM": "fused_svm.joblib", "Fused ANN": "fused_ann.joblib"})
    return {"models": {n: joblib.load(DIR / f) for n, f in live.items()},
            "per_modality": {m: joblib.load(DIR / f) for m, f in meta["per_modality"].items()}, "meta": meta}


def modality_contrib(fz, per_modality, k):
    """Each modality's own probability for class k (the fused verdict), from its single-modality model."""
    x = np.asarray(fz)[None]
    return {m: float(model.predict_proba(x[:, MODALITIES[m]])[0, k]) for m, model in per_modality.items()}
