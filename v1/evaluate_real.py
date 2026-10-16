"""Real-data train/test: every score here comes from real recordings, never from the simulator.

    .venv\\Scripts\\python evaluate_real.py [audio cwru condition obd]

  audio      real engine sound (HF, 4 classes)       5-fold CV grouped by recording
  cwru       real bearing vibration (CWRU, 4 classes) leave-one-motor-load-out
  condition  real engine telemetry table (HF, good/faulty) stratified 5-fold CV + healthy-only anomaly model
  obd        real healthy driving (carOBD)           adaptive vs static baseline: false alarms on held-out trips,
                                                     detection of faults injected into those real trips
Writes models/real_metrics.json.
"""
import copy
import json
import sys
import time
from pathlib import Path

import numpy as np
import pandas as pd
from sklearn.ensemble import HistGradientBoostingClassifier, IsolationForest
from sklearn.metrics import accuracy_score, confusion_matrix, f1_score, roc_auc_score
from sklearn.model_selection import StratifiedGroupKFold, StratifiedKFold

from autopulse.baseline import AdaptiveBaseline, StaticBaseline
from autopulse.generator import ENGINE_FAULTS, make_car, synth_window
from autopulse.models import HAS_TORCH, cnn_proba, feature_models, train_cnn
from autopulse.realdata import estimate_rpm, load_carobd, load_cwru, load_engine_audio, load_engine_condition
from autopulse.signatures import features, stft_image

OUT = Path(__file__).parent / "models" / "real_metrics.json"


def summarize(scores):
    a = np.array(scores)
    return {"mean": float(a.mean()), "std": float(a.std())}


def cv_signature_models(X, S, y, groups, folds, classes, use_cnn=True):
    """Train/test every model on each fold; returns per-model metrics + pooled confusion matrices."""
    res = {}
    names = list(feature_models()) + (["CNN (spectrogram)"] if use_cnn and HAS_TORCH else [])
    pooled = {n: (np.zeros(len(y), int), np.zeros((len(y), len(classes)))) for n in names}
    acc = {n: [] for n in names}
    f1 = {n: [] for n in names}
    for tr, te in folds:
        for name, model in feature_models().items():
            model.fit(X[tr], y[tr])
            p = model.predict_proba(X[te])
            pooled[name][1][te] = p
        if "CNN (spectrogram)" in names:
            cnn = train_cnn(S[tr], y[tr], len(classes), epochs=20)
            pooled["CNN (spectrogram)"][1][te] = cnn_proba(cnn, S[te])
        for n in names:
            pred = pooled[n][1][te].argmax(1)
            acc[n].append(accuracy_score(y[te], pred))
            f1[n].append(f1_score(y[te], pred, average="macro"))
    for n in names:
        pred = pooled[n][1].argmax(1)
        res[n] = {"accuracy": summarize(acc[n]), "macro_f1": summarize(f1[n]),
                  "confusion": confusion_matrix(y, pred, labels=range(len(classes))).tolist()}
        if groups is not None:  # recording-level verdict: average the window probabilities per recording
            g = pd.DataFrame(pooled[n][1]).groupby(groups).mean()
            truth = pd.Series(y).groupby(groups).first().loc[g.index]
            res[n]["recording_accuracy"] = float(accuracy_score(truth, g.to_numpy().argmax(1)))
    return res


# ------------------------------------------------------------------ 1. real engine audio
def eval_audio():
    t0 = time.time()
    wins = load_engine_audio()
    classes = ["healthy", "misfire", "valve_tick", "belt_squeal"]
    y = np.array([classes.index(w["label"]) for w in wins])
    clips = np.array([w["clip"] for w in wins])
    rpms = np.array([estimate_rpm(w["signal"], w["fs"]) for w in wins])
    X = np.array([features(w["signal"], w["fs"], r) for w, r in zip(wins, rpms)])
    S = np.array([stft_image(w["signal"], w["fs"])[2] for w in wins], dtype=np.float32)
    print(f"audio: {len(wins)} windows from {len(set(clips))} recordings, features in {time.time() - t0:.0f}s; "
          f"estimated rpm median {np.median(rpms):.0f}")
    folds = list(StratifiedGroupKFold(5, shuffle=True, random_state=0).split(X, y, clips))
    res = cv_signature_models(X, S, y, clips, folds, classes)

    # zero-shot: trained only on our simulator, tested on real sound (measures the sim-to-real gap)
    rng = np.random.default_rng(5)
    Xs, ys = [], []
    for car_id in range(8):
        car = make_car(car_id)
        for k, fault in enumerate(classes):
            for _ in range(30):
                w = synth_window(fault, rpm=rng.uniform(700, 3000), car=car, severity=rng.uniform(0.4, 1),
                                 coolant_c=rng.choice([30.0, 90.0]), age=rng.uniform(0, 1), rng=rng)
                Xs.append(features(w["signal"], w["fs"], w["rpm"]))
                ys.append(k)
    zero = {}
    for name, model in feature_models().items():
        model.fit(np.array(Xs), np.array(ys))
        pred = model.predict(X)
        zero[name] = {"accuracy": float(accuracy_score(y, pred)), "macro_f1": float(f1_score(y, pred, average="macro"))}
    return {"dataset": "Hugging Face RashmiKarunarathne/MyDataSet (real engine recordings, 48 kHz)",
            "classes": classes, "n_windows": int(len(y)), "n_recordings": int(len(set(clips))),
            "class_recordings": {c: int(len({cl for cl, yy in zip(clips, y) if yy == i})) for i, c in enumerate(classes)},
            "split": "5-fold cross-validation grouped by recording (no recording in both train and test)",
            "models": res, "zero_shot_from_simulator": zero}


# ------------------------------------------------------------------ 2. CWRU real bearing vibration
def eval_cwru():
    wins = load_cwru()
    classes = ["normal", "inner", "ball", "outer"]
    y = np.array([classes.index(w["label"]) for w in wins])
    loads = np.array([w["load"] for w in wins])
    X = np.array([features(w["signal"], w["fs"], w["rpm"]) for w in wins])
    S = np.array([stft_image(w["signal"], w["fs"])[2] for w in wins], dtype=np.float32)
    folds = [(np.where(loads != L)[0], np.where(loads == L)[0]) for L in range(4)]
    print(f"cwru: {len(wins)} windows, leave-one-load-out")
    res = cv_signature_models(X, S, y, None, folds, classes)
    return {"dataset": "CWRU bearing data center, 12 kHz drive end, faults 0.007\" and 0.021\"",
            "classes": classes, "n_windows": int(len(y)),
            "split": "leave-one-motor-load-out: train on 3 loads, test on the 4th, all 4 rotations averaged",
            "models": res}


# ------------------------------------------------------------------ 3. engine condition telemetry
def eval_condition():
    d = load_engine_condition()
    X, y = d.drop(columns="condition").to_numpy(), d.condition.to_numpy()
    models = feature_models()
    models["Gradient boosting (reference)"] = HistGradientBoostingClassifier(random_state=0)
    res = {}
    skf = StratifiedKFold(5, shuffle=True, random_state=0)
    for name, model in models.items():
        acc, f1 = [], []
        for tr, te in skf.split(X, y):
            model.fit(X[tr], y[tr])
            pred = model.predict(X[te])
            acc.append(accuracy_score(y[te], pred))
            f1.append(f1_score(y[te], pred, average="macro"))
        res[name] = {"accuracy": summarize(acc), "macro_f1": summarize(f1)}
    aucs = []
    for tr, te in skf.split(X, y):  # anomaly model sees only healthy rows in training
        iso = IsolationForest(random_state=0).fit(X[tr][y[tr] == 0])
        aucs.append(roc_auc_score(y[te], -iso.score_samples(X[te])))
    majority = max(np.mean(y), 1 - np.mean(y))
    print(f"condition: {len(y)} rows")
    return {"dataset": "Hugging Face dhani10/engine-condition-dataset (6 engine sensors, 0=normal 1=faulty)",
            "n_rows": int(len(y)), "majority_class_accuracy": float(majority),
            "split": "stratified 5-fold cross-validation", "models": res,
            "healthy_only_anomaly_auc": summarize(aucs)}


# ------------------------------------------------------------------ 4. carOBD: adaptive baseline on real driving
OBD_FEATS = ["ltft_pct", "stft_mean", "stft_std", "map_kpa", "battery_v", "timing_deg", "cat_c", "iat_c"]
WIN_S = 30


def obd_windows(trip):
    rows = []
    for s in range(0, len(trip) - WIN_S + 1, WIN_S):
        w = trip.iloc[s:s + WIN_S]
        rows.append({"ltft_pct": w.ltft_pct.mean(), "stft_mean": w.stft_pct.mean(), "stft_std": w.stft_pct.std(),
                     "map_kpa": w.map_kpa.mean(), "battery_v": w.battery_v.mean(), "timing_deg": w.timing_deg.mean(),
                     "cat_c": w.cat_c.mean(), "iat_c": w.iat_c.mean(), "coolant_c": w.coolant_c.mean(),
                     "rpm": w.rpm.mean(), "speed": w.speed_kph.mean(), "load": w.engine_load.mean()})
    return pd.DataFrame(rows)


def obd_context(r):
    temp = "warm" if r.coolant_c >= 75 else "cold"
    if r.speed < 3 and r.rpm < 1100:
        mode = "idle"
    else:
        mode = "cruise" if r.load < 40 else "load"
    return f"{temp}_{mode}"


FAULTS = {  # injected into real healthy trips from window `start` on, ramping in over 4 windows (2 min)
    "vacuum_leak": lambda w, k: w.assign(ltft_pct=w.ltft_pct + k * np.where(w.load < 35, 7.0, 3.5),
                                         stft_std=w.stft_std * (1 + 0.4 * k)),
    "charging_weak": lambda w, k: w.assign(battery_v=w.battery_v - 0.5 * k),
    "map_sensor_drift": lambda w, k: w.assign(map_kpa=w.map_kpa + 6.0 * k),
    "timing_retard": lambda w, k: w.assign(timing_deg=w.timing_deg - 5.0 * k),
}


PERSIST = 2  # an alarm needs 2 consecutive windows (1 minute) above threshold, for both methods


def persisted(scores, tau):
    above = np.asarray(scores) > tau
    run = np.convolve(above.astype(int), np.ones(PERSIST, int), "valid") == PERSIST
    return np.concatenate([np.zeros(PERSIST - 1, bool), run])


def trip_score(scores):
    """Highest level the score held for PERSIST windows in a row (what a threshold must exceed to stay quiet)."""
    s = np.asarray(scores)
    return float(max(s[i:i + PERSIST].min() for i in range(len(s) - PERSIST + 1)))


def run_trip(base, wins, static):
    """Stream one trip; returns per-window anomaly scores from the adaptive and the static baseline."""
    sa, ss = [], []
    for _, r in wins.iterrows():
        x = r[OBD_FEATS].to_numpy(dtype=float)
        score, _ = base.observe(x, obd_context(r))
        sa.append(score)
        ss.append(static.score(x))
    return np.array(sa), np.array(ss)


def learn(base, wins_list):
    for wins in wins_list:
        for _, r in wins.iterrows():
            base.observe(r[OBD_FEATS].to_numpy(dtype=float), obd_context(r))
    for s in base.state.values():  # history is trusted; clear alarm state before scoring new trips
        s["frozen"], s["streak"] = False, 0


def eval_obd():
    trips = load_carobd()
    names = sorted(trips)
    rng = np.random.default_rng(0)
    rng.shuffle(names)
    n_learn, n_cal = int(0.42 * len(names)), int(0.18 * len(names))
    learn_names, cal_names, test_names = names[:n_learn], names[n_learn:n_learn + n_cal], names[n_learn + n_cal:]
    learn_w = [obd_windows(trips[n]) for n in learn_names]
    Xl = pd.concat(learn_w)[OBD_FEATS].to_numpy(dtype=float)
    idx = np.arange(len(OBD_FEATS))
    prior_mean, prior_std = Xl.mean(0), Xl.std(0) + 1e-6

    cal_w = [w for w in (obd_windows(trips[n]) for n in cal_names) if len(w) >= 14]
    test = {n: obd_windows(trips[n]) for n in test_names}
    test_w = [w for w in test.values() if len(w) >= 14]

    def make_adaptive(p):
        b = AdaptiveBaseline(prior_mean, prior_std, alpha=p["alpha"], calib_n=15, threshold=np.inf, gate=2.5,
                             persist=PERSIST, score_idx=idx, top_k=p["top_k"], min_std_frac=p["min_std_frac"])
        learn(b, learn_w)
        return b

    def scores(method, model, wins):
        """Per-window scores; the adaptive model keeps learning within the trip, on a private copy."""
        if method == "adaptive":
            m = copy.deepcopy(model)
            return np.array([m.observe(r[OBD_FEATS].to_numpy(dtype=float), obd_context(r))[0]
                             for _, r in wins.iterrows()])
        return np.array([model.score(r[OBD_FEATS].to_numpy(dtype=float)) for _, r in wins.iterrows()])

    def evaluate(method, model, tau, wins_list):
        fa = [persisted(scores(method, model, w), tau).any() for w in wins_list]
        det = {}
        for fname in FAULTS:
            hits, delays = [], []
            for w in wins_list:
                after = np.where(persisted(scores(method, model, inject(w, fname)), tau)[START:])[0]
                hits.append(len(after) > 0)
                if len(after):
                    delays.append(after[0] * WIN_S / 60)
            det[fname] = {"detection_rate": float(np.mean(hits)),
                          "median_delay_min": float(np.median(delays)) if delays else None}
        return float(np.mean(fa)), det

    def calibrate(method, model):
        """Threshold: <=10% of healthy calibration trips may alarm. Returns (tau, mean detection on calibration)."""
        tau = float(np.quantile([trip_score(scores(method, model, w)) for w in cal_w], 0.9))
        _, det = evaluate(method, model, tau, cal_w)
        return tau, float(np.mean([d["detection_rate"] for d in det.values()]))

    # settings are chosen on calibration trips only; held-out test trips are scored once at the end
    grid = {"adaptive": [{"alpha": a, "top_k": k, "min_std_frac": f}
                         for a in (0.03, 0.1) for k in (2, 3) for f in (0.15, 0.3, 0.5, 0.8)],
            "static": [{"top_k": k} for k in (2, 3, 4)]}
    chosen, final = {}, {}
    for method, configs in grid.items():
        best = None
        for p in configs:
            model = make_adaptive(p) if method == "adaptive" else \
                StaticBaseline(threshold=np.inf, score_idx=idx, top_k=p["top_k"]).fit(Xl)
            tau, det_rate = calibrate(method, model)
            if best is None or det_rate > best[0]:
                best = (det_rate, p, tau, model)
        det_rate, p, tau, model = best
        if method == "adaptive":
            learn(model, cal_w)  # calibration trips are healthy history too
        fa, det = evaluate(method, model, tau, test_w)
        chosen[method] = {"settings": p, "threshold": tau, "calibration_detection": det_rate}
        final[method] = (fa, det)
        print(f"obd {method}: {p}, tau {tau:.2f}, calibration detection {det_rate:.2f}, test false-alarm {fa:.2f}")

    return {"dataset": "carOBD (Toyota Etios, real OBD-II, 1 Hz, 129 trips)",
            "learning_trips": len(learn_names), "calibration_trips": len(cal_w), "test_trips": len(test_w),
            "window_s": WIN_S, "features": OBD_FEATS, "chosen": chosen,
            "false_alarm_trip_rate": {k: v[0] for k, v in final.items()},
            "injected_fault_detection": {f: {k: final[k][1][f] for k in final} for f in FAULTS},
            "split": "42% of trips teach the baseline; 18% (calibration) choose each method's settings and set its "
                     "threshold so <=10% of healthy calibration trips alarm; 40% held out and scored once: "
                     "healthy, then with faults injected from minute 3"}


START = 6  # injected faults begin 3 minutes into the trip, ramping in over 2 minutes


def inject(w, fname):
    w2 = w.copy()
    for i in range(START, len(w2)):
        k = min((i - START + 1) / 4, 1.0)
        w2.iloc[[i]] = FAULTS[fname](w2.iloc[[i]], k)
    return w2


SUITES = {"audio": eval_audio, "cwru": eval_cwru, "condition": eval_condition, "obd": eval_obd}

if __name__ == "__main__":
    out = json.loads(OUT.read_text()) if OUT.exists() else {}
    for name in sys.argv[1:] or list(SUITES):
        t = time.time()
        out[name] = SUITES[name]()
        OUT.write_text(json.dumps(out, indent=2))
        print(f"  {name} done in {time.time() - t:.0f}s")
    for name, r in out.items():
        if "models" in r:
            print(f"\n[{name}] {r['split']}")
            for m, v in r["models"].items():
                extra = f"  recording acc {v['recording_accuracy']:.3f}" if "recording_accuracy" in v else ""
                print(f"  {m:30s} acc {v['accuracy']['mean']:.3f} ± {v['accuracy']['std']:.3f}  "
                      f"F1 {v['macro_f1']['mean']:.3f}{extra}")
        if "zero_shot_from_simulator" in r:
            print("  zero-shot from simulator:", {k: round(v["macro_f1"], 3) for k, v in r["zero_shot_from_simulator"].items()})
        if "healthy_only_anomaly_auc" in r:
            print(f"  healthy-only anomaly AUC {r['healthy_only_anomaly_auc']['mean']:.3f}; "
                  f"majority-class accuracy {r['majority_class_accuracy']:.3f}")
        if "false_alarm_trip_rate" in r:
            print(f"\n[{name}] false-alarm trips: {r['false_alarm_trip_rate']}")
            for f, v in r["injected_fault_detection"].items():
                print(f"  {f:18s} adaptive {v['adaptive']}  static {v['static']}")
