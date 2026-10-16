"""Robustness benchmark on the SIMULATOR: how the trained models hold up when one condition changes.

    .venv\\Scripts\\python scripts\\robustness.py [--quick] [--randomized]

--randomized: instead of loading train.py's models, train SVM / Softmax / ANN / CNN the way train.py does but on
domain-randomised windows (synth_window(randomize=True), cars 0-7), run the same sweep, and write
models/robustness_randomized.json for a before/after comparison (fusion models are not retrained, so not included).

Loads the models train.py saved (models/*.joblib, cnn.pt; trained on cars 0-7) and, if train_fusion.py has run,
the fusion models (models/fusion). Every condition is generated fresh on the held-out cars 8-9, sweeping ONE
factor at a time with the others at train.py's defaults: background noise (CarProfile.noise x1..x20), fault
severity band, rpm band, coolant temperature, and sensor gain (-10/0/+10 dB on every sensor).
12 windows per class per car per condition (--quick: 4), fixed seeds. Writes models/robustness.json.
"""
import dataclasses
import json
import sys
import time
from pathlib import Path

import joblib
import numpy as np
from sklearn.metrics import accuracy_score, f1_score

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
from autopulse import fusion  # noqa: E402
from autopulse.generator import ENGINE_FAULTS, make_car, synth_window  # noqa: E402
from autopulse.models import HAS_TORCH, cnn_proba, make_cnn  # noqa: E402
from autopulse.signatures import features, stft_image  # noqa: E402

MODELS = ROOT / "models"
TEST_CARS = (8, 9)
DEFAULT = {"noise": 1.0, "sev": (0.4, 1.0), "rpm": (750, 4000), "coolant": "mixed", "gain_db": 0.0}
SWEEPS = {   # factor -> {condition label: override}
    "noise": {f"noise x{k}": {"noise": float(k)} for k in (1, 2, 5, 10, 20)},
    "severity": {"severity 0.1-0.3": {"sev": (0.1, 0.3)}, "severity 0.3-0.6": {"sev": (0.3, 0.6)},
                 "severity 0.6-1.0": {"sev": (0.6, 1.0)}},
    "rpm": {"rpm 750-2000": {"rpm": (750, 2000)}, "rpm 2000-4000": {"rpm": (2000, 4000)},
            "rpm 4000-6000": {"rpm": (4000, 6000)}},
    "coolant": {"cold 10-45 °C": {"coolant": "cold"}, "warm 80-95 °C": {"coolant": "warm"}},
    "gain": {"gain -10 dB": {"gain_db": -10.0}, "gain 0 dB": {"gain_db": 0.0}, "gain +10 dB": {"gain_db": 10.0}},
}
CAVEATS = ("Simulator only: test cars 8-9 come from the same generator as the training cars, so this measures "
           "sensitivity to each factor inside our own physics model, not real-world robustness. rpm 4000-6000 is "
           "outside the training range (750-4000). Each cell is one seed of 168 windows: re-running the SVM on 5 "
           "other seeds moved macro F1 by about +-0.03 (sd), up to +-0.08 for a single seed.")


def coolant(rng, mode):
    if mode == "cold":
        return rng.uniform(10, 45)
    if mode == "warm":
        return rng.uniform(80, 95)
    return rng.choice([rng.uniform(10, 45), rng.uniform(80, 95)], p=[0.25, 0.75])   # train.py's mix


def build(cond, seed, per_class):
    """One condition on the test cars: accel features, spectrograms, fused features (when fusion is used), labels."""
    rng = np.random.default_rng(seed)
    g = 10 ** (cond["gain_db"] / 20)
    X, S, F, y = [], [], [], []
    for car_id in TEST_CARS:
        base = make_car(car_id)
        car = dataclasses.replace(base, noise=base.noise * cond["noise"])     # noise multiplier on CarProfile.noise
        for label, fault in enumerate(ENGINE_FAULTS):
            for _ in range(per_class):
                w = synth_window(fault, rpm=rng.uniform(*cond["rpm"]), car=car, severity=rng.uniform(*cond["sev"]),
                                 coolant_c=coolant(rng, cond["coolant"]), age=rng.uniform(0, 1),
                                 misfire_cyl=int(rng.integers(0, 4)), rng=rng)
                acc, mic = w["accel"] * g, w["mic"] * g                         # sensor gain on every sensor
                X.append(features(acc, w["fs"], w["rpm"], w["crank_speed"]))
                S.append(stft_image(acc, w["fs"])[2])
                if FUSION:
                    F.append(fusion.fused_features(mic, acc, w["fs"], w["obd"], w["crank_speed"]))
                y.append(label)
    return np.array(X), np.array(S, dtype=np.float32), (np.array(F) if F else None), np.array(y)


def load_models():
    m = {"SVM": joblib.load(MODELS / "svm.joblib"), "Softmax": joblib.load(MODELS / "softmax.joblib"),
         "ANN": joblib.load(MODELS / "ann.joblib")}
    if HAS_TORCH and (MODELS / "cnn.pt").exists():
        import torch
        cnn = make_cnn(len(ENGINE_FAULTS))
        cnn.load_state_dict(torch.load(MODELS / "cnn.pt", weights_only=True))
        m["CNN"] = cnn.eval()
    return m


def train_randomized():
    """train.py's recipe (cars 0-7, 30 windows per class per car, seed 1) on randomize=True windows."""
    from autopulse.models import feature_models, train_cnn
    rng = np.random.default_rng(1)
    X, S, y = [], [], []
    for car_id in range(8):
        car = make_car(car_id)
        for label, fault in enumerate(ENGINE_FAULTS):
            for _ in range(30):
                w = synth_window(fault, car=car, coolant_c=coolant(rng, "mixed"), age=rng.uniform(0, 1),
                                 misfire_cyl=int(rng.integers(0, 4)), rng=rng, randomize=True)
                X.append(features(w["accel"], w["fs"], w["rpm"], w["crank_speed"]))
                S.append(stft_image(w["accel"], w["fs"])[2])
                y.append(label)
    X, S, y = np.array(X), np.array(S, dtype=np.float32), np.array(y)
    names = {"SVM (RBF)": "SVM", "Softmax regression": "Softmax", "ANN (MLP + softmax)": "ANN"}
    m = {names[n]: mm.fit(X, y) for n, mm in feature_models().items()}
    if HAS_TORCH:
        m["CNN"] = train_cnn(S, y, len(ENGINE_FAULTS))
    return m


def predict(name, model, X, S, F):
    if name == "CNN":
        return cnn_proba(model, S)
    if name.startswith("Fused"):
        return model.predict_proba(F)
    if name == "Late fusion":
        per = {k: mm.predict_proba(F[:, fusion.MODALITIES[k]]) for k, mm in model["per_modality"].items()}
        return fusion.late_fusion(per, model["stacker"])
    return model.predict_proba(X)


def metrics(y, P):
    pred = P.argmax(1)
    h, mis = ENGINE_FAULTS.index("healthy"), ENGINE_FAULTS.index("misfire")
    return {"accuracy": float(accuracy_score(y, pred)), "macro_f1": float(f1_score(y, pred, average="macro")),
            "misfire_recall": float(np.mean(pred[y == mis] == mis)),
            "healthy_fpr": float(np.mean(pred[y == h] != h))}


RANDOMIZED = "--randomized" in sys.argv
FUSION = None if RANDOMIZED else fusion.load_fusion()

if __name__ == "__main__":
    quick = "--quick" in sys.argv
    per_class = 4 if quick else 12
    t0 = time.time()
    models = train_randomized() if RANDOMIZED else load_models()
    if FUSION:
        models.update(FUSION["models"])
        models["Late fusion"] = {"per_modality": FUSION["per_modality"],
                                 "stacker": joblib.load(fusion.DIR / FUSION["meta"]["stacker"])}
    results, conditions = {n: {} for n in models}, []
    seed = 100
    for factor, conds in SWEEPS.items():
        for label, override in conds.items():
            seed += 1
            X, S, F, y = build({**DEFAULT, **override}, seed, per_class)
            conditions.append({"label": label, "factor": factor, "n": int(len(y)),
                               **{k: v for k, v in override.items()}})
            for n, m in models.items():
                results[n][label] = metrics(y, predict(n, m, X, S, F))
            print(f"  {label:18s} n={len(y):4d}  " + "  ".join(f"{n} {results[n][label]['macro_f1']:.2f}" for n in models),
                  flush=True)
    out = {"source": "simulator", "caveats": CAVEATS, "quick": quick, "test_cars": list(TEST_CARS),
           "windows_per_class_per_car": per_class, "defaults": {**DEFAULT, "coolant": "25% cold 10-45 °C, 75% warm 80-95 °C"},
           "models_from": ("SVM / Softmax / ANN / CNN trained like train.py (cars 0-7) on domain-randomised windows"
                           if RANDOMIZED else "models/*.joblib + cnn.pt (train.py, cars 0-7)"
                           + (" and models/fusion (train_fusion.py)" if FUSION else "")),
           "randomized_training": RANDOMIZED,
           "metrics": ["accuracy", "macro_f1", "misfire_recall", "healthy_fpr"],
           "conditions": conditions, "results": results}
    name = ("quick/" if quick else "") + ("robustness_randomized.json" if RANDOMIZED else "robustness.json")
    (MODELS / name).parent.mkdir(parents=True, exist_ok=True)
    (MODELS / name).write_text(json.dumps(out, indent=2))

    labels = [c["label"] for c in conditions]
    print(f"\nmacro F1 (simulator, test cars 8-9, {per_class} windows/class/car)")
    print(f"{'model':12s}" + "".join(f"{lab.replace('severity ', 'sev ').replace(' °C', ''):>15s}" for lab in labels))
    for n in models:
        print(f"{n:12s}" + "".join(f"{results[n][lab]['macro_f1']:15.2f}" for lab in labels))
    print(f"\nwrote models/{name} in {time.time() - t0:.0f}s")
