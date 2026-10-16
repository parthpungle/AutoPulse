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
from fastapi import FastAPI, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel

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


@app.post("/api/pair")
async def pair(p: Pair):
    return await hub.pair(p.host.strip(), p.port, p.code.strip())


@app.post("/api/unpair")
async def unpair():
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


@app.get("/api/health")
def health():
    return {"ok": True}


@app.on_event("startup")
async def warm():
    # load models and the 8-month baseline study in the background so the first click is instant
    threading.Thread(target=lambda: (models(), _life()), daemon=True).start()
    hub.loop = asyncio.get_running_loop()
    hub.start_discovery()
    auto = os.environ.get("AUTOPULSE_AUTOPAIR")          # "host:port:code", set by run.bat in the Both role
    if auto:
        host, port, code = auto.rsplit(":", 2)
        asyncio.create_task(hub.pair(host, int(port), code))


# ------------------------------------------------------------------ built frontend (single-port mode)
if DIST.exists():
    app.mount("/assets", StaticFiles(directory=DIST / "assets"), name="assets")
    if (DIST / "models").exists():
        app.mount("/models", StaticFiles(directory=DIST / "models"), name="models3d")

    @app.get("/{path:path}")
    def spa(path: str):
        f = DIST / path
        return FileResponse(f if path and f.is_file() else DIST / "index.html")
