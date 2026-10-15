"""Use the MATLAB outputs inside the Python pipeline.

    .venv\\Scripts\\python scripts\\matlab_crosscheck.py crank   (after: matlab -batch crank_sim)
    .venv\\Scripts\\python scripts\\matlab_crosscheck.py export  (writes real audio windows for MATLAB)
    .venv\\Scripts\\python scripts\\matlab_crosscheck.py dsp     (after: matlab -batch signature_check)

crank  Misfire detection on MATLAB's crankshaft simulation (an independent simulator):
       a detector trained only on our Python generator is tested on MATLAB data, and the
       misfiring cylinder is identified from crank physics with no training at all.
dsp    Our Python signature features are recomputed independently in MATLAB on real engine
       recordings and compared feature by feature.
Results are merged into models/matlab_crosscheck.json.
"""
import json
import sys
from pathlib import Path

import numpy as np
import pandas as pd
from scipy.io import loadmat, savemat
from sklearn.linear_model import LogisticRegression
from sklearn.metrics import accuracy_score, confusion_matrix

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
from autopulse.generator import make_car, synth_window  # noqa: E402
from autopulse.signatures import FEATURE_NAMES, features  # noqa: E402

MAT = ROOT / "matlab" / "out"
OUT = ROOT / "models" / "matlab_crosscheck.json"


def crank_feats(speed):
    s = np.asarray(speed, float)
    return [np.std(s) / np.mean(s) * 100, (np.mean(s) - s.min()) / np.mean(s) * 100]


def crank():
    d = pd.read_csv(MAT / "crank_runs.csv")
    runs = []
    for run, g in d.groupby("run"):
        g = g.sort_values("firing_idx")
        sp = g.speed_rpm.to_numpy()
        # speed gained across each cylinder's own power stroke (tooth-wheel speed at TDC and 180 deg later)
        dv = pd.Series((g.end_rpm - g.start_rpm).to_numpy(), index=g.cylinder.to_numpy())
        per_cyl = dv.groupby(level=0).mean()
        runs.append({"run": run, "rpm": g.rpm_target.iloc[0], "misfire_cyl": int(g.misfire_cyl.iloc[0]),
                     "severity": float(g.severity.iloc[0]), "feats": crank_feats(sp),
                     "worst_cyl": int(per_cyl.idxmin()),
                     "worst_z": float((per_cyl.min() - per_cyl.drop(per_cyl.idxmin()).mean())
                                      / (dv.std() + 1e-9))})

    # detector trained ONLY on our Python generator (crank-speed features), tested on MATLAB physics
    rng = np.random.default_rng(3)
    Xs, ys = [], []
    for car_id in range(8):
        car = make_car(car_id)
        for fault in ("healthy", "misfire"):
            for _ in range(60):
                w = synth_window(fault, rpm=rng.uniform(750, 3800), car=car, severity=rng.uniform(0.4, 1.0),
                                 misfire_cyl=int(rng.integers(0, 4)), rng=rng, dur=1.0)
                Xs.append(crank_feats(w["crank_speed"]))
                ys.append(int(fault == "misfire"))
    det = LogisticRegression().fit(np.log(np.array(Xs) + 1e-3), ys)
    Xm = np.log(np.array([r["feats"] for r in runs]) + 1e-3)
    ym = np.array([int(r["misfire_cyl"] > 0) for r in runs])
    pred = det.predict(Xm)

    mis = [r for r in runs if r["misfire_cyl"] > 0]
    cyl_acc = float(np.mean([r["worst_cyl"] == r["misfire_cyl"] for r in mis]))
    by_rpm = {int(rpm): float(np.mean([r["worst_cyl"] == r["misfire_cyl"] for r in mis if r["rpm"] == rpm]))
              for rpm in sorted({r["rpm"] for r in mis})}
    healthy_z = [r["worst_z"] for r in runs if r["misfire_cyl"] == 0]
    mis_z = [r["worst_z"] for r in mis]
    res = {"source": "matlab/crank_sim.m (ode45 crankshaft dynamics, 4-cyl, firing order 1-3-4-2)",
           "runs": len(runs), "firing_events": int(len(d)),
           "detector_trained_on_python_sim": {
               "accuracy": float(accuracy_score(ym, pred)),
               "confusion_[healthy,misfire]": confusion_matrix(ym, pred, labels=[0, 1]).tolist()},
           "cylinder_identification_accuracy": cyl_acc, "cylinder_identification_by_rpm": by_rpm,
           "worst_cylinder_z": {"healthy_median": float(np.median(healthy_z)), "misfire_median": float(np.median(mis_z))}}
    print(json.dumps(res, indent=2))
    return res


def export():
    """Write a sample of real engine-audio windows (same preprocessing as Python) for MATLAB."""
    from autopulse.realdata import estimate_rpm, load_engine_audio
    wins = load_engine_audio()
    rng = np.random.default_rng(0)
    pick = rng.choice(len(wins), size=60, replace=False)
    X = np.stack([wins[i]["signal"] for i in pick]).astype(np.float64)
    rpm = np.array([estimate_rpm(wins[i]["signal"], wins[i]["fs"]) for i in pick])
    py = np.stack([features(wins[i]["signal"], wins[i]["fs"], r) for i, r in zip(pick, rpm)])
    MAT.mkdir(parents=True, exist_ok=True)
    savemat(MAT / "audio_windows.mat", {"X": X, "fs": float(wins[0]["fs"]), "rpm": rpm,
                                        "py_features": py, "feature_names": np.array(FEATURE_NAMES, dtype=object)})
    print(f"wrote {len(pick)} real audio windows to matlab/out/audio_windows.mat")


COMPARE = ["log_rms", "crest_factor", "kurtosis", "skewness", "zero_cross_rate",
           "band_20_200", "band_200_500", "band_500_1000", "band_1000_2000", "band_2000_3000", "band_3000_4000",
           "band_4000_5000", "band_5000_6000", "band_6000_7500", "band_7500_10000",
           "order_0.5", "order_1.0", "order_1.5", "order_2.0", "order_3.0", "order_4.0",
           "spectral_centroid_khz", "spectral_flatness"]


def dsp():
    m = loadmat(MAT / "matlab_features.mat")
    ml = m["F"]
    py = loadmat(MAT / "audio_windows.mat")["py_features"]
    rows = []
    for j, name in enumerate(COMPARE):
        a, b = py[:, FEATURE_NAMES.index(name)], ml[:, j]
        scale = np.abs(a).mean() + 1e-12
        rows.append({"feature": name, "max_abs_diff": float(np.max(np.abs(a - b))),
                     "max_rel_diff": float(np.max(np.abs(a - b)) / scale),
                     "correlation": float(np.corrcoef(a, b)[0, 1]) if np.std(a) > 0 else 1.0})
    worst = max(rows, key=lambda r: r["max_rel_diff"])
    res = {"source": "matlab/signature_check.m (base MATLAB re-implementation)", "windows": int(py.shape[0]),
           "features_compared": len(rows), "worst_feature": worst["feature"],
           "worst_max_rel_diff": worst["max_rel_diff"],
           "min_correlation": float(min(r["correlation"] for r in rows)), "per_feature": rows}
    print(f"{len(rows)} features on {py.shape[0]} real windows: worst relative difference "
          f"{worst['max_rel_diff']:.2e} ({worst['feature']}), min correlation {res['min_correlation']:.6f}")
    return res


if __name__ == "__main__":
    out = json.loads(OUT.read_text()) if OUT.exists() else {}
    for step in sys.argv[1:]:
        if step == "export":
            export()
        else:
            out[step] = {"crank": crank, "dsp": dsp}[step]()
            OUT.write_text(json.dumps(out, indent=2))
