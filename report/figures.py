"""Figures for the AutoPulse report, drawn from the real generator / DSP / baseline code.

    .venv\\Scripts\\python report\\figures.py
"""
import json
import sys
from pathlib import Path

import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt  # noqa: E402
import numpy as np  # noqa: E402
from scipy.signal import welch  # noqa: E402

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
from autopulse.baseline import simulate_life  # noqa: E402
from autopulse.generator import ENGINE_FAULTS, FAULT_LABELS, make_car, synth_window  # noqa: E402
from autopulse.signatures import envelope_spectrum, spectrum, stft_image  # noqa: E402

OUT = Path(__file__).parent / "src" / "img"
INK, INK3, LINE = "#17170F", "#5C584F", "#DCDBD6"
ACCENT, OK, WARN, BLUE = "#C2410C", "#256B49", "#B7791F", "#1B4A7C"

plt.rcParams.update({
    "font.family": ["Segoe UI", "DejaVu Sans"], "font.size": 8.5,
    "axes.edgecolor": LINE, "axes.labelcolor": INK3, "axes.titlesize": 9, "axes.titleweight": 600,
    "axes.titlecolor": INK, "axes.titlelocation": "left", "axes.spines.top": False,
    "axes.spines.right": False, "xtick.color": INK3, "ytick.color": INK3,
    "axes.grid": True, "grid.color": "#EEEDE9", "grid.linewidth": 0.6,
    "legend.frameon": False, "legend.fontsize": 7.5, "savefig.dpi": 220,
})


def save(fig, name):
    OUT.mkdir(parents=True, exist_ok=True)
    fig.savefig(OUT / name, bbox_inches="tight", facecolor="white")
    plt.close(fig)
    print("wrote", name)


def signatures():
    car = make_car(8)  # an engine the models never trained on
    rng = np.random.default_rng(11)
    rpm = 1500
    w = {f: synth_window(f, rpm=rpm, car=car, severity=0.9, misfire_cyl=1, rng=rng) for f in ENGINE_FAULTS}
    fs = w["healthy"]["fs"]

    fig, ax = plt.subplots(2, 2, figsize=(7.4, 4.25))
    fig.subplots_adjust(hspace=0.55, wspace=0.28)

    a = ax[0, 0]
    n = int(0.12 * fs)
    t = np.arange(n) / fs * 1000
    a.plot(t, w["healthy"]["signal"][:n], color=INK3, lw=0.6, label="healthy")
    a.plot(t, w["knock"]["signal"][:n] + 3.5, color=ACCENT, lw=0.6, label="knock (offset)")
    a.set_title("A · Time domain: block vibration")
    a.set_xlabel("ms")
    a.set_yticks([])
    a.set_ylim(-3, 7.5)
    a.legend(loc="upper center", ncol=2, bbox_to_anchor=(0.5, 1.02))

    a = ax[0, 1]
    for f, c, lbl in [("healthy", INK3, "healthy"), ("knock", ACCENT, "knock")]:
        fr, P = welch(w[f]["signal"], fs, nperseg=1024)
        a.plot(fr / 1000, 10 * np.log10(P + 1e-12), color=c, lw=1.0, label=lbl)
    a.axvspan(5.5, 8.0, color=ACCENT, alpha=0.08, lw=0)
    a.text(6.75, a.get_ylim()[1] - 4, "knock band", ha="center", color=ACCENT, fontsize=7)
    a.set_xlim(0, 11)
    a.set_title("B · Frequency domain: FFT power spectrum")
    a.set_xlabel("kHz")
    a.set_ylabel("dB")
    a.legend(loc="upper right", bbox_to_anchor=(1.0, 0.86))

    a = ax[1, 0]
    for f, c in [("healthy", INK3), ("bearing", ACCENT)]:
        fe, E = envelope_spectrum(w[f]["signal"], fs)
        sel = fe < 400
        a.plot(fe[sel], E[sel], color=c, lw=0.8, label=f)
    bpfo = car.bpfo_ratio * car.pulley_ratio * rpm / 60
    a.set_xlim(0, 400)
    a.axvline(bpfo, color=ACCENT, ls=":", lw=0.9)
    a.text(bpfo, a.get_ylim()[1] * 0.92, " bearing defect (BPFO)", color=ACCENT, fontsize=7)
    a.set_title("C · Envelope spectrum: bearing defect rate")
    a.set_xlabel("Hz")
    a.set_yticks([])
    a.legend(loc="center right")

    a = ax[1, 1]
    cs = w["misfire"]["crank_speed"]
    dev = cs - np.median(cs)
    colors = [ACCENT if d < -15 else "#9DB4CC" for d in dev]
    a.bar(np.arange(len(dev)), dev, color=colors, width=0.8)
    a.set_title("D · Crank speed per firing: misfire dips")
    a.set_xlabel("firing event (1 s at 1,500 rpm)")
    a.set_ylabel("rpm vs median")
    save(fig, "signatures.png")

    fig, ax = plt.subplots(1, 3, figsize=(7.4, 2.1), sharey=True)
    fig.subplots_adjust(wspace=0.16)
    for a, f in zip(ax, ["healthy", "knock", "valve_tick"]):
        fS, tS, S = stft_image(w[f]["signal"], fs)
        a.pcolormesh(tS, fS / 1000, S, cmap="magma", shading="auto", rasterized=True)
        a.set_title(FAULT_LABELS[f].split(" (")[0], fontsize=8.5)
        a.set_xlabel("s")
        a.set_xticks([0, 0.5, 1.0])
        a.grid(False)
    ax[0].set_ylabel("kHz")
    save(fig, "spectrograms.png")


def baseline():
    prior = np.load(ROOT / "models" / "population_prior.npz")
    L = simulate_life(prior["mean"], prior["std"])
    fault_day = L[L.fault_active].day.min()
    fig, ax = plt.subplots(2, 1, figsize=(7.4, 3.05), sharex=True)
    fig.subplots_adjust(hspace=0.35)
    for a, ctx, title in [(ax[0], "cold_start", "Cold start"), (ax[1], "warm_idle", "Warm idle")]:
        d = L[L.context == ctx]
        a.axvspan(fault_day, d.day.max(), color=ACCENT, alpha=0.07, lw=0)
        a.plot(d.day, d.static_score, color=WARN, lw=1.0, label="static baseline (fixed 'healthy')")
        a.plot(d.day, d.adaptive_score, color=OK, lw=1.2, label="AutoPulse adaptive baseline")
        a.axhline(3.0, color=INK, ls="--", lw=0.7)
        a.set_yscale("log")
        a.set_ylabel("anomaly score")
        a.set_title(title)
        t2 = a.twinx()
        t2.plot(d.day, d.ambient_c, color="#9AA3B2", lw=0.8, ls=":")
        t2.set_ylabel("ambient °C", color="#9AA3B2")
        t2.tick_params(colors="#9AA3B2")
        t2.grid(False)
        t2.spines["right"].set_visible(True)
    ax[0].text(fault_day + 2, 1.08, "valve wear begins", color=ACCENT, fontsize=7.5)
    ax[0].text(2, 3.3, "alarm threshold", fontsize=7, color=INK)
    ax[0].legend(loc="upper left", bbox_to_anchor=(0, 1.5), ncol=2)
    ax[1].set_xlabel("day (summer → winter)")
    save(fig, "baseline.png")

    out = {}
    for col in ("static", "adaptive"):
        before = L[(~L.fault_active) & (L.day >= 14)]
        after = L[L.fault_active]
        det = after[after[f"{col}_alarm"]].day.min()
        out[col] = {"false_alarm_days": int(before[before[f"{col}_alarm"]].day.nunique()),
                    "detection_delay_days": int(det - fault_day) if np.isfinite(det) else None}
    (OUT / "baseline_summary.json").write_text(json.dumps(out, indent=2))
    print(out)


def confusion():
    met = json.loads((ROOT / "models" / "metrics.json").read_text())
    best = max(met["models"], key=lambda k: met["models"][k]["macro_f1"])
    cm = np.array(met["models"][best]["confusion"])
    labels = [FAULT_LABELS[f].split(" (")[0].replace("Accessory ", "").replace("Imbalance / engine mount", "Imbalance")
              for f in met["classes"]]
    fig, a = plt.subplots(figsize=(4.6, 3.9))
    a.imshow(cm, cmap="Oranges")
    for i in range(len(cm)):
        for j in range(len(cm)):
            a.text(j, i, cm[i, j], ha="center", va="center", fontsize=7.5,
                   color="white" if cm[i, j] > cm.max() * 0.6 else INK)
    a.set_xticks(range(len(labels)), labels, rotation=40, ha="right")
    a.set_yticks(range(len(labels)), labels)
    a.set_xlabel("predicted")
    a.set_ylabel("true")
    a.set_title(f"{best} on unseen cars")
    a.grid(False)
    save(fig, "confusion.png")


def real_confusion():
    """Confusion matrices of the best model on each real classification set, side by side."""
    R = json.loads((ROOT / "models" / "real_metrics.json").read_text())
    sets = [(k, t) for k, t in (("audio", "Real engine sound"), ("cwru", "Real bearing vibration")) if k in R]
    if not sets:
        return
    fig, axes = plt.subplots(1, len(sets), figsize=(3.7 * len(sets), 3.3))
    axes = np.atleast_1d(axes)
    nice = {"healthy": "Healthy", "misfire": "Misfire", "valve_tick": "Tappet", "belt_squeal": "Belt",
            "normal": "Normal", "inner": "Inner race", "ball": "Ball", "outer": "Outer race"}
    for a, (k, title) in zip(axes, sets):
        r = R[k]
        best = max(r["models"], key=lambda m: r["models"][m]["macro_f1"]["mean"])
        cm = np.array(r["models"][best]["confusion"])
        cmn = cm / cm.sum(1, keepdims=True)
        a.imshow(cmn, cmap="Oranges", vmin=0, vmax=1)
        for i in range(len(cm)):
            for j in range(len(cm)):
                a.text(j, i, f"{cmn[i, j]:.0%}", ha="center", va="center", fontsize=7.5,
                       color="white" if cmn[i, j] > 0.6 else INK)
        labels = [nice.get(c, c) for c in r["classes"]]
        a.set_xticks(range(len(labels)), labels, rotation=35, ha="right")
        a.set_yticks(range(len(labels)), labels)
        a.set_title(f"{title} · {best.split(' (')[0]}", fontsize=8.5)
        a.set_xlabel("predicted")
        a.grid(False)
    axes[0].set_ylabel("true")
    fig.subplots_adjust(wspace=0.55)
    save(fig, "real_confusion.png")


if __name__ == "__main__":
    signatures()
    if (ROOT / "models" / "population_prior.npz").exists():
        baseline()
    if (ROOT / "models" / "metrics.json").exists():
        confusion()
    if (ROOT / "models" / "real_metrics.json").exists():
        real_confusion()
