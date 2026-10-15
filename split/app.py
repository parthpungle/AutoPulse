"""AutoPulse dashboard: startup health check, live drive, signature lab, adaptive baseline, wear, models."""
import json
import time
from pathlib import Path

import joblib
import numpy as np
import plotly.graph_objects as go
import streamlit as st
from scipy.signal import welch

from autopulse.baseline import predict_days_to, simulate_life, simulate_wear
import streamlit.components.v1 as components

from autopulse.generator import CAR_TYPES, ENGINE_FAULTS, FAULT_LABELS, make_car, synth_window
from autopulse.ui_car3d import car3d_html
from autopulse.models import HAS_TORCH, cnn_proba, make_cnn
from autopulse.rules import CRITICAL, INFO, WARNING, evaluate
from autopulse.signatures import (ORDERS, annotate_peaks, envelope_spectrum, features,
                                  order_amplitudes, spectrum, stft_image)
from autopulse.telemetry import OBD_FAULTS, simulate_drive

MODELS = Path(__file__).parent / "models"
# NavPort-style night palette with AutoPulse's ignition-orange accent
OK_C, WARN_C, CRIT_C, INFO_C, MUTED, ACCENT = "#74C79C", "#E4B667", "#F0614F", "#7FB3E8", "#A39C92", "#FF8A4C"
INK, INK2, LINE, PANEL = "#F4F1EC", "#CBC5BC", "#312D29", "#1A1816"
SEV_COLOR = {CRITICAL: CRIT_C, WARNING: WARN_C, INFO: INFO_C, "ok": OK_C}
SEV_WORD = {CRITICAL: "FAULT", WARNING: "CHECK", INFO: "NOTE", "ok": "OK"}

st.set_page_config(page_title="AutoPulse", page_icon="🚗", layout="wide")
st.markdown(f"""
<style>
@import url('https://fonts.googleapis.com/css2?family=IBM+Plex+Mono:wght@400;500;600&family=IBM+Plex+Sans:wght@400;500;600&display=swap');
html, body, .stApp, [class*="st-"], button, input, textarea {{ font-family: 'IBM Plex Sans', 'Segoe UI', sans-serif; }}
.stApp {{ background-color: #121110;
  background-image: radial-gradient(rgba(244,241,236,.065) 1px, transparent 1.2px); background-size: 14px 14px; }}
[data-testid="stHeader"] {{ background: transparent; }}
[data-testid="stSidebar"] {{ background: {PANEL}; border-right: 1px solid {LINE}; }}
.block-container {{ padding-top: 1.4rem; }}
h1, h2, h3 {{ font-family: 'IBM Plex Sans', sans-serif !important; font-weight: 600 !important; letter-spacing: -.01em; color: {INK}; }}
[data-testid="stWidgetLabel"] p, [data-testid="stCaptionContainer"], .stTabs [data-baseweb="tab"] p,
[data-testid="stMetricLabel"] p {{ font-family: 'IBM Plex Mono', monospace !important; text-transform: uppercase;
  letter-spacing: .16em; font-size: .72rem !important; color: {MUTED} !important; }}
[data-testid="stCaptionContainer"] {{ text-transform: none; letter-spacing: .02em; }}
.stTabs [aria-selected="true"] p {{ color: {ACCENT} !important; }}
.stTabs [data-baseweb="tab-highlight"] {{ background-color: {ACCENT}; }}
[data-testid="stMetricValue"] {{ font-family: 'IBM Plex Mono', monospace; }}
.ap-eyebrow {{ font: 500 .7rem 'IBM Plex Mono', monospace; letter-spacing: .34em; color: {ACCENT}; text-transform: uppercase; }}
.ap-brand {{ display:flex; align-items:center; gap:10px; font: 600 1.25rem 'IBM Plex Sans'; color:{INK}; margin: 4px 0 2px; }}
.ap-sub {{ font: 500 .66rem 'IBM Plex Mono', monospace; letter-spacing: .26em; color: {MUTED}; margin-bottom: 14px; }}
.ap-card {{ border-radius: 8px; padding: 13px 15px; margin-bottom: 10px; background: rgba(26,24,22,.94);
  border: 1px solid {LINE}; border-left: 3px solid var(--c); }}
.ap-card h4 {{ margin: 0 0 4px 0; font-size: 1rem; color: {INK}; }}
.ap-card p {{ margin: 0 0 6px 0; color: {INK2}; font-size: .9rem; }}
.ap-card ul {{ margin: 0 0 4px 18px; padding: 0; font-size: .88rem; color: {INK}; }}
.ap-card a {{ font: 500 .72rem 'IBM Plex Mono', monospace; letter-spacing: .14em; color: {ACCENT}; text-transform: uppercase; }}
.ap-board {{ border: 1px solid {LINE}; border-radius: 10px; background: rgba(26,24,22,.94); padding: 12px 16px 4px; }}
.ap-board-head {{ display:flex; justify-content:space-between; font: 500 .64rem 'IBM Plex Mono', monospace;
  letter-spacing: .3em; color: {MUTED}; padding-bottom: 9px; border-bottom: 1px solid {LINE}; }}
.ap-row {{ display:grid; grid-template-columns: 1.25fr 1.6fr 64px; gap: 10px; align-items:center; padding: 10px 0;
  border-bottom: 1px solid {LINE}; font: 500 .78rem 'IBM Plex Mono', monospace; letter-spacing: .1em; }}
.ap-row:last-child {{ border-bottom: 0; }}
.ap-row .n {{ color: {INK}; text-transform: uppercase; }}
.ap-row .d {{ color: {INK2}; letter-spacing: .02em; font-family: 'IBM Plex Sans'; font-size: .84rem; }}
.ap-row .s {{ justify-self: end; letter-spacing: .2em; }}
.ap-score {{ font: 500 3.4rem/1 'IBM Plex Mono', monospace; }}
.ap-verdict {{ font: 500 .74rem 'IBM Plex Mono', monospace; letter-spacing: .24em; text-transform: uppercase; }}
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
    link = f'<a href="{url}" target="_blank">Nearest help on maps →</a>' if url else ""
    tag = f'<span class="ap-eyebrow" style="color:{SEV_COLOR[sev]};letter-spacing:.24em">{SEV_WORD[sev]}</span>'
    st.markdown(f'<div class="ap-card" style="--c:{SEV_COLOR[sev]}">{tag}<h4>{title}</h4>'
                f'<p>{msg}</p>{"<ul>" + acts + "</ul>" if acts else ""}{link}</div>', unsafe_allow_html=True)


def fig_style(fig, h=280, **kw):
    fig.update_layout(height=h, margin=dict(l=10, r=10, t=40, b=10), template="plotly_dark",
                      paper_bgcolor="rgba(0,0,0,0)", plot_bgcolor="rgba(18,17,16,.55)",
                      font=dict(family="IBM Plex Sans, Segoe UI, sans-serif", color=INK2, size=12),
                      title_font=dict(family="IBM Plex Mono, monospace", size=12, color=INK),
                      legend=dict(orientation="h", y=1.14, font=dict(size=11)), **kw)
    fig.update_xaxes(gridcolor=LINE, zerolinecolor=LINE, linecolor=LINE)
    fig.update_yaxes(gridcolor=LINE, zerolinecolor=LINE, linecolor=LINE)
    return fig


def board(rows, head=("SUBSYSTEM", "READING · STATUS")):
    """Departure-board style status list (NavPort look)."""
    body = "".join(f'<div class="ap-row"><span class="n">{n}</span><span class="d">{d}</span>'
                   f'<span class="s" style="color:{SEV_COLOR.get(s, MUTED)}">{SEV_WORD.get(s, s.upper())}</span></div>'
                   for n, s, d in rows)
    return f'<div class="ap-board"><div class="ap-board-head"><span>{head[0]}</span><span>{head[1]}</span></div>{body}</div>'


# ---------------------------------------------------------------- sidebar: the car under test
st.sidebar.markdown(
    '<div class="ap-brand"><svg width="22" height="22" viewBox="0 0 24 24"><circle cx="12" cy="12" r="10.5" '
    'fill="none" stroke="#FF8A4C" stroke-width="1.6"/><path d="M3.5 12h4l2-5 3 10 2.2-7 1.3 2H20.5" fill="none" '
    'stroke="#F4F1EC" stroke-width="1.7" stroke-linejoin="round" stroke-linecap="round"/></svg>AutoPulse</div>'
    '<div class="ap-sub">PREDICTIVE VEHICLE HEALTH</div>', unsafe_allow_html=True)
# Query parameters preselect a scenario and a single view, e.g. ?view=signature&engine=knock
# (used to capture report screenshots; normal use shows all tabs).
qp = st.query_params
car_type = st.sidebar.selectbox("Car type", list(CAR_TYPES),
                                index=list(CAR_TYPES).index(qp.get("car", "sedan")),
                                format_func=lambda k: CAR_TYPES[k]["label"])
car_id = st.sidebar.selectbox("Unit (models never trained on 8, 9)", list(range(10)), index=8)
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
car = make_car(car_id, car_type)

VIEWS = ["startup", "drive", "signature", "baseline", "wear", "models"]
view = qp.get("view")
if view in VIEWS:
    # one view only: every view still renders, the others are hidden by their container key
    tabs = [st.container(key=f"view_{v}") for v in VIEWS]
    hidden = ", ".join(f".st-key-view_{v}" for v in VIEWS if v != view)
    st.markdown(f"<style>{hidden} {{display: none;}}</style>", unsafe_allow_html=True)
else:
    tabs = st.tabs(["Startup check", "Live drive", "Signature lab", "Adaptive baseline", "Wear & health", "Models"])


# ---------------------------------------------------------------- 1. startup check
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
    st.markdown('<div class="ap-eyebrow">Key-on scan</div>', unsafe_allow_html=True)
    st.header("Pre-drive health check")
    st.caption(f"{CAR_TYPES[car_type]['label']} · unit {car_id}. Runs at key-on: OBD-II codes, crank scan, a "
               "cold-start sound/vibration window through 4 classifiers, and fluid/tyre plausibility checks.")
    checks, zone = startup_checks()
    left, right = st.columns([1.15, 1])
    with left:
        components.html(car3d_html(car_type, zone, height=430), height=436)
    with right:
        penalty = {CRITICAL: 35, WARNING: 12, INFO: 4, "ok": 0}
        score = max(0, 100 - sum(penalty[s] for _, s, _ in checks))
        col = OK_C if score >= 85 else WARN_C if score >= 60 else CRIT_C
        verdict = ("Good to go" if score >= 85 else "Drive, but book a service" if score >= 60
                   else "Do not drive · see alerts")
        sc, bt = st.columns([1, 1])
        sc.markdown(f'<div class="ap-score" style="color:{col}">{score}</div>'
                    f'<div class="ap-verdict" style="color:{col}">{verdict}</div>', unsafe_allow_html=True)
        run = bt.button("▶ Start car", type="primary", width="stretch")
        slot = st.empty()
        if run:
            for i in range(len(checks) + 1):
                shown = [(n, s, d) for n, s, d in checks[:i]] + \
                        [(n, "checking" if j == i else "waiting", "…") for j, (n, _, _) in enumerate(checks) if j >= i]
                slot.markdown(board(shown, ("PRE-DRIVE CHECK", "READING · STATUS")), unsafe_allow_html=True)
                time.sleep(0.4)
        slot.markdown(board(checks, ("PRE-DRIVE CHECK", "READING · STATUS")), unsafe_allow_html=True)


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
                for col, name, clr in [("coolant_c", "Coolant °C", "#FF8A4C"), ("speed_kph", "Speed km/h", MUTED)]:
                    fig.add_scatter(x=d.t, y=d[col], name=name, line=dict(color=clr))
                fig.add_hline(y=112, line_dash="dot", line_color=CRIT_C, annotation_text="critical")
                st.plotly_chart(fig_style(fig, 230, title="Temperature & speed"), width="stretch")
                gc = st.columns(2)
                fig = go.Figure()
                fig.add_scatter(x=d.t, y=d.battery_v, name="Battery V", line=dict(color="#E4B667"))
                fig.add_scatter(x=d.t, y=d.oil_pressure_bar, name="Oil bar", line=dict(color="#7FB3E8"), yaxis="y2")
                fig_style(fig, 230, title="Electrical & lubrication",
                          yaxis2=dict(overlaying="y", side="right", showgrid=False))
                gc[0].plotly_chart(fig, width="stretch")
                fig = go.Figure()
                for col, clr in zip(["tyre_fl_psi", "tyre_fr_psi", "tyre_rl_psi", "tyre_rr_psi"],
                                    ["#F0614F", "#74C79C", "#7FB3E8", "#E4B667"]):
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
    st.markdown('<div class="ap-eyebrow">Signature extraction</div>', unsafe_allow_html=True)
    st.header("Signature lab: time, frequency, order & time-frequency")
    c = st.columns([1, 0.6, 1, 1.6])
    rpm = c[0].slider("Engine speed (rpm)", 750, 4000, 1500, 50)
    cold = c[1].toggle("Cold engine", value=False)
    show_s = c[2].slider("Waveform window (ms)", 50, 1000, 200, 50)
    compare = c[3].multiselect("Compare car types", [k for k in CAR_TYPES if k != car_type],
                               format_func=lambda k: CAR_TYPES[k]["label"],
                               help="Overlay the same fault, at the same rpm, on other body/engine families")
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
        fig = go.Figure(go.Scatter(x=np.arange(n) / fs * 1000, y=x[:n], line=dict(width=1, color=INFO_C)))
        st.plotly_chart(fig_style(fig, 200, title="TIME DOMAIN · ENGINE BLOCK VIBRATION",
                                  xaxis_title="ms"), width="stretch")
        fig = go.Figure()
        palette = [ACCENT, INFO_C, OK_C, WARN_C, "#C792EA", INK2]
        for i, ct in enumerate([car_type] + compare):
            if ct == car_type:
                sig = x
            else:  # same fault, rpm and seed on another body/engine family
                sig = synth_window(engine_fault, rpm=rpm, car=make_car(car_id, ct), severity=severity,
                                   coolant_c=ambient + 3 if cold else 90, misfire_cyl=1,
                                   rng=np.random.default_rng(seed))["signal"]
            fw, P = welch(sig, fs, nperseg=1024)
            fig.add_scatter(x=fw, y=10 * np.log10(P + 1e-12), name=CAR_TYPES[ct]["label"],
                            line=dict(width=1.6 if ct == car_type else 1.1, color=palette[i % len(palette)]))
        for lbl, fr in annotate_peaks(rpm, car).items():
            fig.add_vline(x=fr, line_dash="dot", line_color=MUTED, annotation_text=lbl,
                          annotation_textangle=-90, annotation_font_size=10)
        st.plotly_chart(fig_style(fig, 260, title="FREQUENCY DOMAIN · FFT POWER SPECTRUM (dB)", xaxis_title="Hz",
                                  xaxis=dict(range=[0, 10000])), width="stretch")
    row = st.columns(2)
    fS, tS, S = stft_image(x, fs)
    fig = go.Figure(go.Heatmap(z=S, x=tS, y=fS, colorscale="Inferno", showscale=False))
    row[0].plotly_chart(fig_style(fig, 280, title="Time-frequency - STFT spectrogram (CNN input)",
                                  xaxis_title="s", yaxis_title="Hz"), width="stretch")
    fe, E = envelope_spectrum(x, fs)
    sel = fe < 400
    fig = go.Figure(go.Scatter(x=fe[sel], y=E[sel], line=dict(color="#C792EA")))
    for o in (0.5, 1, 1.5, 2):
        fig.add_vline(x=o * rpm / 60, line_dash="dot", line_color=MUTED)
    fig.add_vline(x=car.bpfo_ratio * car.pulley_ratio * rpm / 60, line_dash="dash", line_color=CRIT_C,
                  annotation_text="bearing BPFO")
    row[1].plotly_chart(fig_style(fig, 280, title="Envelope spectrum - impact repetition rate",
                                  xaxis_title="Hz"), width="stretch")
    row = st.columns(2)
    f, X = spectrum(x, fs)
    oa = order_amplitudes(f, X, rpm)
    fig = go.Figure(go.Bar(x=[f"{o}x" for o in ORDERS], y=oa, marker_color="#E4B667"))
    row[0].plotly_chart(fig_style(fig, 240, title="Order spectrum (engine orders)"), width="stretch")
    cs = w["crank_speed"]
    dip = cs < np.mean(cs) - 2 * np.std(cs[cs > np.median(cs) - 3 * np.std(cs)]) if len(cs) > 3 else np.zeros(len(cs), bool)
    fig = go.Figure(go.Bar(y=cs - np.median(cs), marker_color=np.where(dip, CRIT_C, "#7FB3E8")))
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
    fig = go.Figure(go.Heatmap(z=cm, x=labels, y=labels, colorscale="Oranges", text=cm, texttemplate="%{text}"))
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
        if "mathworks" in ML:
            mw = ML["mathworks"]
            st.subheader("Blind misfire detection on MathWorks' Simulink engine model")
            st.caption(mw["source"])
            m = st.columns(3)
            m[0].metric("Injected misfires detected", f"{mw['detected_events']} / {mw['misfire_events']}")
            m[1].metric("False alarms on healthy strokes", f"{mw['false_alarm_strokes']} / {mw['healthy_strokes']}")
            m[2].metric("Speed gain · healthy vs misfire (rpm)",
                        f"{mw['speed_gain_rpm']['healthy_median']:+.1f} vs {mw['speed_gain_rpm']['misfire_median']:+.1f}")
        if "dsp" in ML:
            d = ML["dsp"]
            st.subheader("Signature features recomputed in MATLAB")
            st.caption(f"All {d.get('total_features_checked', d['features_compared'])} features checked. "
                       f"{d['features_compared']} on {d['windows']} real audio windows agree to "
                       f"{d['worst_max_rel_diff']:.0e}; filter features (Signal Processing Toolbox) to "
                       f"{max(f['median_rel_diff'] for f in d.get('filter_features', [{'median_rel_diff': 0}])):.0e} "
                       "median; crank features on MATLAB's crank simulation to "
                       f"{(d.get('crank_features') or {}).get('max_rel_diff', 0):.0e}.")
