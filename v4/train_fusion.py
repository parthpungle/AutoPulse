"""Multivariable fusion ablation on the SIMULATOR: microphone, accelerometer, OBD context, and their fusions.

    .venv\\Scripts\\python train_fusion.py

Split by car like train.py (cars 0-7 train, cars 8-9 test). Each configuration is trained once on the training
cars and scored on the test cars under three conditions: the training noise (x1), five times the background
noise on both sensors (x5), and weak faults (severity 0.1-0.3). Late fusion stacks per-modality SVM
probabilities with a logistic regression learned on out-of-fold predictions (grouped by car) of the training
cars only. The live model is fixed in advance (mic+accel+obd SVM), not picked from these test scores.
Writes models/fusion/*.joblib + meta.json and models/fusion_metrics.json (source "simulator").
"""
import json
import sys
import time
from pathlib import Path

import joblib
import numpy as np
from sklearn.base import clone
from sklearn.linear_model import LogisticRegression
from sklearn.metrics import accuracy_score, confusion_matrix, f1_score
from sklearn.model_selection import GroupKFold

from autopulse import fusion
from autopulse.generator import ENGINE_FAULTS, TRAIN_RPM_RANGE, make_car, synth_window
from autopulse.models import feature_models

QUICK = "--quick" in sys.argv   # smoke run: 6 windows per class per car, written to models/quick/
OUT = Path(__file__).parent / "models" / ("quick" if QUICK else "")
TRAIN_CARS, TEST_CARS = range(0, 8), range(8, 10)
PER_CLASS_PER_CAR = 6 if QUICK else 30
if QUICK:
    fusion.DIR = OUT / "fusion"
CONDITIONS = {"noise_x1": {"noise_scale": 1.0, "sev": (0.4, 1.0), "seed": 2},
              "noise_x5": {"noise_scale": 5.0, "sev": (0.4, 1.0), "seed": 3},
              "severity_0.1-0.3": {"noise_scale": 1.0, "sev": (0.1, 0.3), "seed": 4}}
M = fusion.MODALITIES
CONFIGS = {"mic": [M["mic"]], "accel": [M["accel"]], "obd": [M["obd"]],
           "mic+accel": [M["mic"], M["accel"]], "mic+accel+obd": [M["mic"], M["accel"], M["obd"]]}
LEARNERS = ["SVM (RBF)", "ANN (MLP + softmax)"]
CAVEATS = ("Simulator evidence only: the generator, both sensor paths and the OBD effects were written by us, and the "
           "same code generates training and test cars, so these are upper bounds, not real-world accuracy. The mic "
           "and OBD channels are models of physics, not recordings; no real multi-sensor dataset was used.")


def build(cars, seed, noise_scale=1.0, sev=(0.4, 1.0)):
    """Same sampling as train.py.build, returning fused features (mic + accel + obd)."""
    rng = np.random.default_rng(seed)
    X, y, g = [], [], []
    for car_id in cars:
        car = make_car(car_id)
        for label, fault in enumerate(ENGINE_FAULTS):
            for _ in range(PER_CLASS_PER_CAR):
                w = synth_window(fault, rpm=rng.uniform(*TRAIN_RPM_RANGE), car=car, severity=rng.uniform(*sev),
                                 coolant_c=rng.choice([rng.uniform(10, 45), rng.uniform(80, 95)], p=[0.25, 0.75]),
                                 age=rng.uniform(0, 1), misfire_cyl=int(rng.integers(0, 4)), rng=rng,
                                 noise_scale=noise_scale)
                X.append(fusion.fused_features(w["mic"], w["accel"], w["fs"], w["obd"], w["crank_speed"]))
                y.append(label)
                g.append(car_id)
    return np.array(X), np.array(y), np.array(g)


def cols(X, slices):
    return np.hstack([X[:, s] for s in slices])


def score(y, P):
    pred = P.argmax(1)
    return {"accuracy": float(accuracy_score(y, pred)), "macro_f1": float(f1_score(y, pred, average="macro")),
            "recall": {c: float(np.mean(pred[y == i] == i)) for i, c in enumerate(ENGINE_FAULTS)},
            "confusion": confusion_matrix(y, pred, labels=range(len(ENGINE_FAULTS))).tolist()}


def main():
    t0 = time.time()
    Xtr, ytr, gtr = build(TRAIN_CARS, seed=1)
    tests = {c: build(TEST_CARS, seed=p["seed"], noise_scale=p["noise_scale"], sev=p["sev"]) for c, p in CONDITIONS.items()}
    print(f"dataset: train {len(ytr)}, test {len(next(iter(tests.values()))[1])} per condition, "
          f"{len(fusion.FEATURE_NAMES)} fused features, {time.time() - t0:.0f}s")

    results, fitted = {}, {}
    for cfg, slices in CONFIGS.items():
        for learner in LEARNERS:
            model = clone(feature_models()[learner]).fit(cols(Xtr, slices), ytr)
            fitted[(cfg, learner)] = model
            name = f"{cfg} · {learner.split(' (')[0]}"
            results[name] = {c: score(yte, model.predict_proba(cols(Xte, slices))) for c, (Xte, yte, _) in tests.items()}

    # late fusion: per-modality SVMs, stacked by a logistic regression fitted on out-of-fold training probabilities
    svm = feature_models()["SVM (RBF)"]
    oof = {m: np.zeros((len(ytr), len(ENGINE_FAULTS))) for m in M}
    for tr, va in GroupKFold(4).split(Xtr, ytr, gtr):
        for m, s in M.items():
            oof[m][va] = clone(svm).fit(Xtr[tr][:, s], ytr[tr]).predict_proba(Xtr[va][:, s])
    stacker = LogisticRegression(max_iter=3000, C=1.0).fit(np.hstack([oof[m] for m in M]), ytr)
    per_mod = {m: fitted[(m, "SVM (RBF)")] for m in M}
    results["late fusion · SVM per modality + LR stacker"] = {
        c: score(yte, fusion.late_fusion({m: per_mod[m].predict_proba(Xte[:, s]) for m, s in M.items()}, stacker))
        for c, (Xte, yte, _) in tests.items()}

    # save the live models: the fused SVM (chosen in advance) + per-modality SVMs (for modality_contrib)
    d = fusion.DIR
    d.mkdir(parents=True, exist_ok=True)
    OUT.mkdir(parents=True, exist_ok=True)
    joblib.dump(fitted[("mic+accel+obd", "SVM (RBF)")], d / "fused_svm.joblib")
    joblib.dump(fitted[("mic+accel+obd", "ANN (MLP + softmax)")], d / "fused_ann.joblib")
    for m in M:
        joblib.dump(per_mod[m], d / f"{m}_svm.joblib")
    joblib.dump(stacker, d / "late_stacker.joblib")
    meta = {"source": "simulator", "classes": ENGINE_FAULTS, "feature_names": fusion.FEATURE_NAMES,
            "live_model": "fused_svm.joblib", "live_model_name": "mic+accel+obd SVM (feature fusion)",
            "live_models": {"Fused SVM": "fused_svm.joblib", "Fused ANN": "fused_ann.joblib"},
            "per_modality": {m: f"{m}_svm.joblib" for m in M}, "stacker": "late_stacker.joblib",
            "trained_on": "simulated cars 0-7", "n_train": int(len(ytr))}
    (d / "meta.json").write_text(json.dumps(meta, indent=2))

    out = {"source": "simulator", "caveats": CAVEATS, "classes": ENGINE_FAULTS,
           "split": "by car: cars 0-7 train, cars 8-9 test (as train.py)", "n_train": int(len(ytr)),
           "n_test_per_condition": int(len(next(iter(tests.values()))[1])),
           "conditions": {c: {k: v for k, v in p.items() if k != "seed"} for c, p in CONDITIONS.items()},
           "late_fusion": "per-modality SVM probabilities -> logistic regression fitted on 4-fold out-of-fold "
                          "probabilities grouped by training car", "live_model": meta["live_model_name"],
           "results": results}
    (OUT / "fusion_metrics.json").write_text(json.dumps(out, indent=2))

    print(f"\n{'configuration':46s}" + "".join(f"{c:>20s}" for c in CONDITIONS) + "   (macro F1, simulator)")
    for name, r in results.items():
        print(f"{name:46s}" + "".join(f"{r[c]['macro_f1']:20.3f}" for c in CONDITIONS))
    print(f"\nsaved models/fusion/ and models/fusion_metrics.json in {time.time() - t0:.0f}s")


if __name__ == "__main__":
    main()
