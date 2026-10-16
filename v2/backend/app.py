"""AutoPulse v2 dashboard API. Pairs with a vehicle node, diagnoses its live sensor
stream (backend/live.py) and serves the studies behind the Insights and Evidence screens.

    .venv\\Scripts\\python -m uvicorn backend.app:app --port 8000
"""
import asyncio
import json
import os
import threading
from functools import lru_cache
from pathlib import Path

import joblib
import numpy as np
from fastapi import FastAPI, HTTPException, Request, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel
from starlette.concurrency import run_in_threadpool

from autopulse import live_audio as la

from autopulse.baseline import predict_days_to, simulate_life, simulate_wear
from autopulse.generator import CAR_TYPES, ENGINE_FAULTS, FAULT_LABELS
from autopulse.models import HAS_TORCH, make_cnn
from autopulse.telemetry import OBD_FAULTS
from autopulse.wire import STREAM_PORT
from backend.live import LiveHub

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


# ------------------------------------------------------------------ evidence
@app.get("/api/results")
def results():
    load = lambda n: json.loads((MODELS / n).read_text()) if (MODELS / n).exists() else None  # noqa: E731
    return {"simulator": load("metrics.json"), "real": load("real_metrics.json"),
            "matlab": load("matlab_crosscheck.json")}


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
    threading.Thread(target=lambda: (models(), _life(), live_model()), daemon=True).start()
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
