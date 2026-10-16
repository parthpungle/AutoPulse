"""Generate a synthetic multi-car dataset, train SVM / Softmax / ANN / CNN, save models + metrics.

Train/test split is by CAR (cars 0-7 train, cars 8-9 test), so models are scored on
engines they have never heard, not on overlapping windows of the same recording.
"""
import json
import sys
import time
from pathlib import Path

import joblib
import numpy as np
from sklearn.metrics import accuracy_score, confusion_matrix, f1_score

from autopulse.generator import ENGINE_FAULTS, TRAIN_RPM_RANGE, make_car, synth_window
from autopulse.models import HAS_TORCH, cnn_proba, feature_models, train_cnn
from autopulse.signatures import FEATURE_NAMES, features, stft_image

QUICK = "--quick" in sys.argv   # smoke run: 6 windows per class per car, CNN 3 epochs, written to models/quick/
OUT = Path(__file__).parent / "models" / ("quick" if QUICK else "")
TRAIN_CARS, TEST_CARS = range(0, 8), range(8, 10)
PER_CLASS_PER_CAR = 6 if QUICK else 30


def build(cars, seed):
    rng = np.random.default_rng(seed)
    X, S, y = [], [], []
    for car_id in cars:
        car = make_car(car_id)
        for label, fault in enumerate(ENGINE_FAULTS):
            for _ in range(PER_CLASS_PER_CAR):
                w = synth_window(
                    fault, rpm=rng.uniform(*TRAIN_RPM_RANGE), car=car,
                    severity=rng.uniform(0.4, 1.0),
                    coolant_c=rng.choice([rng.uniform(10, 45), rng.uniform(80, 95)], p=[0.25, 0.75]),
                    age=rng.uniform(0, 1), misfire_cyl=int(rng.integers(0, 4)), rng=rng)
                X.append(features(w["signal"], w["fs"], w["rpm"], w["crank_speed"]))
                S.append(stft_image(w["signal"], w["fs"])[2])
                y.append(label)
    return np.array(X), np.array(S, dtype=np.float32), np.array(y)


def main():
    OUT.mkdir(parents=True, exist_ok=True)
    t0 = time.time()
    Xtr, Str, ytr = build(TRAIN_CARS, seed=1)
    Xte, Ste, yte = build(TEST_CARS, seed=2)
    print(f"dataset: train {len(ytr)} / test {len(yte)} windows in {time.time() - t0:.0f}s")

    metrics = {"classes": ENGINE_FAULTS, "features": FEATURE_NAMES, "models": {},
               "n_train": int(len(ytr)), "n_test": int(len(yte)),
               "split": "by car: cars 0-7 train, cars 8-9 test"}

    for name, model in feature_models().items():
        model.fit(Xtr, ytr)
        pred = model.predict(Xte)
        metrics["models"][name] = _score(yte, pred)
        joblib.dump(model, OUT / f"{_slug(name)}.joblib")
        print(f"{name:22s} acc={metrics['models'][name]['accuracy']:.3f} "
              f"f1={metrics['models'][name]['macro_f1']:.3f}")

    if HAS_TORCH:
        import torch
        cnn = train_cnn(Str, ytr, len(ENGINE_FAULTS), **({"epochs": 3} if QUICK else {}))
        pred = cnn_proba(cnn, Ste).argmax(1)
        metrics["models"]["CNN (spectrogram)"] = _score(yte, pred)
        torch.save(cnn.state_dict(), OUT / "cnn.pt")
        print(f"{'CNN (spectrogram)':22s} acc={metrics['models']['CNN (spectrogram)']['accuracy']:.3f} "
              f"f1={metrics['models']['CNN (spectrogram)']['macro_f1']:.3f}")
    else:
        print("PyTorch not installed - skipping CNN (install torch and re-run to add it)")

    # healthy population statistics = the "population prior" for the adaptive baseline
    healthy = Xtr[ytr == 0]
    np.savez(OUT / "population_prior.npz", mean=healthy.mean(0), std=healthy.std(0) + 1e-6)
    (OUT / "metrics.json").write_text(json.dumps(metrics, indent=2))
    print(f"done in {time.time() - t0:.0f}s -> {OUT}")


def _score(y, pred):
    return {"accuracy": float(accuracy_score(y, pred)),
            "macro_f1": float(f1_score(y, pred, average="macro")),
            "confusion": confusion_matrix(y, pred, labels=range(len(ENGINE_FAULTS))).tolist()}


def _slug(name):
    return name.split(" ")[0].lower()


if __name__ == "__main__":
    main()
