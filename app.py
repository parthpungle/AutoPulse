"""AutoPulse dashboard: startup health check, live drive, signature lab, adaptive baseline, wear, models."""
import json
import time
from pathlib import Path

import joblib
import numpy as np
import plotly.graph_objects as go
import streamlit as st

from autopulse.baseline import predict_days_to, simulate_life, simulate_wear
from autopulse.generator import ENGINE_FAULTS, FAULT_LABELS, make_car, synth_window
from autopulse.models import HAS_TORCH, cnn_proba, make_cnn
from autopulse.rules import CRITICAL, INFO, WARNING, evaluate
from autopulse.signatures import (ORDERS, annotate_peaks, envelope_spectrum, features,
                                  order_amplitudes, spectrum, stft_image)
from autopulse.telemetry import OBD_FAULTS, simulate_drive

MODELS = Path(__file__).parent / "models"
OK_C, WARN_C, CRIT_C, INFO_C, MUTED = "#3ddc97", "#f5a524", "#f31260", "#4ea8ff", "#8a93a6"
SEV_COLOR = {CRITICAL: CRIT_C, WARNING: WARN_C, INFO: INFO_C, "ok": OK_C}
SEV_ICON = {CRITICAL: "⛔", WARNING: "⚠️", INFO: "ℹ️", "ok": "✅"}

st.set_page_config(page_title="AutoPulse", page_icon="🚗", layout="wide")
st.markdown("""
<style>
.block-container {padding-top: 1.6rem;}
.ap-card {border-radius: 12px; padding: 14px 16px; margin-bottom: 10px; background: #161b26;
          border-left: 5px solid var(--c);}
.ap-card h4 {margin: 0 0 4px 0; font-size: 1.02rem;}
.ap-card p {margin: 0 0 6px 0; color: #c9cfdb; font-size: 0.92rem;}
.ap-card ul {margin: 0 0 4px 18px; padding: 0; font-size: 0.9rem;}
.ap-row {display:flex; justify-content:space-between; align-items:center; padding:8px 12px;
         border-radius:10px; background:#161b26; margin-bottom:6px; font-size:0.95rem;}
.ap-score {font-size: 3.2rem; font-weight: 800; line-height: 1;}
</style>
""", unsafe_allow_html=True)


# ---------------------------------------------------------------- model loading
@st.cache_resource
def load_models():
    if not (MODELS / "metrics.json").exists():
        return None
    metrics = json.loads((MODELS / "metrics.json").read_text())
    feat = {"SVM (RBF)": joblib.load(MODELS / "svm.joblib"),
            "Softmax regression": joblib.load(MODELS / "softmax.joblib"),
            "ANN (MLP + softmax)": joblib.load(MODELS / "ann.joblib")}
    cnn = None
    if HAS_TORCH and (MODELS / "cnn.pt").exists():
        import torch
        cnn = make_cnn(len(ENGINE_FAULTS))
        cnn.load_state_dict(torch.load(MODELS / "cnn.pt", weights_only=True))
        cnn.eval()
    prior = np.load(MODELS / "population_prior.npz")
    return {"metrics": metrics, "feat": feat, "cnn": cnn, "prior": (prior["mean"], prior["std"])}


M = load_models()
if M is None:
    st.error("Models not trained yet. Run:  `.venv\\Scripts\\python train.py`")
    st.stop()


def classify(w):
    x = features(w["signal"], w["fs"], w["rpm"], w["crank_speed"])
    out = {name: m.predict_proba(x[None])[0] for name, m in M["feat"].items()}
    if M["cnn"] is not None:
        out["CNN (spectrogram)"] = cnn_proba(M["cnn"], [stft_image(w["signal"], w["fs"])[2]])[0]
    ensemble = np.mean(list(out.values()), axis=0)
    return out, ensemble


def card(sev, title, msg, actions=(), url=""):
    acts = "".join(f"<li>{a}</li>" for a in actions)
    link = f'<a href="{url}" target="_blank">📍 Find nearest help on Maps</a>' if url else ""
    st.markdown(f'<div class="ap-card" style="--c:{SEV_COLOR[sev]}"><h4>{SEV_ICON[sev]} {title}</h4>'
                f'<p>{msg}</p>{"<ul>" + acts + "</ul>" if acts else ""}{link}</div>', unsafe_allow_html=True)


def fig_style(fig, h=280, **kw):
    fig.update_layout(height=h, margin=dict(l=10, r=10, t=36, b=10), template="plotly_dark",
                      paper_bgcolor="rgba(0,0,0,0)", plot_bgcolor="rgba(0,0,0,0)",
                      legend=dict(orientation="h", y=1.12), **kw)
    return fig


# ---------------------------------------------------------------- sidebar: the car under test
st.sidebar.title("🚗 AutoPulse")
st.sidebar.caption("Multi-sensor signature extraction & pattern recognition for vehicle health")
st.sidebar.subheader("Simulated car")
# Query parameters preselect a scenario and a single view, e.g. ?view=signature&engine=knock
# (used to capture report screenshots; normal use shows all tabs).
qp = st.query_params
car_id = st.sidebar.selectbox("Car (unseen by models: 8, 9)", list(range(10)), index=8)
engine_fault = st.sidebar.selectbox("Engine condition (sound / vibration)", ENGINE_FAULTS,
                                    index=ENGINE_FAULTS.index(qp.get("engine", "healthy")),
                                    format_func=lambda k: FAULT_LABELS[k])
severity = st.sidebar.slider("Fault severity", 0.2, 1.0, 0.8, 0.05)
obd_fault = st.sidebar.selectbox("Vehicle condition (OBD / chassis)", list(OBD_FAULTS),
                                 index=list(OBD_FAULTS).index(qp.get("obd", "none")),
                                 format_func=lambda k: OBD_FAULTS[k])
ambient = st.sidebar.slider("Ambient temperature (°C)", -5, 45, 24)
if st.sidebar.button("🎲 New random sample", width="stretch"):
    st.session_state.seed = int(np.random.randint(1e9))
seed = st.session_state.setdefault("seed", 42)
car = make_car(car_id)

VIEWS = ["startup", "drive", "signature", "baseline", "wear", "models"]
view = qp.get("view")
if view in VIEWS:
    # one view only: every view still renders, the others are hidden by their container key
    tabs = [st.container(key=f"view_{v}") for v in VIEWS]
    hidden = ", ".join(f".st-key-view_{v}" for v in VIEWS if v != view)
    st.markdown(f"<style>{hidden} {{display: none;}}</style>", unsafe_allow_html=True)
else:
    tabs = st.tabs(["🚦 Startup Check", "📈 Live Drive", "🔬 Signature Lab",
                    "🧠 Adaptive Baseline", "🔋 Wear & Health", "📊 Models"])


# ---------------------------------------------------------------- 1. startup check
def car_svg(status):
    c = {k: SEV_COLOR[v] for k, v in status.items()}
    return f"""
<svg viewBox="0 0 220 400" width="100%" style="max-width:240px">
  <rect x="40" y="20" width="140" height="360" rx="55" fill="#1e2433" stroke="#3a4256" stroke-width="2"/>
  <rect x="55" y="40" width="110" height="95" rx="30" fill="{c['engine']}" opacity="0.85"/>
  <text x="110" y="92" text-anchor="middle" fill="#0e1117" font-size="13" font-weight="700">ENGINE</text>
  <rect x="62" y="150" width="96" height="70" rx="10" fill="#2a3245"/>
  <rect x="62" y="228" width="96" height="60" rx="10" fill="#2a3245"/>
  <rect x="70" y="300" width="80" height="55" rx="18" fill="{c['fuel']}" opacity="0.85"/>
  <text x="110" y="333" text-anchor="middle" fill="#0e1117" font-size="12" font-weight="700">FUEL</text>
  <rect x="20" y="70" width="22" height="55" rx="6" fill="{c['tyre_fl']}"/>
  <rect x="178" y="70" width="22" height="55" rx="6" fill="{c['tyre_fr']}"/>
  <rect x="20" y="280" width="22" height="55" rx="6" fill="{c['tyre_rl']}"/>
  <rect x="178" y="280" width="22" height="55" rx="6" fill="{c['tyre_rr']}"/>
  <circle cx="68" cy="160" r="9" fill="{c['battery']}"/><text x="68" y="164" text-anchor="middle" font-size="10" fill="#0e1117">⚡</text>
  <circle cx="152" cy="160" r="9" fill="{c['cooling']}"/><text x="152" y="164" text-anchor="middle" font-size="10" fill="#0e1117">❄</text>
</svg>"""


def startup_checks():
    """Each check returns (subsystem, status, detail). Uses a cold-start window + OBD state."""
    rng = np.random.default_rng(seed)
    w = synth_window(engine_fault, rpm=1100, car=car, severity=severity, coolant_c=ambient + 3,
                     misfire_cyl=1, rng=rng)
    _, ens = classify(w)
    k = int(ens.argmax())
    eng = ("ok", f"Cold-start signature normal ({ens[0]:.0%} healthy)") if k == 0 else \
          (CRITICAL if ENGINE_FAULTS[k] in ("misfire", "knock") else WARNING,
           f"{FAULT_LABELS[ENGINE_FAULTS[k]]} detected ({ens[k]:.0%} confidence)")
    dtc = ("ok", "No stored / pending / permanent codes")
    if ENGINE_FAULTS[k] == "misfire":
        dtc = (WARNING, "P0302 - Cylinder 2 misfire detected")
    f = obd_fault
    checks = [
        ("ECU & fault codes (OBD-II)", *dtc),
        ("Battery & starter (crank scan)", *((WARNING, "Charging voltage low at idle")
                                              if f in ("alternator_failure", "belt_broken")
                                              else ("ok", "Cranking dip 1.9 V - battery healthy"))),
        ("Engine sound & vibration (AI)", *eng),
        ("Cooling system", *((CRITICAL, "Coolant loss suspected") if f in ("coolant_leak", "belt_broken")
                             else (INFO, "Warm-up slower than this car's normal") if f == "thermostat_stuck"
                             else ("ok", "Coolant temperature plausible"))),
        ("Lubrication", *((CRITICAL, "Oil pressure below limit") if f == "low_oil_pressure"
                          else ("ok", "Oil pressure normal for temperature"))),
        ("Fuel & intake", *((CRITICAL, "Fuel level dropping without consumption") if f == "fuel_leak"
                            else (WARNING, "Lean fuel trims at idle - vacuum leak?") if f == "vacuum_leak"
                            else ("ok", "Fuel trims within ±5%"))),
        ("Tyres", *((CRITICAL, "Front-left pressure critically low") if f == "puncture"
                    else (WARNING, "Rear-right slowly losing pressure") if f == "slow_leak"
                    else ("ok", "All four 32-34 psi"))),
        ("Brakes", "ok", "Pads ~68%, fluid OK"),
    ]
    zone = {"engine": eng[0], "battery": checks[1][1], "cooling": checks[3][1],
            "fuel": checks[5][1], "tyre_fl": "ok", "tyre_fr": "ok", "tyre_rl": "ok", "tyre_rr": "ok"}
    if f == "puncture":
        zone["tyre_fl"] = CRITICAL
    if f == "slow_leak":
        zone["tyre_rr"] = WARNING
    if f == "low_oil_pressure":
        zone["engine"] = CRITICAL
    return checks, zone


with tabs[0]:
    st.header("Pre-drive health check")
    st.caption("Runs at key-on: OBD-II codes, crank scan, a cold-start sound/vibration window through "
               "4 classifiers, and fluid/tyre plausibility checks.")
    left, right = st.columns([1, 2])
    run = right.button("▶ Start car", type="primary")
    checks, zone = startup_checks()
    svg_slot = left.empty()
    rows_slot = right.container()
    if run:
        pending = {k: "ok" for k in zone}
        svg_slot.markdown(car_svg({k: "ok" for k in zone}).replace(OK_C, "#3a4256"), unsafe_allow_html=True)
        slots = [rows_slot.empty() for _ in checks]
        for s, (name, _, _) in zip(slots, checks):
            s.markdown(f'<div class="ap-row"><span>⏳ {name}</span><span style="color:{MUTED}">waiting</span></div>',
                       unsafe_allow_html=True)
        for s, (name, sev, detail) in zip(slots, checks):
            s.markdown(f'<div class="ap-row"><span>🔄 {name}</span><span style="color:{MUTED}">checking…</span></div>',
                       unsafe_allow_html=True)
            time.sleep(0.45)
            s.markdown(f'<div class="ap-row"><span>{SEV_ICON[sev]} {name}</span>'
                       f'<span style="color:{SEV_COLOR[sev]}">{detail}</span></div>', unsafe_allow_html=True)
    else:
        for name, sev, detail in checks:
            rows_slot.markdown(f'<div class="ap-row"><span>{SEV_ICON[sev]} {name}</span>'
                               f'<span style="color:{SEV_COLOR[sev]}">{detail}</span></div>', unsafe_allow_html=True)
    svg_slot.markdown(car_svg(zone), unsafe_allow_html=True)
    penalty = {CRITICAL: 35, WARNING: 12, INFO: 4, "ok": 0}
    score = max(0, 100 - sum(penalty[s] for _, s, _ in checks))
    col = OK_C if score >= 85 else WARN_C if score >= 60 else CRIT_C
    verdict = ("Good to go" if score >= 85 else "Drive, but book a service" if score >= 60
               else "Do not drive - see alerts")
    left.markdown(f'<div class="ap-score" style="color:{col}">{score}</div>'
                  f'<div style="color:{col};font-weight:600">{verdict}</div>', unsafe_allow_html=True)


# ---------------------------------------------------------------- 2. live drive
@st.cache_data
def drive(fault, amb, sd):
    return simulate_drive(fault, duration_s=900, ambient_c=amb, seed=sd % 1000)


with tabs[1]:
    st.header("Live drive telemetry (OBD-II, 1 Hz)")
    df = drive(obd_fault, float(ambient), seed)
    c1, c2 = st.columns([3, 1])
    t_now = c1.slider("Drive time (s)", 10, len(df) - 1, min(int(qp.get("t", len(df) - 1)), len(df) - 1), 10)
    if c2.button("▶ Replay drive"):
        st.session_state.replay = True
    slot = st.empty()

    def render(t):
        d = df.iloc[:t + 1]
        last = d.iloc[-1]
        with slot.container():
            m = st.columns(6)
            m[0].metric("Speed", f"{last.speed_kph:.0f} km/h")
            m[1].metric("RPM", f"{last.rpm:.0f}")
            m[2].metric("Coolant", f"{last.coolant_c:.0f} °C")
            m[3].metric("Oil pressure", f"{last.oil_pressure_bar:.1f} bar")
            m[4].metric("Battery", f"{last.battery_v:.1f} V")
            m[5].metric("Fuel", f"{last.fuel_level_pct:.1f} %")
            alerts = evaluate(d)
            g, a = st.columns([2, 1])
            with a:
                st.subheader("Alerts & guidance")
                if not alerts:
                    card("ok", "All systems normal", "No hard limits or rules triggered.")
                for al in alerts:
                    card(al.severity, al.title, al.message, al.actions, al.maps_url)
            with g:
                fig = go.Figure()
                for col, name, clr in [("coolant_c", "Coolant °C", "#ff7a45"), ("speed_kph", "Speed km/h", MUTED)]:
                    fig.add_scatter(x=d.t, y=d[col], name=name, line=dict(color=clr))
                fig.add_hline(y=112, line_dash="dot", line_color=CRIT_C, annotation_text="critical")
                st.plotly_chart(fig_style(fig, 230, title="Temperature & speed"), width="stretch")
                gc = st.columns(2)
                fig = go.Figure()
                fig.add_scatter(x=d.t, y=d.battery_v, name="Battery V", line=dict(color="#ffd23f"))
                fig.add_scatter(x=d.t, y=d.oil_pressure_bar, name="Oil bar", line=dict(color="#4ea8ff"), yaxis="y2")
                fig_style(fig, 230, title="Electrical & lubrication",
                          yaxis2=dict(overlaying="y", side="right", showgrid=False))
                gc[0].plotly_chart(fig, width="stretch")
                fig = go.Figure()
                for col, clr in zip(["tyre_fl_psi", "tyre_fr_psi", "tyre_rl_psi", "tyre_rr_psi"],
                                    ["#f31260", "#3ddc97", "#4ea8ff", "#f5a524"]):
                    fig.add_scatter(x=d.t, y=d[col], name=col[5:7].upper(), line=dict(color=clr))
                gc[1].plotly_chart(fig_style(fig, 230, title="Tyre pressures (psi)"), width="stretch")

    if st.session_state.pop("replay", False):
        for t in range(10, len(df), 15):
            render(t)
            time.sleep(0.05)
    else:
        render(t_now)


# ---------------------------------------------------------------- 3. signature lab
with tabs[2]:
    st.header("Signature lab: time, frequency, order & time-frequency")
    c = st.columns(3)
    rpm = c[0].slider("Engine speed (rpm)", 750, 4000, 1500, 50)
    cold = c[1].toggle("Cold engine", value=False)
    show_s = c[2].slider("Waveform window (ms)", 50, 1000, 200, 50)
    rng = np.random.default_rng(seed)
    w = synth_window(engine_fault, rpm=rpm, car=car, severity=severity,
                     coolant_c=ambient + 3 if cold else 90, misfire_cyl=1, rng=rng)
    x, fs = w["signal"], w["fs"]
    probs, ens = classify(w)

    top = st.columns([2, 1])
    with top[1]:
        k = int(ens.argmax())
        sev = "ok" if k == 0 else WARNING
        card(sev, f"Verdict: {FAULT_LABELS[ENGINE_FAULTS[k]]}",
             f"Ensemble confidence {ens[k]:.0%} · ground truth: {FAULT_LABELS[engine_fault]}")
        fig = go.Figure()
        for name, p in probs.items():
            fig.add_bar(y=[FAULT_LABELS[f].split(" (")[0] for f in ENGINE_FAULTS], x=p, name=name, orientation="h")
        st.plotly_chart(fig_style(fig, 380, title="Class probabilities per model", barmode="group",
                                  xaxis=dict(range=[0, 1])), width="stretch")
    with top[0]:
        n = int(show_s / 1000 * fs)
        fig = go.Figure(go.Scatter(x=np.arange(n) / fs * 1000, y=x[:n], line=dict(width=1, color="#4ea8ff")))
        st.plotly_chart(fig_style(fig, 200, title="Time domain - engine block vibration",
                                  xaxis_title="ms"), width="stretch")
        f, X = spectrum(x, fs)
        fig = go.Figure(go.Scatter(x=f, y=20 * np.log10(X + 1e-9), line=dict(width=1, color="#3ddc97")))
        for lbl, fr in annotate_peaks(rpm, car).items():
            fig.add_vline(x=fr, line_dash="dot", line_color=WARN_C, annotation_text=lbl,
                          annotation_textangle=-90, annotation_font_size=10)
        st.plotly_chart(fig_style(fig, 240, title="Frequency domain - FFT (dB)", xaxis_title="Hz",
                                  xaxis=dict(range=[0, 10000])), width="stretch")
    row = st.columns(2)
    fS, tS, S = stft_image(x, fs)
    fig = go.Figure(go.Heatmap(z=S, x=tS, y=fS, colorscale="Inferno", showscale=False))
    row[0].plotly_chart(fig_style(fig, 280, title="Time-frequency - STFT spectrogram (CNN input)",
                                  xaxis_title="s", yaxis_title="Hz"), width="stretch")
    fe, E = envelope_spectrum(x, fs)
    sel = fe < 400
    fig = go.Figure(go.Scatter(x=fe[sel], y=E[sel], line=dict(color="#c792ea")))
    for o in (0.5, 1, 1.5, 2):
        fig.add_vline(x=o * rpm / 60, line_dash="dot", line_color=MUTED)
    fig.add_vline(x=car.bpfo_ratio * car.pulley_ratio * rpm / 60, line_dash="dash", line_color=CRIT_C,
                  annotation_text="bearing BPFO")
    row[1].plotly_chart(fig_style(fig, 280, title="Envelope spectrum - impact repetition rate",
                                  xaxis_title="Hz"), width="stretch")
    row = st.columns(2)
    oa = order_amplitudes(f, X, rpm)
    fig = go.Figure(go.Bar(x=[f"{o}x" for o in ORDERS], y=oa, marker_color="#ffd23f"))
    row[0].plotly_chart(fig_style(fig, 240, title="Order spectrum (engine orders)"), width="stretch")
    cs = w["crank_speed"]
    dip = cs < np.mean(cs) - 2 * np.std(cs[cs > np.median(cs) - 3 * np.std(cs)]) if len(cs) > 3 else np.zeros(len(cs), bool)
    fig = go.Figure(go.Bar(y=cs - np.median(cs), marker_color=np.where(dip, CRIT_C, "#4ea8ff")))
    row[1].plotly_chart(fig_style(fig, 240, title="Crank speed deviation per firing (rpm) - misfire shows as dips",
                                  xaxis_title="firing event"), width="stretch")


# ---------------------------------------------------------------- 4. adaptive baseline
@st.cache_data(show_spinner="Simulating 8 months of one car (seasons + ageing + a late fault)…")
def life():
    return simulate_life(*M["prior"])


with tabs[3]:
    st.header("Adaptive baseline: learning what's normal for this car")
    st.caption("One car, 240 days: summer → winter (cold starts get noisier), normal ageing, and valve-train "
               "wear starting on day 175. Each day: one cold-start and one warm-idle window.")
    L = life()
    ctx = st.radio("Context", ["cold_start", "warm_idle"], horizontal=True,
                   format_func=lambda s: s.replace("_", " ").title())
    d = L[L.context == ctx]
    fault_day = int(L[L.fault_active].day.min())
    fig = go.Figure()
    fig.add_vrect(x0=fault_day, x1=d.day.max(), fillcolor=CRIT_C, opacity=0.08, line_width=0,
                  annotation_text="real fault", annotation_position="top left")
    fig.add_scatter(x=d.day, y=d.static_score, name="Static baseline (fixed 'healthy')", line=dict(color=WARN_C))
    fig.add_scatter(x=d.day, y=d.adaptive_score, name="AutoPulse adaptive baseline", line=dict(color=OK_C))
    fig.add_scatter(x=d.day, y=d.ambient_c, name="Ambient °C", yaxis="y2", line=dict(color=MUTED, dash="dot"))
    fig.add_hline(y=3.0, line_dash="dash", line_color="#ffffff", annotation_text="alarm threshold")
    st.plotly_chart(fig_style(fig, 380, title="Anomaly score over time", xaxis_title="day",
                              yaxis=dict(title="anomaly score (RMS z)", type="log"),
                              yaxis2=dict(overlaying="y", side="right", showgrid=False, title="°C")),
                    width="stretch")

    def summary(col):
        before = L[(~L.fault_active) & (L.day >= 14)]
        after = L[L.fault_active]
        fa_days = before[before[col]].day.nunique()
        det = after[after[col]].day.min()
        return fa_days, (det - fault_day) if np.isfinite(det) else None

    s_fa, s_det = summary("static_alarm")
    a_fa, a_det = summary("adaptive_alarm")
    m = st.columns(4)
    m[0].metric("False-alarm days - static", s_fa)
    m[1].metric("False-alarm days - adaptive", a_fa, delta=a_fa - s_fa, delta_color="inverse")
    m[2].metric("Detection delay - static", f"{s_det} d" if s_det is not None else "missed")
    m[3].metric("Detection delay - adaptive", f"{a_det} d" if a_det is not None else "missed")
    st.info("**How it adapts safely:** per-context baselines (cold start ≠ warm idle), slow EWMA updates, "
            "updates only from healthy-looking windows, frozen while an anomaly is open, anchored to a "
            "population prior, and hard safety limits that never adapt.")


# ---------------------------------------------------------------- 5. wear & health
with tabs[4]:
    st.header("Component health: normal ageing, like phone battery health")
    W = simulate_wear()
    last = W.iloc[-1]
    cols = st.columns(4)
    items = [("🔋 Battery", last.battery_health_pct), ("🛢️ Oil life", last.oil_life_pct),
             ("🛑 Brake pads", last.brake_pad_pct), ("🛞 Tyre tread", last.tyre_tread_pct)]
    for c, (name, v) in zip(cols, items):
        clr = OK_C if v > 50 else WARN_C if v > 25 else CRIT_C
        c.markdown(f'<div class="ap-card" style="--c:{clr}"><h4>{name}</h4>'
                   f'<div class="ap-score" style="font-size:2.2rem;color:{clr}">{v:.0f}%</div></div>',
                   unsafe_allow_html=True)
        c.progress(int(v) / 100)
    days_left = predict_days_to(W.day.values[-90:], W.crank_dip_comp_v.values[-90:], 3.2)
    st.subheader("Battery: cranking voltage dip (from the crank scan)")
    fig = go.Figure()
    fig.add_scatter(x=W.day, y=W.crank_dip_v, name="Raw dip (cold mornings look worse)",
                    mode="markers", marker=dict(size=4, color=MUTED))
    fig.add_scatter(x=W.day, y=W.crank_dip_comp_v, name="Temperature-compensated dip",
                    line=dict(color=OK_C))
    fig.add_hline(y=3.2, line_dash="dash", line_color=CRIT_C, annotation_text="replace battery")
    st.plotly_chart(fig_style(fig, 300, xaxis_title="day", yaxis_title="V"), width="stretch")
    if days_left:
        card(INFO, f"Battery ageing normally - estimated replacement in ~{days_left / 30:.0f} months",
             "Cold-weather dips are compensated for, so winter mornings don't raise false alarms. "
             "A sudden step change would be flagged as an anomaly instead.")


# ---------------------------------------------------------------- 6. models
with tabs[5]:
    st.header("Pattern recognition models")
    met = M["metrics"]
    st.caption(f"Trained on {met['n_train']} synthetic windows, tested on {met['n_test']} windows. "
               f"Split {met['split']}: test engines were never heard in training.")
    rows = [{"Model": k, "Accuracy": f"{v['accuracy']:.1%}", "Macro F1": f"{v['macro_f1']:.3f}"}
            for k, v in met["models"].items()]
    st.dataframe(rows, hide_index=True, width="stretch")
    pick = st.selectbox("Confusion matrix", list(met["models"]))
    cm = np.array(met["models"][pick]["confusion"])
    labels = [FAULT_LABELS[f].split(" (")[0] for f in met["classes"]]
    fig = go.Figure(go.Heatmap(z=cm, x=labels, y=labels, colorscale="Greens", text=cm, texttemplate="%{text}"))
    st.plotly_chart(fig_style(fig, 460, xaxis_title="predicted", yaxis_title="true",
                              yaxis=dict(autorange="reversed")), width="stretch")
    st.caption(f"{len(met['features'])} hand-crafted signature features: " + ", ".join(met["features"]))

    real_file = MODELS / "real_metrics.json"
    if real_file.exists():
        R = json.loads(real_file.read_text())
        st.divider()
        st.header("Real-data results")
        st.caption("Every number below is measured on real recordings, never on the simulator "
                   "(evaluate_real.py, public datasets in data/raw).")
        for key, title in (("audio", "Real engine sound: healthy / misfire / tappet / belt"),
                           ("cwru", "Real bearing vibration (CWRU)"),
                           ("condition", "Real engine telemetry table (good / faulty)")):
            if key not in R:
                continue
            r = R[key]
            st.subheader(title)
            st.caption(f"{r['dataset']} · {r['split']}")
            rows = []
            for m, v in r["models"].items():
                row = {"Model": m, "Accuracy": f"{v['accuracy']['mean']:.1%} ± {v['accuracy']['std']:.1%}",
                       "Macro F1": f"{v['macro_f1']['mean']:.3f}"}
                if "recording_accuracy" in v:
                    row["Per-recording accuracy"] = f"{v['recording_accuracy']:.1%}"
                rows.append(row)
            st.dataframe(rows, hide_index=True, width="stretch")
            if "zero_shot_from_simulator" in r:
                z = r["zero_shot_from_simulator"]
                st.caption("Trained on the simulator only, tested on this real audio (sim-to-real gap): " +
                           ", ".join(f"{k} F1 {v['macro_f1']:.2f}" for k, v in z.items()))
            if "majority_class_accuracy" in r:
                st.caption(f"Always guessing the majority class scores {r['majority_class_accuracy']:.1%}; "
                           f"healthy-only anomaly AUC {r['healthy_only_anomaly_auc']['mean']:.2f}.")
        if "obd" in R:
            r = R["obd"]
            st.subheader("Adaptive baseline on real driving (carOBD)")
            st.caption(r["split"])
            fa = r["false_alarm_trip_rate"]
            c = st.columns(2)
            c[0].metric("Healthy trips with a false alarm · adaptive", f"{fa['adaptive']:.0%}")
            c[1].metric("Healthy trips with a false alarm · static", f"{fa['static']:.0%}")
            rows = [{"Fault injected into real trips": f.replace("_", " "),
                     "Detected · adaptive": f"{v['adaptive']['detection_rate']:.0%}",
                     "Delay · adaptive (min)": v["adaptive"]["median_delay_min"],
                     "Detected · static": f"{v['static']['detection_rate']:.0%}",
                     "Delay · static (min)": v["static"]["median_delay_min"]}
                    for f, v in r["injected_fault_detection"].items()]
            st.dataframe(rows, hide_index=True, width="stretch")

    ml_file = MODELS / "matlab_crosscheck.json"
    if ml_file.exists():
        ML = json.loads(ml_file.read_text())
        st.divider()
        st.header("MATLAB cross-checks")
        if "crank" in ML:
            c = ML["crank"]
            st.subheader("Misfire detection on MATLAB's crankshaft simulation")
            st.caption(f"{c['source']} · {c['runs']} runs, {c['firing_events']:,} firing events")
            m = st.columns(2)
            m[0].metric("Misfire detected (detector trained on our Python simulator)",
                        f"{c['detector_trained_on_python_sim']['accuracy']:.0%}")
            m[1].metric("Misfiring cylinder named (crank physics, no training)",
                        f"{c['cylinder_identification_accuracy']:.0%}")
        if "dsp" in ML:
            d = ML["dsp"]
            st.subheader("Signature features recomputed in MATLAB on real audio")
            st.caption(f"{d['features_compared']} features on {d['windows']} real windows · worst relative "
                       f"difference {d['worst_max_rel_diff']:.1e} · minimum correlation {d['min_correlation']:.6f}")
