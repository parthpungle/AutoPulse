"""AutoPulse v2 dashboard API. Pairs with a vehicle node, diagnoses its live sensor
stream (backend/live.py) and serves the studies behind the Insights and Evidence screens.

    .venv\\Scripts\\python -m uvicorn backend.app:app --port 8000
"""
import asyncio
import io
import json
import os
import threading
from functools import lru_cache
from pathlib import Path

import joblib
import numpy as np
import soundfile as sf
from fastapi import FastAPI, File, Form, HTTPException, Request, UploadFile, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, JSONResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel
from starlette.concurrency import run_in_threadpool

from autopulse import live_audio as la

from autopulse import real_audio
from autopulse.baseline import predict_days_to, simulate_life, simulate_wear
from autopulse.generator import CAR_TYPES, ENGINE_FAULTS, FAULT_LABELS
from autopulse.models import HAS_TORCH, make_cnn
from autopulse.telemetry import OBD_FAULTS
from autopulse.wire import STREAM_PORT
from autopulse import vibration
from autopulse.realdata import estimate_rpm
from autopulse.vibclassify import make_classifier
from autopulse.vibstream import run_session
from backend.live import LiveHub, build_sig

ROOT = Path(__file__).resolve().parents[1]
MODELS = ROOT / "models"
DIST = ROOT / "frontend" / "dist"

app = FastAPI(title="AutoPulse dashboard API", version="2.0")
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


def rnd(a, n=4):
    """Rounded list for JSON; NaN/inf (e.g. days before a baseline exists) become null."""
    arr = np.round(np.asarray(a, dtype=float), n)
    return [None if not np.isfinite(v) else float(v) for v in arr.ravel()] if arr.ndim else \
        (None if not np.isfinite(arr) else float(arr))


# ------------------------------------------------------------------ meta
@app.get("/api/meta")
def meta():
    return {"car_types": [{"id": k, "label": v["label"]} for k, v in CAR_TYPES.items()],
            "engine_faults": [{"id": f, "label": FAULT_LABELS[f]} for f in ENGINE_FAULTS],
            "obd_faults": [{"id": k, "label": v} for k, v in OBD_FAULTS.items()],
            "models": ["SVM", "Softmax", "ANN"] + (["CNN"] if models()[1] is not None else [])}


# ------------------------------------------------------------------ live link to the vehicle
hub = LiveHub(models)


class Pair(BaseModel):
    host: str
    port: int = STREAM_PORT
    code: str


@app.get("/api/discover")
def discover():
    return {"vehicles": hub.discover(), "link": hub.link}


@app.get("/api/probe")
def probe_vehicle(host: str, port: int = STREAM_PORT):
    """Quick check before pairing: is there an AutoPulse vehicle at host:port, and if not, why."""
    from backend.live import probe
    host = host.strip()
    return probe(host, port, heard=hub.heard(host))


@app.post("/api/pair")
async def pair(p: Pair):
    hub.manual = True
    return await hub.pair(p.host.strip(), p.port, p.code.strip())


@app.post("/api/unpair")
async def unpair():
    hub.manual = True
    await hub.unpair()
    return hub.link


@app.post("/api/serviced")
def serviced():
    hub.serviced()
    return {"ok": True}


@app.websocket("/api/ws/live")
async def live(ws: WebSocket):
    await ws.accept()
    hub.ui.add(ws)
    await ws.send_text(json.dumps(hub.hello()))
    try:
        while True:
            await ws.receive_text()
    except WebSocketDisconnect:
        pass
    finally:
        hub.ui.discard(ws)


# ------------------------------------------------------------------ vibration analysis
classify_native = make_classifier(models)


@app.websocket("/api/vibration/live")
async def vibration_live(ws: WebSocket):
    """Rolling analysis of a SIMULATED accelerometer (source=simulator) or of the paired vehicle's windows (source=vehicle)."""
    await ws.accept()
    q = asyncio.Queue(maxsize=20)
    hub.vib_queues.add(q)
    try:
        await run_session(ws, classify_native, q)
    except WebSocketDisconnect:
        pass
    finally:
        hub.vib_queues.discard(q)


@app.post("/api/vibration/analyze")
async def vibration_analyze(
    file: UploadFile = File(...), sampling_rate_hz: float | None = Form(None), axes: str = Form(""),
    units: str = Form("unknown"), rpm: float | None = Form(None), sensor_location: str = Form(""),
    notes: str = Form(""), time_unit: str = Form("s"), detrend: str = Form("mean"),
    highpass_hz: float | None = Form(None), lowpass_hz: float | None = Form(None), envelope: bool = Form(False),
):
    """Recorded accelerometer CSV -> validated signatures (same code as the single-laptop app)."""
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


# ------------------------------------------------------------------ classify a real clip (Signatures -> Real clip)
CLIP_MAX_BYTES, CLIP_MAX_S = 10_000_000, 30.0


@app.get("/api/real-audio")
def real_audio_meta():
    """What the real-audio models were trained on (meta.json), or null if train_real.py has not been run."""
    return real_audio.meta()


def _classify(x, fs):
    res = real_audio.classify_clip(x, fs)
    if res["n_windows"]:
        wins, _ = real_audio.windows_from_signal(x, fs)
        k = res["classes"].index(res["verdict"]) if res["verdict"] in res["classes"] else \
            int(np.argmax(res["ensemble"]))
        best = int(np.argmax(np.asarray(res["per_window"])[:, k]))  # the window most sure of the overall verdict
        res["sig"] = build_sig(wins[best], real_audio.FS, estimate_rpm(wins[best], real_audio.FS))
        res["sig_window"] = best
    m = real_audio.meta()
    res["model_info"] = {k: m[k] for k in ("source", "n_recordings", "n_windows", "trained_at")}
    res["duration_s"] = round(len(x) / fs, 2)
    return res


@app.post("/api/classify-audio")
async def classify_audio(file: UploadFile = File(...)):
    """One recording -> the real-audio models' verdict per 1 s window and overall, plus the signature views of the
    window they are most sure about. WAV/FLAC/OGG decode here; the page converts MP3/WebM/M4A to WAV first."""
    data = await file.read(CLIP_MAX_BYTES + 1)
    if len(data) > CLIP_MAX_BYTES:
        raise HTTPException(413, "The file is larger than 10 MB. Upload 30 seconds or less.")
    try:
        info = sf.info(io.BytesIO(data))
        if info.duration > CLIP_MAX_S:
            raise HTTPException(413, f"The clip is {info.duration:.0f} s long; the limit is {CLIP_MAX_S:.0f} s.")
        x, fs = sf.read(io.BytesIO(data), dtype="float32")
    except HTTPException:
        raise
    except Exception as e:                                          # noqa: BLE001 - libsndfile cannot read it
        raise HTTPException(415, "This audio format cannot be decoded on the server (WAV, FLAC or OGG work). "
                                 "Use the page's Upload button, which converts MP3/WebM/M4A to WAV first.") from e
    if real_audio.load_real_models() is None:
        raise HTTPException(503, "The real-audio models are not trained on this laptop: run train_real.py "
                                 "(needs scripts/download_data.py engine_audio).")
    return await asyncio.to_thread(_classify, x, fs)


# ------------------------------------------------------------------ evidence
@app.get("/api/results")
def results():
    load = lambda n: json.loads((MODELS / n).read_text()) if (MODELS / n).exists() else None  # noqa: E731
    return {"simulator": load("metrics.json"), "real": load("real_metrics.json"),
            "matlab": load("matlab_crosscheck.json"),
            "fusion": load("fusion_metrics.json"), "robustness": load("robustness.json"),   # null until written
            "robustness_randomized": load("robustness_randomized.json")}


@app.get("/api/ask/docs")
def ask_docs(q: str = ""):
    """Ask AutoPulse fallback: one sentence quoted from the project's own docs, or null."""
    from backend.docsearch import search
    return {"answer": search(q) if q.strip() else None}

# ------------------------------------------------------------------ live audio (microphone)
# The browser captures and buffers; it POSTs one window of raw float32 samples at its own rate.
# Audio is analysed in memory and never stored or logged.
LIVE_MAX_BYTES = int(la.MAX_INPUT_S * la.MAX_FS * 4)
LIVE_TIMEOUT_S = 5.0
_live_slots = threading.BoundedSemaphore(2)  # at most 2 windows in analysis; extra requests get 429


@lru_cache(maxsize=1)
def live_model():
    try:
        return la.LiveAudioModel.load(), None
    except la.ModelUnavailable as e:
        return None, str(e)


@app.get("/api/live-audio/status")
def live_status():
    m, reason = live_model()
    return {"source": "live_microphone", "model_available": m is not None, "reason": reason,
            "model": m.info() if m else None,
            "limits": {"window_s": la.WINDOW_S, "model_rate": la.MODEL_FS, "min_rate": la.MIN_FS,
                       "max_rate": la.MAX_FS, "max_seconds": la.MAX_INPUT_S, "max_bytes": LIVE_MAX_BYTES,
                       "timeout_s": LIVE_TIMEOUT_S, "quiet_dbfs": la.QUIET_DBFS}}


@app.post("/api/live-audio/analyze")
async def live_analyze(request: Request, sample_rate: int):
    """Body: mono float32 little-endian samples (application/octet-stream); ?sample_rate=<Hz>."""
    if not request.headers.get("content-type", "").startswith("application/octet-stream"):
        raise HTTPException(415, "send raw float32 samples as application/octet-stream")
    declared = request.headers.get("content-length")
    if declared and declared.isdigit() and int(declared) > LIVE_MAX_BYTES:
        raise HTTPException(413, f"audio payload over {LIVE_MAX_BYTES} bytes")
    body = bytearray()
    async for chunk in request.stream():
        body += chunk
        if len(body) > LIVE_MAX_BYTES:
            raise HTTPException(413, f"audio payload over {LIVE_MAX_BYTES} bytes")
    if not body or len(body) % 4:
        raise HTTPException(422, "payload must be a non-empty whole number of float32 samples")
    samples = np.frombuffer(bytes(body), dtype="<f4")
    if not _live_slots.acquire(blocking=False):
        raise HTTPException(429, "analysis busy; skip this window")

    def work():
        try:
            return la.analyze_prepared(la.prepare_window(samples, sample_rate), live_model()[0])
        finally:
            _live_slots.release()

    try:
        out = await asyncio.wait_for(run_in_threadpool(work), LIVE_TIMEOUT_S)
    except asyncio.TimeoutError:
        raise HTTPException(504, f"analysis took longer than {LIVE_TIMEOUT_S:.0f} s") from None
    except la.AudioInputError as e:
        raise HTTPException(422, str(e)) from None
    except la.InvalidModelOutput as e:
        raise HTTPException(500, f"model output rejected: {e}") from None
    out["source"] = "live_microphone"
    return out


@app.get("/api/health")
def health():
    return {"ok": True}


@app.on_event("startup")
async def warm():
    # load models and the 8-month baseline study in the background so the first click is instant
    threading.Thread(target=lambda: (models(), real_audio.load_real_models(), _life(), live_model()), daemon=True).start()
    hub.loop = asyncio.get_running_loop()
    hub.start_discovery()
    auto = os.environ.get("AUTOPULSE_AUTOPAIR")          # "host:port:code", set by run.bat in the Both role
    if auto:
        host, port, code = auto.rsplit(":", 2)
        asyncio.create_task(_autopair(host, int(port), code))


async def _autopair(host, port, code):
    """Both role: the launcher starts this API before the vehicle node, so keep trying for up to two
    minutes until the vehicle on this laptop answers. Stops as soon as someone pairs or unpairs by hand."""
    for _ in range(60):
        if hub.manual or hub.link["state"] in ("live", "lost"):
            return
        link = await hub.pair(host, port, code)
        if link.get("state") == "live" or hub.manual:
            return
        hub.set_link(state="connecting", error=None)       # still starting up: say so, not "couldn't connect"
        await asyncio.sleep(2)


# ------------------------------------------------------------------ built frontend (single-port mode)
if DIST.exists():
    app.mount("/assets", StaticFiles(directory=DIST / "assets"), name="assets")
    if (DIST / "models").exists():
        app.mount("/models", StaticFiles(directory=DIST / "models"), name="models3d")

    @app.get("/{path:path}")
    def spa(path: str):
        f = DIST / path
        return FileResponse(f if path and f.is_file() else DIST / "index.html")
