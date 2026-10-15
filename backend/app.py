"""AutoPulse API: the same simulators, signatures, models, baseline and safety rules as the
Streamlit app, served as JSON for the React frontend.

    .venv\\Scripts\\python -m uvicorn backend.app:app --port 8000
"""
import json
import threading
from functools import lru_cache
from pathlib import Path

import joblib
import numpy as np
from fastapi import FastAPI, File, Form, UploadFile, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, JSONResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel
from scipy.signal import welch

from autopulse.baseline import predict_days_to, simulate_life, simulate_wear
from autopulse.generator import CAR_TYPES, ENGINE_FAULTS, FAULT_LABELS, make_car, synth_window
from autopulse.models import HAS_TORCH, cnn_proba, make_cnn
from autopulse.rules import CRITICAL, INFO, WARNING, evaluate
from autopulse.signatures import (ORDERS, annotate_peaks, envelope_spectrum, features, order_amplitudes,
                                  spectrum, stft_image)
from autopulse.telemetry import OBD_FAULTS, simulate_drive
from autopulse import vibration
from autopulse.vibclassify import make_classifier
from autopulse.vibstream import run_session

ROOT = Path(__file__).resolve().parents[1]
MODELS = ROOT / "models"
DIST = ROOT / "frontend" / "dist"

app = FastAPI(title="AutoPulse API", version="1.0")
app.add_middleware(CORSMiddleware, allow_origins=["http://localhost:5173", "http://127.0.0.1:5173"],
                   allow_methods=["*"], allow_headers=["*"])


# ------------------------------------------------------------------ models
@lru_cache(maxsize=1)
def models():
    feat = {"SVM": joblib.load(MODELS / "svm.joblib"),
            "Softmax": joblib.load(MODELS / "softmax.joblib"),
            "ANN": joblib.load(MODELS / "ann.joblib")}
    cnn = None
    if HAS_TORCH and (MODELS / "cnn.pt").exists():
        import torch
        cnn = make_cnn(len(ENGINE_FAULTS))
        cnn.load_state_dict(torch.load(MODELS / "cnn.pt", weights_only=True))
        cnn.eval()
    prior = np.load(MODELS / "population_prior.npz")
    return feat, cnn, (prior["mean"], prior["std"])


def classify(w):
    feat, cnn, _ = models()
    x = features(w["signal"], w["fs"], w["rpm"], w["crank_speed"])
    out = {name: m.predict_proba(x[None])[0] for name, m in feat.items()}
    if cnn is not None:
        out["CNN"] = cnn_proba(cnn, [stft_image(w["signal"], w["fs"])[2]])[0]
    ens = np.mean(list(out.values()), axis=0)
    return {k: v.round(4).tolist() for k, v in out.items()}, ens


def rnd(a, n=4):
    """Rounded list for JSON; NaN/inf (e.g. days before a baseline exists) become null."""
    arr = np.round(np.asarray(a, dtype=float), n)
    return [None if not np.isfinite(v) else float(v) for v in arr.ravel()] if arr.ndim else \
        (None if not np.isfinite(arr) else float(arr))


class Scenario(BaseModel):
    car_type: str = "sedan"
    unit: int = 8
    engine_fault: str = "healthy"
    severity: float = 0.8
    obd_fault: str = "none"
    ambient: float = 24.0
    seed: int = 42
    rpm: float = 1500.0
    cold: bool = False
    compare: list[str] = []


# ------------------------------------------------------------------ meta
@app.get("/api/meta")
def meta():
    return {"car_types": [{"id": k, "label": v["label"]} for k, v in CAR_TYPES.items()],
            "engine_faults": [{"id": f, "label": FAULT_LABELS[f]} for f in ENGINE_FAULTS],
            "obd_faults": [{"id": k, "label": v} for k, v in OBD_FAULTS.items()],
            "models": ["SVM", "Softmax", "ANN"] + (["CNN"] if models()[1] is not None else [])}


# ------------------------------------------------------------------ startup check
@app.post("/api/startup")
def startup(s: Scenario):
    car = make_car(s.unit, s.car_type)
    w = synth_window(s.engine_fault, rpm=1100, car=car, severity=s.severity, coolant_c=s.ambient + 3,
                     misfire_cyl=1, rng=np.random.default_rng(s.seed))
    votes, ens = classify(w)
    k = int(ens.argmax())
    fault = ENGINE_FAULTS[k]
    eng = ("ok", f"Cold-start signature normal · {ens[0]:.0%} healthy") if k == 0 else \
          (CRITICAL if fault in ("misfire", "knock") else WARNING, f"{FAULT_LABELS[fault]} · {ens[k]:.0%} confidence")
    dtc = ("ok", "No stored, pending or permanent codes")
    if fault == "misfire":
        dtc = (WARNING, "P0302 · cylinder 2 misfire detected")
    f = s.obd_fault
    checks = [
        {"id": "ecu", "zone": "engine", "name": "ECU & fault codes", "status": dtc[0], "detail": dtc[1]},
        {"id": "battery", "zone": "battery", "name": "Battery & starter",
         **({"status": WARNING, "detail": "Charging voltage low at idle"} if f in ("alternator_failure", "belt_broken")
            else {"status": "ok", "detail": "Cranking dip 1.9 V · battery healthy"})},
        {"id": "engine", "zone": "engine", "name": "Engine sound & vibration", "status": eng[0], "detail": eng[1]},
        {"id": "cooling", "zone": "cooling", "name": "Cooling system",
         **({"status": CRITICAL, "detail": "Coolant loss suspected"} if f in ("coolant_leak", "belt_broken")
            else {"status": INFO, "detail": "Warm-up slower than this car's normal"} if f == "thermostat_stuck"
            else {"status": "ok", "detail": "Coolant temperature plausible"})},
        {"id": "oil", "zone": "engine", "name": "Lubrication",
         **({"status": CRITICAL, "detail": "Oil pressure below limit"} if f == "low_oil_pressure"
            else {"status": "ok", "detail": "Oil pressure normal for temperature"})},
        {"id": "fuel", "zone": "fuel", "name": "Fuel & intake",
         **({"status": CRITICAL, "detail": "Fuel level dropping without consumption"} if f == "fuel_leak"
            else {"status": WARNING, "detail": "Lean fuel trims at idle · vacuum leak?"} if f == "vacuum_leak"
            else {"status": "ok", "detail": "Fuel trims within ±5%"})},
        {"id": "tyres", "zone": "tyre_fl" if f == "puncture" else "tyre_rr" if f == "slow_leak" else "tyres",
         "name": "Tyres",
         **({"status": CRITICAL, "detail": "Front-left pressure critically low"} if f == "puncture"
            else {"status": WARNING, "detail": "Rear-right slowly losing pressure"} if f == "slow_leak"
            else {"status": "ok", "detail": "All four 32–34 psi"})},
        {"id": "brakes", "zone": "brakes", "name": "Brakes", "status": "ok", "detail": "Pads ~68%, fluid OK"},
    ]
    rank = {"ok": 0, INFO: 1, WARNING: 2, CRITICAL: 3}
    zones = {z: "ok" for z in ("engine", "battery", "cooling", "fuel", "tyre_fl", "tyre_fr", "tyre_rl", "tyre_rr")}
    for c in checks:
        for z in ([c["zone"]] if c["zone"] in zones else []):
            if rank[c["status"]] > rank[zones[z]]:
                zones[z] = c["status"]
    penalty = {CRITICAL: 35, WARNING: 12, INFO: 4, "ok": 0}
    score = max(0, 100 - sum(penalty[c["status"]] for c in checks))
    verdict = "Good to go" if score >= 85 else "Drive, but book a service" if score >= 60 else "Do not drive"
    return {"checks": checks, "zones": zones, "score": score, "verdict": verdict,
            "engine": {"fault": fault, "label": FAULT_LABELS[fault], "confidence": float(ens[k]), "votes": votes}}


# ------------------------------------------------------------------ signature lab
@app.post("/api/signature")
def signature(s: Scenario):
    car = make_car(s.unit, s.car_type)
    w = synth_window(s.engine_fault, rpm=s.rpm, car=car, severity=s.severity,
                     coolant_c=s.ambient + 3 if s.cold else 90, misfire_cyl=1, rng=np.random.default_rng(s.seed))
    x, fs = w["signal"], w["fs"]
    votes, ens = classify(w)
    n = int(0.2 * fs)
    step = max(1, n // 1600)
    spectra = []
    for ct in [s.car_type] + [c for c in s.compare if c in CAR_TYPES and c != s.car_type]:
        sig = x if ct == s.car_type else synth_window(
            s.engine_fault, rpm=s.rpm, car=make_car(s.unit, ct), severity=s.severity,
            coolant_c=s.ambient + 3 if s.cold else 90, misfire_cyl=1, rng=np.random.default_rng(s.seed))["signal"]
        fw, P = welch(sig, fs, nperseg=1024)
        keep = fw <= 10000
        spectra.append({"car_type": ct, "label": CAR_TYPES[ct]["label"], "f": rnd(fw[keep], 1),
                        "db": rnd(10 * np.log10(P[keep] + 1e-12), 2)})
    fS, tS, S = stft_image(x, fs)
    fe, E = envelope_spectrum(x, fs)
    sel = fe < 400
    f, X = spectrum(x, fs)
    cs = w["crank_speed"]
    k = int(ens.argmax())
    return {
        "verdict": {"fault": ENGINE_FAULTS[k], "label": FAULT_LABELS[ENGINE_FAULTS[k]], "confidence": float(ens[k]),
                    "truth": FAULT_LABELS[s.engine_fault]},
        "classes": [FAULT_LABELS[c] for c in ENGINE_FAULTS], "votes": votes, "ensemble": rnd(ens),
        "time": {"t_ms": rnd(np.arange(0, n, step) / fs * 1000, 2), "y": rnd(x[:n:step], 3)},
        "spectra": spectra,
        "marks": {k2: float(v) for k2, v in annotate_peaks(s.rpm, car).items()},
        "spectrogram": {"f": rnd(fS, 0), "t": rnd(tS, 3), "z": np.round(S, 2).tolist()},
        "envelope": {"f": rnd(fe[sel], 2), "y": rnd(E[sel] / (E[sel].max() + 1e-12), 4),
                     "bpfo": float(car.bpfo_ratio * car.pulley_ratio * s.rpm / 60),
                     "orders": [float(o * s.rpm / 60) for o in (0.5, 1, 1.5, 2)]},
        "orders": {"labels": [f"{o}×" for o in ORDERS], "amp": rnd(order_amplitudes(f, X, s.rpm), 5)},
        "crank": {"dev": rnd(cs - np.median(cs), 2)},
    }


# ------------------------------------------------------------------ live drive
@lru_cache(maxsize=32)
def _drive(fault, ambient, seed):
    df = simulate_drive(fault, duration_s=900, ambient_c=ambient, seed=seed % 1000)
    timeline = []
    for t in range(10, len(df), 5):
        alerts = evaluate(df.iloc[:t + 1])
        timeline.append({"t": t, "alerts": [{"severity": a.severity, "title": a.title, "message": a.message,
                                             "actions": a.actions, "maps_url": a.maps_url} for a in alerts]})
    cols = ["t", "speed_kph", "rpm", "coolant_c", "oil_pressure_bar", "battery_v", "fuel_level_pct",
            "tyre_fl_psi", "tyre_fr_psi", "tyre_rl_psi", "tyre_rr_psi", "ltft_pct", "engine_load"]
    return {"series": {c: rnd(df[c], 2) for c in cols}, "alerts": timeline}


@app.post("/api/drive")
def drive(s: Scenario):
    return _drive(s.obd_fault, float(s.ambient), int(s.seed))


# ------------------------------------------------------------------ insights
@lru_cache(maxsize=1)
def _life():
    L = simulate_life(*models()[2])
    fault_day = int(L[L.fault_active].day.min())
    out = {"fault_day": fault_day, "threshold": 3.0, "contexts": {}}
    for ctx in ("cold_start", "warm_idle"):
        d = L[L.context == ctx]
        out["contexts"][ctx] = {"day": d.day.tolist(), "ambient": rnd(d.ambient_c, 1),
                                "static": rnd(d.static_score, 3), "adaptive": rnd(d.adaptive_score, 3)}
    for col in ("static", "adaptive"):
        before = L[(~L.fault_active) & (L.day >= 14)]
        after = L[L.fault_active]
        det = after[after[f"{col}_alarm"]].day.min()
        out[f"{col}_false_alarm_days"] = int(before[before[f"{col}_alarm"]].day.nunique())
        out[f"{col}_detection_delay"] = int(det - fault_day) if np.isfinite(det) else None
    return out


@app.get("/api/baseline")
def baseline():
    return _life()


@app.get("/api/wear")
def wear():
    W = simulate_wear()
    last = W.iloc[-1]
    days_left = predict_days_to(W.day.values[-90:], W.crank_dip_comp_v.values[-90:], 3.2)
    return {"components": [{"id": "battery", "name": "Battery", "health": float(last.battery_health_pct)},
                           {"id": "oil", "name": "Oil life", "health": float(last.oil_life_pct)},
                           {"id": "brakes", "name": "Brake pads", "health": float(last.brake_pad_pct)},
                           {"id": "tyres", "name": "Tyre tread", "health": float(last.tyre_tread_pct)}],
            "battery": {"day": W.day.tolist(), "raw": rnd(W.crank_dip_v, 3), "comp": rnd(W.crank_dip_comp_v, 3),
                        "limit": 3.2, "months_left": round(days_left / 30, 1) if days_left else None}}


# ------------------------------------------------------------------ uploaded accelerometer recordings
@app.post("/api/vibration/analyze")
async def vibration_analyze(
    file: UploadFile = File(...),
    sampling_rate_hz: float | None = Form(None),
    axes: str = Form(""),
    units: str = Form("unknown"),
    rpm: float | None = Form(None),
    sensor_location: str = Form(""),
    notes: str = Form(""),
    time_unit: str = Form("s"),
    detrend: str = Form("mean"),
    highpass_hz: float | None = Form(None),
    lowpass_hz: float | None = Form(None),
    envelope: bool = Form(False),
):
    """CSV upload -> validate -> preprocess -> signatures (time, FFT, STFT, optional envelope/orders)
    -> classification if a compatible trained model exists (else status 'unavailable')."""
    try:
        if units not in vibration.UNITS:
            raise vibration.VibrationError("bad_units", f"units must be one of {list(vibration.UNITS)}.")
        raw = await file.read(vibration.MAX_BYTES + 1)
        axis_list = [a.strip() for a in axes.split(",") if a.strip()]
        channels, fs, meta, warns = vibration.parse_csv(raw, axis_list, sampling_rate_hz, time_unit)
        res = vibration.analyze(channels, fs, detrend=detrend, highpass_hz=highpass_hz, lowpass_hz=lowpass_hz,
                                rpm=rpm, envelope=envelope)
        classification = vibration.classify(res["features"], fs)
    except vibration.VibrationError as e:
        return JSONResponse({"status": "error", "code": e.code, "message": e.message}, status_code=e.status)
    if units == "unknown":
        warns.append("Acceleration units were not specified; amplitudes are reported in the file's own units.")
    return {"status": "success", "source": "uploaded_recording",
            "recording": {"filename": file.filename, "size_bytes": len(raw), "units": units,
                          "sensor_location": sensor_location or None, "notes": notes or None, "rpm": rpm, **meta},
            "sampling_rate_hz": fs, "channels": res["channels"], "analysis_channels": res["analysis_channels"],
            "features": res["features"], "waveform": res["waveform"], "spectrum": res["spectrum"],
            "spectrogram": res["spectrogram"], "envelope": res.get("envelope"), "orders": res.get("orders"),
            "settings": res["settings"], "classification": classification, "warnings": warns + res["warnings"]}


classify_native = make_classifier(models)


@app.websocket("/api/vibration/live")
async def vibration_live(ws: WebSocket):
    """Simulated accelerometer stream with start / pause / resume / stop / reset (see autopulse/vibstream.py)."""
    await ws.accept()
    try:
        await run_session(ws, classify_native)
    except WebSocketDisconnect:
        pass


# ------------------------------------------------------------------ evidence
@app.get("/api/results")
def results():
    load = lambda n: json.loads((MODELS / n).read_text()) if (MODELS / n).exists() else None  # noqa: E731
    return {"simulator": load("metrics.json"), "real": load("real_metrics.json"),
            "matlab": load("matlab_crosscheck.json")}


@app.get("/api/health")
def health():
    return {"ok": True}


@app.on_event("startup")
def warm():
    # load models and the 8-month baseline study in the background so the first click is instant
    threading.Thread(target=lambda: (models(), _life()), daemon=True).start()


# ------------------------------------------------------------------ built frontend (single-port mode)
if DIST.exists():
    app.mount("/assets", StaticFiles(directory=DIST / "assets"), name="assets")
    if (DIST / "models").exists():
        app.mount("/models", StaticFiles(directory=DIST / "models"), name="models3d")

    @app.get("/{path:path}")
    def spa(path: str):
        f = DIST / path
        return FileResponse(f if path and f.is_file() else DIST / "index.html")
