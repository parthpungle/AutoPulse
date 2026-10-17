"""Split edition: Vibration analysis fed by the paired vehicle's 1 s windows, plus regression checks.

Run from split/:   ..\\.venv\\Scripts\\python -m pytest tests -q
"""
import sys
import time
from pathlib import Path

import numpy as np
import pytest
from fastapi.testclient import TestClient

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import backend.app as split_app  # noqa: E402
from autopulse.generator import make_car, synth_window  # noqa: E402
from autopulse.wire import decode_vibration, encode_frame  # noqa: E402

client = TestClient(split_app.app)


def msgs(ws, kind, limit=60):
    for _ in range(limit):
        m = ws.receive_json()
        if m["type"] == kind:
            return m
    raise AssertionError(f"no {kind}")


def vehicle_window(fault="healthy", rpm=1800.0, seed=0):
    """A window exactly as the dashboard hub gets it: encoded by the vehicle, decoded by autopulse.wire."""
    w = synth_window(fault, rpm=rpm, car=make_car(8), rng=np.random.default_rng(seed))
    frame = encode_frame(1, time.time(), {}, {"t": 0}, w)
    return decode_vibration(frame["vib"])


def test_vehicle_source_streams_windows_without_gaps():
    with client.websocket_connect("/api/vibration/live") as ws:
        assert ws.receive_json()["state"] == "idle"
        (q,) = split_app.hub.vib_queues
        ws.send_json({"cmd": "start", "source": "vehicle", "settings": {"window_s": 2.0}})
        st = msgs(ws, "state")
        assert st["state"] == "running" and st["simulated"] is False and st["truth"] is None   # vehicle sends no ground truth
        for i in range(3):                       # three consecutive 1 s windows
            q.put_nowait(vehicle_window("misfire", seed=i))
            b = msgs(ws, "batch")
            assert b["fs"] == 24000 and b["n"] == 24000 and list(b["channels"]) == ["vibration"]
            assert b["t0"] == pytest.approx(i) and b["t1"] == pytest.approx(i + 1)    # aligned, nothing discarded
        an = msgs(ws, "analysis")
        assert an["truth"] is None and an["classification"]["status"] == "available"
        assert an["window"]["duration_s"] <= 2.0 + 1e-6 and an["window"]["end_s"] == pytest.approx(an["elapsed_s"])
        ws.send_json({"cmd": "stop"})
        assert msgs(ws, "state")["state"] == "stopped"
    assert not split_app.hub.vib_queues          # session removed its queue on disconnect


def test_simulator_source_and_csv_work_in_split():
    with client.websocket_connect("/api/vibration/live") as ws:
        ws.receive_json()
        ws.send_json({"cmd": "start", "settings": {"fs": 2000, "speed": 4, "fault": "knock", "seed": 1}})
        assert msgs(ws, "batch")["fs"] == 2000
        assert msgs(ws, "analysis")["truth"]["fault"] == "knock"
    csv = b"timestamp,accel_x\n" + b"".join(f"{i / 1000:.4f},{np.sin(i / 10):.5f}\n".encode() for i in range(1000))
    r = client.post("/api/vibration/analyze", files={"file": ("a.csv", csv, "text/csv")})
    assert r.status_code == 200 and r.json()["status"] == "success"


def test_split_endpoints_still_present():
    paths = {r.path for r in split_app.app.routes}
    assert {"/api/ws/live", "/api/pair", "/api/discover", "/api/health", "/api/meta", "/api/baseline", "/api/wear"} <= paths
    assert client.get("/api/health").json() == {"ok": True}
