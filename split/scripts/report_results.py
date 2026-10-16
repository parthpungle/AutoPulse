"""Every headline number in one Markdown table, read from models/*.json (nothing typed in by hand).

    .venv\\Scripts\\python scripts\\report_results.py [--quick]

Columns: Claim | Number | Data source | Split/protocol | File. Sections whose JSON is missing are skipped and listed
at the end. --quick reads the smoke-run outputs in models/quick/ instead.
"""
import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
MODELS = ROOT / "models" / ("quick" if "--quick" in sys.argv else "")
REAL, SIM, INJ, MAT = "Real", "Simulator", "Real trips + injected faults", "Simulink/MATLAB"
rows, missing = [], []


def load(name):
    p = MODELS / name
    if not p.exists():
        missing.append(name)
        return None
    return json.loads(p.read_text())


def pct(v):
    return "—" if v is None else f"{100 * v:.1f}%"


def ci(c, f=pct):
    return f" [95% CI {f(c[0])}–{f(c[1])}]" if c else ""


def add(claim, number, source, protocol, file):
    rows.append((claim, number, source, protocol, file))


def audio(r):
    a = r.get("audio")
    if not a:
        return
    proto = "5-fold CV grouped by recording"
    for m, v in a["models"].items():
        add(f"Engine sound, 4 classes: {m}", f"acc {pct(v['accuracy']['mean'])}{ci(v.get('accuracy_ci'))}; "
            f"macro F1 {v['macro_f1']['mean']:.3f}{ci(v.get('macro_f1_ci'), lambda x: f'{x:.3f}')}",
            REAL, proto, "real_metrics.json audio.models")
    for m, v in (a.get("healthy_fpr", {}).get("models") or {}).items():
        c = a["models"].get(m, {}).get("healthy_fpr_ci")
        add(f"Healthy sound flagged as a fault: {m}",
            f"{pct(v['window']['mean'])} per window{ci(c)}, {pct(v['recording']['mean'])} per recording",
            REAL, proto, "real_metrics.json audio.healthy_fpr")
    s = a.get("selective")
    if s:
        b, f = s["before"], s["after"]
        add("Abstain when unsure (ensemble, per recording)",
            f"answered {pct(b['coverage'])} → {pct(f['coverage'])}; accuracy {pct(b['accuracy_answered'])} → "
            f"{pct(f['accuracy_answered'])}; healthy FPR {pct(b['healthy_fpr_answered'])} → {pct(f['healthy_fpr_answered'])}",
            REAL, "threshold per fold from an inner grouped split of its training recordings", "real_metrics.json audio.selective")
    t = a.get("transfer")
    if t:
        for v, d in t["variants"].items():
            best = max(d["models"].items(), key=lambda kv: kv[1]["macro_f1"]["mean"])
            add(f"Sim→real ({v}) {d['description'].split(':')[0]}",
                f"best macro F1 {best[1]['macro_f1']['mean']:.3f} ({best[0].split(' (')[0]}), healthy FPR "
                f"{pct(best[1]['healthy_fpr']['mean'])}", REAL if v == "a" else f"{REAL} test, {SIM} training",
                f"{t['folds']} grouped folds", "real_metrics.json audio.transfer")
    if a.get("vehicle_identity"):
        add("Caveat: vehicle identity", a["vehicle_identity"].split(" (")[0], REAL, "—", "real_metrics.json audio")


def obd(r):
    o = r.get("obd")
    if not o:
        return
    proto = f"{o['test_trips']} held-out trips; thresholds from calibration trips"
    fa = o["false_alarm_trip_rate"]
    add("Healthy trips with a false alarm (adaptive vs fixed)", f"{pct(fa['adaptive'])} vs {pct(fa['static'])}",
        REAL, proto, "real_metrics.json obd")
    res = o.get("residuals")
    if res:
        fr = res["false_alarm_trip_rate"]
        add("… with cross-sensor residuals", f"{pct(fr['adaptive'])} vs {pct(fr['static'])}", REAL, proto,
            "real_metrics.json obd.residuals")
    for f, v in o["injected_fault_detection"].items():
        after = res["injected_fault_detection"][f] if res else None
        num = f"adaptive {pct(v['adaptive']['detection_rate'])}, fixed {pct(v['static']['detection_rate'])}"
        if after:
            num += (f" → with residuals adaptive {pct(after['adaptive']['detection_rate'])}, "
                    f"fixed {pct(after['static']['detection_rate'])}")
        add(f"OBD fault detected: {f.replace('_', ' ')}", num, INJ, proto, "real_metrics.json obd")


def cwru(r):
    c = r.get("cwru")
    if c:
        best = max(c["models"].items(), key=lambda kv: kv[1]["accuracy"]["mean"])
        add("Bearing test rig (motor), known-easy benchmark", f"acc {pct(best[1]['accuracy']['mean'])} ({best[0]})",
            REAL, "leave-one-motor-load-out", "real_metrics.json cwru")


def matlab(m):
    if not m:
        return
    mw, d, c = m.get("mathworks"), m.get("dsp"), m.get("crank")
    if mw:
        add("Misfires found blind on MathWorks' Simulink engine", f"{mw['detected_events']}/{mw['misfire_events']}, "
            f"{mw['false_alarm_strokes']} false alarms in {mw['healthy_strokes']} healthy strokes", MAT,
            "detector run blind", "matlab_crosscheck.json")
    if d:
        add("Signature features re-implemented in MATLAB", f"{d.get('total_features_checked', d['features_compared'])}/28 "
            f"agree to {d['worst_max_rel_diff']:.0e}", MAT, f"{d['windows']} windows", "matlab_crosscheck.json")
    if c:
        add("Misfire detection on MATLAB crankshaft physics", f"{pct(c['detector_trained_on_python_sim']['accuracy'])}; "
            f"cylinder named {pct(c['cylinder_identification_accuracy'])}", MAT, f"{c['runs']} runs", "matlab_crosscheck.json")


def simulator(s):
    if s:
        for m, v in s["models"].items():
            add(f"Simulated engines, 7 classes: {m}", f"acc {pct(v['accuracy'])}", SIM, s["split"], "metrics.json")


def fusion(f):
    if not f:
        return
    conds = list(f["conditions"])
    for name, r in f["results"].items():
        add(f"Fusion ablation: {name}", ", ".join(f"{c} F1 {r[c]['macro_f1']:.3f}" for c in conds), SIM,
            f["split"], "fusion_metrics.json")


def robustness(rb, label, file):
    if not rb:
        return
    keys = ["noise x1", "noise x5", "severity 0.1-0.3", "rpm 4000-6000", "gain -10 dB"]
    for m in [m for m in ("SVM", "Fused SVM") if m in rb["results"]]:
        add(f"Robustness{label}: {m}", ", ".join(f"{k} {rb['results'][m][k]['macro_f1']:.2f}" for k in keys
                                                 if k in rb["results"][m]),
            SIM, f"test cars {rb['test_cars']}, one factor at a time", file)


def real_audio_meta(m):
    if m and m.get("threshold"):
        t = m["threshold"]
        add("Served real-audio models: abstain threshold", f"{t['value']:.2f} (out-of-fold answered "
            f"{pct(t['out_of_fold']['coverage'])}, healthy FPR {pct(t['out_of_fold']['healthy_fpr_answered'])})",
            REAL, t["chosen_on"], "real_audio/meta.json")


if __name__ == "__main__":
    real = load("real_metrics.json") or {}
    audio(real)
    obd(real)
    cwru(real)
    matlab(load("matlab_crosscheck.json"))
    real_audio_meta(load("real_audio/meta.json"))
    simulator(load("metrics.json"))
    fusion(load("fusion_metrics.json"))
    robustness(load("robustness.json"), "", "robustness.json")
    robustness(load("robustness_randomized.json"), " (trained on randomised sim)", "robustness_randomized.json")
    if "--quick" in sys.argv:
        print("**SMOKE RUN (models/quick): small subsets, 2 folds, few epochs. These are not results.**\n")
    print("| Claim | Number | Data source | Split/protocol | File |")
    print("|---|---|---|---|---|")
    for r in rows:
        print("| " + " | ".join(str(x).replace("|", "/") for x in r) + " |")
    if missing:
        print(f"\nNot found in {MODELS.relative_to(ROOT)}: {', '.join(missing)}")
