"""Real-data train/test: every score here comes from real recordings, never from the simulator.

    .venv\\Scripts\\python evaluate_real.py [audio cwru condition obd]

  audio      real engine sound (HF, 4 classes)       5-fold CV grouped by recording
  cwru       real bearing vibration (CWRU, 4 classes) leave-one-motor-load-out
  condition  real engine telemetry table (HF, good/faulty) stratified 5-fold CV + healthy-only anomaly model
  obd        real healthy driving (carOBD)           adaptive vs static baseline: false alarms on held-out trips,
                                                     detection of faults injected into those real trips
Writes models/real_metrics.json.

  transfer   sim -> real transfer (a)-(e) only, added to an existing audio result (audio also runs it)
  --quick    the transfer block on 2 of the 5 folds
"""
import copy
import json
import sys
import time
from pathlib import Path

import numpy as np
import pandas as pd
from sklearn.ensemble import HistGradientBoostingClassifier, IsolationForest
from sklearn.metrics import (accuracy_score, confusion_matrix, f1_score, precision_recall_fscore_support,
                             roc_auc_score)
from sklearn.model_selection import StratifiedGroupKFold, StratifiedKFold

from autopulse import real_audio
from autopulse.residuals import RELATIONS, RESID_FEATS, ResidualModels, add_residuals
from autopulse.baseline import AdaptiveBaseline, StaticBaseline
from autopulse.generator import ENGINE_FAULTS, make_car, synth_window
from autopulse.models import HAS_TORCH, cnn_proba, feature_models, train_cnn
from autopulse.realdata import load_carobd, load_cwru, load_engine_audio, load_engine_condition
from autopulse.signatures import features, stft_image

QUICK = "--quick" in sys.argv   # smoke run: every 4th audio recording, 2 of the 5 folds, few CNN epochs,
                                # 5 simulated windows per class; written to models/quick/real_metrics.json
OUT = Path(__file__).parent / "models" / ("quick" if QUICK else "") / "real_metrics.json"


def ep(n):
    """CNN epochs: as given, or a token 2-3 in --quick smoke runs."""
    return max(2, n // 8) if QUICK else n


def summarize(scores):
    a = np.array(scores)
    return {"mean": float(a.mean()), "std": float(a.std())}


CNN_V2 = "CNN v2 (SpecAugment, class-weighted, early stop, 3 seeds)"


def cv_signature_models(X, S, y, groups, folds, classes, use_cnn=True, return_proba=False, cnn_v2=False):
    """Train/test every model on each fold; returns per-model metrics + pooled confusion matrices
    (and, with return_proba, every window's out-of-fold probabilities per model). cnn_v2 adds the improved CNN:
    SpecAugment, class-weighted loss, early stopping on a validation split grouped like the folds (from the
    fold's training data only), and the mean of 3 seeds."""
    res = {}
    names = list(feature_models()) + (["CNN (spectrogram)"] if use_cnn and HAS_TORCH else [])         + ([CNN_V2] if cnn_v2 and use_cnn and HAS_TORCH else [])
    pooled = {n: (np.zeros(len(y), int), np.zeros((len(y), len(classes)))) for n in names}
    acc = {n: [] for n in names}
    f1 = {n: [] for n in names}
    for tr, te in folds:
        for name, model in feature_models().items():
            model.fit(X[tr], y[tr])
            p = model.predict_proba(X[te])
            pooled[name][1][te] = p
        if "CNN (spectrogram)" in names:
            cnn = train_cnn(S[tr], y[tr], len(classes), epochs=ep(20))
            pooled["CNN (spectrogram)"][1][te] = cnn_proba(cnn, S[te])
        if CNN_V2 in names:
            cnns = train_cnn(S[tr], y[tr], len(classes), epochs=ep(40), augment=True, class_weighted=True,
                             groups=groups[tr], patience=6, seeds=[0, 1, 2])
            pooled[CNN_V2][1][te] = cnn_proba(cnns, S[te])
        for n in names:
            pred = pooled[n][1][te].argmax(1)
            acc[n].append(accuracy_score(y[te], pred))
            f1[n].append(f1_score(y[te], pred, average="macro"))
    for n in names:
        pred = pooled[n][1].argmax(1)
        res[n] = {"accuracy": summarize(acc[n]), "macro_f1": summarize(f1[n]),
                  "confusion": confusion_matrix(y, pred, labels=range(len(classes))).tolist()}
        if groups is not None:  # recording-level verdict: average the window probabilities per recording
            tested = np.zeros(len(y), bool)               # only windows some fold tested (all of them with 5/5 folds)
            for _, te in folds:
                tested[te] = True
            g = pd.DataFrame(pooled[n][1][tested]).groupby(groups[tested]).mean()
            truth = pd.Series(y[tested]).groupby(groups[tested]).first().loc[g.index]
            res[n]["recording_accuracy"] = float(accuracy_score(truth, g.to_numpy().argmax(1)))
    return (res, {n: pooled[n][1] for n in names}) if return_proba else res


ENSEMBLE = "Ensemble (mean of SVM, Softmax, ANN, CNN)"
CURVE = np.round(np.arange(0.30, 0.951, 0.05), 2)


def healthy_fpr_report(P_by_model, y, clips, folds, classes):
    """Per model and for the ensemble, on each outer test fold: healthy false-positive rate (healthy predicted as
    any fault / all healthy) per window and per recording, and per-class recall and precision (per window)."""
    out = {}
    for name, P in P_by_model.items():
        wf, rf, rec, prec = [], [], {c: [] for c in classes}, {c: [] for c in classes}
        for _, te in folds:
            pred = P[te].argmax(1)
            h = y[te] == real_audio.HEALTHY
            wf.append(float((pred[h] != real_audio.HEALTHY).mean()))
            Pr, yr = real_audio.recording_proba(P[te], y[te], clips[te])
            rf.append(float((Pr[yr == real_audio.HEALTHY].argmax(1) != real_audio.HEALTHY).mean()))
            p, r, _, _ = precision_recall_fscore_support(y[te], pred, labels=range(len(classes)), zero_division=0)
            for i, c in enumerate(classes):
                rec[c].append(r[i])
                prec[c].append(p[i])
        out[name] = {"window": summarize(wf), "recording": summarize(rf), "per_fold_recording": rf,
                     "per_class": {c: {"recall": summarize(rec[c]), "precision": summarize(prec[c])} for c in classes}}
    return {"source": "real", "definition": "healthy predicted as any fault / all healthy, on each held-out fold "
            "(no abstention); per-class recall and precision are per window", "models": out}


def selective_report(X, S, y, clips, folds, P_ens):
    """Abstain ("unsure") when the ensemble's top probability is below a threshold. Each outer fold picks its
    threshold from an INNER 3-fold split grouped by recording of its own training data only (target: healthy FPR
    <= 5% on answered recordings, most coverage), then is scored once on its held-out recordings."""
    per_fold, after_P, after_y, after_tau = [], [], [], []
    for f, (tr, te) in enumerate(folds):
        P_in = real_audio.oof_ensemble(X[tr], S[tr], y[tr], clips[tr], n_splits=3, seed=f)
        tau, met, inner = real_audio.choose_threshold(*real_audio.recording_proba(P_in, y[tr], clips[tr]))
        Pr, yr = real_audio.recording_proba(P_ens[te], y[te], clips[te])
        per_fold.append({"fold": f, "threshold": tau, "inner_target_met": met, "inner": inner,
                         "test_before": real_audio.selective_stats(Pr, yr, 0.0),
                         "test_after": real_audio.selective_stats(Pr, yr, tau)})
        after_P.append(Pr)
        after_y.append(yr)
        after_tau.append(np.full(len(yr), tau))
        print(f"  selective fold {f}: threshold {tau:.2f} (inner target met: {met}); test coverage "
              f"{per_fold[-1]['test_after']['coverage']:.2f}, healthy FPR {per_fold[-1]['test_before']['healthy_fpr_answered']:.3f}"
              f" -> {per_fold[-1]['test_after']['healthy_fpr_answered']:.3f}")
    Pr, yr, taus = np.concatenate(after_P), np.concatenate(after_y), np.concatenate(after_tau)
    # pooled over folds with each fold's own threshold: rows a fold abstained on are zeroed, so only they fall below 1e-9
    pooled_after = real_audio.selective_stats(np.where((Pr.max(1) >= taus)[:, None], Pr, 0.0), yr, 1e-9)
    pooled_after["threshold"] = None                          # each fold used its own threshold (see per_fold)
    Pw, yw = P_ens, y
    return {"source": "real", "ensemble": ENSEMBLE, "target_healthy_fpr": real_audio.TARGET_HEALTHY_FPR,
            "threshold_selection": "per outer fold, inner 3-fold split grouped by recording on that fold's training "
                                   "recordings only; lowest threshold with recording-level healthy FPR on answered <= 5%",
            "fold_thresholds": [p["threshold"] for p in per_fold],
            "before": real_audio.selective_stats(Pr, yr, 0.0), "after": pooled_after, "per_fold": per_fold,
            "curve": {"recording": [real_audio.selective_stats(Pr, yr, t) for t in CURVE],
                      "window": [real_audio.selective_stats(Pw, yw, t) for t in CURVE]},
            "note": "curve = every threshold scored on the held-out folds (a description, not used to choose)"}


# ------------------------------------------------------------------ 1. real engine audio
def eval_audio():
    t0 = time.time()
    wins = load_engine_audio()
    if QUICK:                                             # smoke run: every 4th recording
        keep = sorted({w["clip"] for w in wins})[::4]
        wins = [w for w in wins if w["clip"] in keep]
    classes = real_audio.CLASSES
    y = np.array([classes.index(w["label"]) for w in wins])
    clips = np.array([w["clip"] for w in wins])
    rpms, X, S = real_audio.window_features([w["signal"] for w in wins])  # shared with train_real.py
    print(f"audio: {len(wins)} windows from {len(set(clips))} recordings, features in {time.time() - t0:.0f}s; "
          f"estimated rpm median {np.median(rpms):.0f}")
    folds = list(StratifiedGroupKFold(5, shuffle=True, random_state=0).split(X, y, clips))[:2 if QUICK else 5]
    res, proba = cv_signature_models(X, S, y, clips, folds, classes, return_proba=True, cnn_v2=True)
    proba[ENSEMBLE] = np.mean([proba[n] for n in proba if n != CNN_V2], axis=0)   # Task 3's ensemble: the original 4
    for n, P in proba.items():
        if n in res:
            tested = np.concatenate([te for _, te in folds])       # every window with 5/5 folds; fewer in --quick
            res[n].update(recording_bootstrap_ci(P[tested], y[tested], clips[tested]))
    healthy_fpr = healthy_fpr_report(proba, y, clips, folds, classes)
    selective = selective_report(X, S, y, clips, folds, proba[ENSEMBLE])
    transfer = eval_transfer(wins, X, S, y, clips, folds[:2] if QUICK else folds, classes)

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
            **({"quick": "SMOKE RUN: every 4th recording, 2 of 5 folds, few CNN epochs - not a result"} if QUICK else {}),
            "vehicle_identity": "vehicle identity unknown - recording-grouped CV may be optimistic (filenames are "
                                "<class>_<index>.wav and no metadata was downloaded, so recordings of one vehicle "
                                "may sit on both sides of a split)",
            "data_inventory": audio_inventory(),
            "ci_method": "95% percentile intervals from 1000 bootstrap resamples of recordings (seed 0); metrics per "
                         "window over the resampled recordings' out-of-fold predictions",
            "classes": classes, "n_windows": int(len(y)), "n_recordings": int(len(set(clips))),
            "class_recordings": {c: int(len({cl for cl, yy in zip(clips, y) if yy == i})) for i, c in enumerate(classes)},
            "split": "5-fold cross-validation grouped by recording (no recording in both train and test)",
            "models": res, "zero_shot_from_simulator": zero, "healthy_fpr": healthy_fpr, "selective": selective,
            "transfer": transfer}


def eval_audio_transfer():
    """Only the transfer block, added to the audio results already in real_metrics.json (same folds), so the
    40-minute audio suite does not have to run again. --quick: the first 2 of the 5 folds."""
    out = json.loads(OUT.read_text()) if OUT.exists() else {}
    if "audio" not in out:
        raise SystemExit("run `evaluate_real.py audio` first")
    wins = load_engine_audio()
    classes = real_audio.CLASSES
    y = np.array([classes.index(w["label"]) for w in wins])
    clips = np.array([w["clip"] for w in wins])
    _, X, S = real_audio.window_features([w["signal"] for w in wins])
    folds = list(StratifiedGroupKFold(5, shuffle=True, random_state=0).split(X, y, clips))
    out["audio"]["transfer"] = eval_transfer(wins, X, S, y, clips, folds[:2] if QUICK else folds, classes)
    return out["audio"]


def recording_bootstrap_ci(P, y, clips, n_boot=1000, seed=0):
    """95% CIs for accuracy, macro F1 and healthy FPR (per window), resampling whole RECORDINGS with replacement."""
    rng = np.random.default_rng(seed)
    pred = P.argmax(1)
    ids = sorted(set(clips))
    idx = {c: np.where(clips == c)[0] for c in ids}
    acc, f1, fpr = [], [], []
    for _ in range(n_boot):
        w = np.concatenate([idx[c] for c in rng.choice(ids, len(ids), replace=True)])
        yy, pp = y[w], pred[w]
        acc.append(np.mean(yy == pp))
        f1.append(f1_score(yy, pp, average="macro", labels=range(P.shape[1]), zero_division=0))
        h = yy == real_audio.HEALTHY
        fpr.append(np.mean(pp[h] != real_audio.HEALTHY) if h.any() else np.nan)
    ci = lambda v: [float(np.nanpercentile(v, 2.5)), float(np.nanpercentile(v, 97.5))]  # noqa: E731
    return {"accuracy_ci": ci(acc), "macro_f1_ci": ci(f1), "healthy_fpr_ci": ci(fpr)}


def audio_inventory():
    """What the downloaded files say about themselves: per class, recordings, sample rates, channels, durations."""
    from collections import Counter
    from scipy.io import wavfile
    from autopulse.realdata import AUDIO_CLASS_MAP, RAW
    inv = {}
    for f in sorted((RAW / "engine_audio").glob("*.wav")):
        label = AUDIO_CLASS_MAP.get(f.stem.rsplit("_", 1)[0])
        if label is None:
            continue
        fs, x = wavfile.read(f)
        d = inv.setdefault(label, {"recordings": 0, "sample_rates": Counter(), "channels": Counter(),
                                   "sample_format": Counter(), "durations": []})
        d["recordings"] += 1
        d["sample_rates"][int(fs)] += 1
        d["channels"][int(x.ndim if x.ndim == 1 else x.shape[1])] += 1
        d["sample_format"][str(x.dtype)] += 1
        d["durations"].append(x.shape[0] / fs)
    for d in inv.values():
        dur = np.array(d.pop("durations"))
        d.update(sample_rates=dict(d["sample_rates"]), channels=dict(d["channels"]), sample_format=dict(d["sample_format"]),
                 duration_s={"min": float(dur.min()), "median": float(np.median(dur)), "max": float(dur.max()),
                             "total_min": float(dur.sum() / 60)})
    return {"per_class": inv, "vehicles": "not identifiable from filenames or downloaded metadata",
            "note": "sample rate, channel count and bit depth are mixed within every class (the pipeline resamples "
                    "to 24 kHz mono and z-scores each recording, which removes most format differences)"}


# ------------------------------------------------------------------ 1b. sim -> real transfer on the same folds
SIM_CARS, SIM_PER_CLASS = range(10), 25
if QUICK:
    SIM_PER_CLASS = 5
TRANSFER_VARIANTS = {
    "a": "real only: trained on the fold's real training recordings (the baseline to beat)",
    "b": "simulator only, plain generator (zero-shot)",
    "c": "simulator only, domain-randomised (zero-shot); background bank = healthy windows of the fold's training recordings",
    "d": "CNN pretrained on randomised simulator spectrograms, fine-tuned on the fold's real training windows (6 epochs, lr 5e-4)",
    "e": "feature models trained on real training windows + randomised simulator windows",
}


def sim_set(classes, seed, randomize, bank=None):
    """Simulated microphone windows for the real classes, through exactly the real-audio feature pipeline
    (unit-variance window, rpm estimated from the sound, no crank sensor)."""
    rng = np.random.default_rng(seed)
    sig, y = [], []
    for car_id in SIM_CARS:
        car = make_car(car_id)
        for k, fault in enumerate(classes):
            for _ in range(SIM_PER_CLASS):
                w = synth_window(fault, rpm=rng.uniform(700, 3000), car=car, severity=rng.uniform(0.4, 1),
                                 coolant_c=rng.choice([30.0, 90.0]), age=rng.uniform(0, 1), rng=rng,
                                 randomize=randomize, bg_noise_bank=bank)
                m = w["mic"].astype(np.float64)
                sig.append(((m - m.mean()) / (m.std() + 1e-9)).astype(np.float32))
                y.append(k)
    _, X, S = real_audio.window_features(sig)
    return X, S, np.array(y)


def transfer_metrics(y, P, clips):
    pred = P.argmax(1)
    h = y == real_audio.HEALTHY
    Pr, yr = real_audio.recording_proba(P, y, clips)
    return {"accuracy": float(accuracy_score(y, pred)), "macro_f1": float(f1_score(y, pred, average="macro")),
            "healthy_fpr": float((pred[h] != real_audio.HEALTHY).mean()),
            "healthy_fpr_recording": float((Pr[yr == real_audio.HEALTHY].argmax(1) != real_audio.HEALTHY).mean())}


def eval_transfer(wins, X, S, y, clips, folds, classes):
    """(a)-(e) on the given grouped folds; per variant and model: mean/std over folds of accuracy, macro F1 and
    healthy FPR (per window and per recording). Nothing about a fold's test recordings is used to build its
    simulator data or train its models."""
    t0 = time.time()
    sigs = [w["signal"] for w in wins]
    Xb, Sb, yb = sim_set(classes, seed=11, randomize=False)          # (b) does not depend on the fold
    per = {}

    def add(variant, model, y_te, P, c_te):
        per.setdefault((variant, model), []).append(transfer_metrics(y_te, P, c_te))

    for f, (tr, te) in enumerate(folds):
        bank = [sigs[i] for i in tr if y[i] == real_audio.HEALTHY]
        Xc, Sc, yc = sim_set(classes, seed=20 + f, randomize=True, bank=bank)
        for name, base in feature_models().items():
            add("a", name, y[te], base.fit(X[tr], y[tr]).predict_proba(X[te]), clips[te])
            add("b", name, y[te], feature_models()[name].fit(Xb, yb).predict_proba(X[te]), clips[te])
            add("c", name, y[te], feature_models()[name].fit(Xc, yc).predict_proba(X[te]), clips[te])
            add("e", name, y[te], feature_models()[name].fit(np.vstack([X[tr], Xc]), np.concatenate([y[tr], yc]))
                .predict_proba(X[te]), clips[te])
        if HAS_TORCH:
            cnn_real = train_cnn(S[tr], y[tr], len(classes), epochs=ep(20))
            add("a", "CNN (spectrogram)", y[te], cnn_proba(cnn_real, S[te]), clips[te])
            add("b", "CNN (spectrogram)", y[te], cnn_proba(train_cnn(Sb, yb, len(classes), epochs=ep(12)), S[te]), clips[te])
            pre = train_cnn(Sc, yc, len(classes), epochs=ep(12))
            add("c", "CNN (spectrogram)", y[te], cnn_proba(pre, S[te]), clips[te])
            tuned = train_cnn(S[tr], y[tr], len(classes), epochs=ep(6), init=pre, lr=5e-4)
            add("d", "CNN (spectrogram)", y[te], cnn_proba(tuned, S[te]), clips[te])
        print(f"  transfer fold {f}: " + ", ".join(
            f"{v} {np.mean([per[(v, m)][-1]['macro_f1'] for m in [n for (vv, n) in per if vv == v]]):.2f}"
            for v in "abcde" if any(vv == v for vv, _ in per)) + f"  ({time.time() - t0:.0f}s)", flush=True)
    out = {}
    for (v, m), rows in per.items():
        out.setdefault(v, {"description": TRANSFER_VARIANTS[v], "models": {}})["models"][m] = {
            k: summarize([r[k] for r in rows]) for k in rows[0]}
    return {"source": "real (test) · simulator (training data in b-e)", "folds": len(folds),
            "split": "the audio suite's grouped folds (no recording in both train and test)",
            "sim_windows": int(len(yb)), "sim_cars": len(SIM_CARS), "variants": dict(sorted(out.items()))}


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


def obd_windows(trip, resid=None):
    """30 s windows of a trip. resid (autopulse.residuals.ResidualModels) adds each relation's mean prediction and
    row-residual spread; the residual means themselves are taken later (residuals.add_residuals), after injection."""
    rows = []
    for s in range(0, len(trip) - WIN_S + 1, WIN_S):
        w = trip.iloc[s:s + WIN_S]
        rows.append({"ltft_pct": w.ltft_pct.mean(), "stft_mean": w.stft_pct.mean(), "stft_std": w.stft_pct.std(),
                     "map_kpa": w.map_kpa.mean(), "battery_v": w.battery_v.mean(), "timing_deg": w.timing_deg.mean(),
                     "cat_c": w.cat_c.mean(), "iat_c": w.iat_c.mean(), "coolant_c": w.coolant_c.mean(),
                     "rpm": w.rpm.mean(), "speed": w.speed_kph.mean(), "load": w.engine_load.mean(),
                     **(resid.window_columns(w) if resid is not None else {})})
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


def learn(base, wins_list, feats=OBD_FEATS, prep=lambda w: w):
    for wins in wins_list:
        for _, r in prep(wins).iterrows():
            base.observe(r[feats].to_numpy(dtype=float), obd_context(r))
    for s in base.state.values():  # history is trusted; clear alarm state before scoring new trips
        s["frozen"], s["streak"] = False, 0


def eval_obd():
    """The original study (window means only) plus the same study with cross-sensor residuals under "residuals"."""
    out = _obd_study(residuals=False)
    out["residuals"] = _obd_study(residuals=True)
    return out


def _obd_study(residuals=False):
    trips = load_carobd()
    names = sorted(trips)
    rng = np.random.default_rng(0)
    rng.shuffle(names)
    n_learn, n_cal = int(0.42 * len(names)), int(0.18 * len(names))
    learn_names, cal_names, test_names = names[:n_learn], names[n_learn:n_learn + n_cal], names[n_learn + n_cal:]
    resid = ResidualModels().fit([trips[n] for n in learn_names]) if residuals else None   # learning trips only
    feats = OBD_FEATS + RESID_FEATS if residuals else OBD_FEATS
    prep = add_residuals if residuals else (lambda w: w)
    learn_w = [obd_windows(trips[n], resid) for n in learn_names]
    Xl = prep(pd.concat(learn_w))[feats].to_numpy(dtype=float)
    idx = np.arange(len(feats))
    prior_mean, prior_std = Xl.mean(0), Xl.std(0) + 1e-6

    cal_w = [w for w in (obd_windows(trips[n], resid) for n in cal_names) if len(w) >= 14]
    test = {n: obd_windows(trips[n], resid) for n in test_names}
    test_w = [w for w in test.values() if len(w) >= 14]

    def make_adaptive(p):
        b = AdaptiveBaseline(prior_mean, prior_std, alpha=p["alpha"], calib_n=15, threshold=np.inf, gate=2.5,
                             persist=PERSIST, score_idx=idx, top_k=p["top_k"], min_std_frac=p["min_std_frac"])
        learn(b, learn_w, feats, prep)
        return b

    def scores(method, model, wins):
        """Per-window scores; the adaptive model keeps learning within the trip, on a private copy.
        Residuals are taken here, after any injection, from the window means."""
        wins = prep(wins)
        if method == "adaptive":
            m = copy.deepcopy(model)
            return np.array([m.observe(r[feats].to_numpy(dtype=float), obd_context(r))[0]
                             for _, r in wins.iterrows()])
        return np.array([model.score(r[feats].to_numpy(dtype=float)) for _, r in wins.iterrows()])

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
            learn(model, cal_w, feats, prep)  # calibration trips are healthy history too
        fa, det = evaluate(method, model, tau, test_w)
        chosen[method] = {"settings": p, "threshold": tau, "calibration_detection": det_rate}
        final[method] = (fa, det)
        tag = "obd +residuals" if residuals else "obd"
        print(f"{tag} {method}: {p}, tau {tau:.2f}, calibration detection {det_rate:.2f}, "
              f"test false-alarm {fa:.2f}", flush=True)

    extra = {"source": "real trips + injected faults",
             "residual_models": {n: f"{t} ~ gradient boosting({', '.join(c)}), fitted on the learning trips' rows"
                                 for n, (t, c) in RELATIONS.items()}} if residuals else {}
    return {"dataset": "carOBD (Toyota Etios, real OBD-II, 1 Hz, 129 trips)",
            "learning_trips": len(learn_names), "calibration_trips": len(cal_w), "test_trips": len(test_w),
            "window_s": WIN_S, "features": feats, "chosen": chosen, **extra,
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


SUITES = {"audio": eval_audio, "cwru": eval_cwru, "condition": eval_condition, "obd": eval_obd,
          "transfer": eval_audio_transfer}   # transfer = only audio["transfer"], on top of an existing audio run

if __name__ == "__main__":
    OUT.parent.mkdir(parents=True, exist_ok=True)
    if QUICK:
        real_audio.CNN_EPOCHS = ep(real_audio.CNN_EPOCHS)
    out = json.loads(OUT.read_text()) if OUT.exists() else {}
    for name in [a for a in sys.argv[1:] if a != "--quick"] or [n for n in SUITES if n != "transfer"]:
        t = time.time()
        out["audio" if name == "transfer" else name] = SUITES[name]()
        OUT.write_text(json.dumps(out, indent=2))
        print(f"  {name} done in {time.time() - t:.0f}s")
    for name, r in out.items():
        if "models" in r:
            print(f"\n[{name}] {r['split']}")
            for m, v in r["models"].items():
                extra = f"  recording acc {v['recording_accuracy']:.3f}" if "recording_accuracy" in v else ""
                if "accuracy_ci" in v:
                    extra += (f"  CI acc [{v['accuracy_ci'][0]:.3f}, {v['accuracy_ci'][1]:.3f}] F1 [{v['macro_f1_ci'][0]:.3f}, "
                              f"{v['macro_f1_ci'][1]:.3f}] hFPR [{v['healthy_fpr_ci'][0]:.3f}, {v['healthy_fpr_ci'][1]:.3f}]")
                print(f"  {m:30s} acc {v['accuracy']['mean']:.3f} ± {v['accuracy']['std']:.3f}  "
                      f"F1 {v['macro_f1']['mean']:.3f}{extra}")
        if "zero_shot_from_simulator" in r:
            print("  zero-shot from simulator:", {k: round(v["macro_f1"], 3) for k, v in r["zero_shot_from_simulator"].items()})
        if "healthy_fpr" in r:
            print("  healthy FPR (no abstention), window / recording:")
            for m, v in r["healthy_fpr"]["models"].items():
                print(f"    {m:42s} {v['window']['mean']:.3f} / {v['recording']['mean']:.3f}")
        if "selective" in r:
            s = r["selective"]
            for k in ("before", "after"):
                v = s[k]
                print(f"  ensemble {k:6s} threshold: coverage {v['coverage']:.3f}, accuracy on answered "
                      f"{v['accuracy_answered']:.3f}, healthy FPR on answered {v['healthy_fpr_answered']:.3f} "
                      f"({v['healthy_false_alarms']}/{v['healthy_answered']}), alarm rate {v['healthy_alarm_rate']:.3f}")
            print(f"  fold thresholds {s['fold_thresholds']}")
        if "transfer" in r:
            t = r["transfer"]
            print(f"  sim -> real transfer ({t['folds']} folds): macro F1 / healthy FPR per window")
            for v, d in t["variants"].items():
                print(f"    ({v}) " + "  ".join(f"{m.split(' (')[0]} {x['macro_f1']['mean']:.3f}/{x['healthy_fpr']['mean']:.3f}"
                                         for m, x in d["models"].items()) + f"   {d['description'][:60]}")
        if "healthy_only_anomaly_auc" in r:
            print(f"  healthy-only anomaly AUC {r['healthy_only_anomaly_auc']['mean']:.3f}; "
                  f"majority-class accuracy {r['majority_class_accuracy']:.3f}")
        if "false_alarm_trip_rate" in r:
            print(f"\n[{name}] false-alarm trips: {r['false_alarm_trip_rate']}")
            for f, v in r["injected_fault_detection"].items():
                print(f"  {f:18s} adaptive {v['adaptive']}  static {v['static']}")
            if "residuals" in r:
                q = r["residuals"]
                print(f"  +residuals false-alarm trips: {q['false_alarm_trip_rate']}")
                for f, v in q["injected_fault_detection"].items():
                    print(f"  {f:18s} adaptive {v['adaptive']}  static {v['static']}")
