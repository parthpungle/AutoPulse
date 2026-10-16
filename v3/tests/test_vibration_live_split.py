"""Split edition: Insights -> Vibration analysis -> Live simulation, end to end on the split dashboard API.

The simulator, stream session and DSP are the shared modules (autopulse/vibsim.py, vibstream.py, vibration.py);
these tests check that the split API serves them correctly and cleans up.

Run from split/:   ..\\.venv\\Scripts\\python -m pytest tests -q
"""
import asyncio
import sys
from pathlib import Path

import numpy as np
import pytest
from fastapi.testclient import TestClient

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import backend.app as split_app  # noqa: E402
from autopulse.vibclassify import make_classifier  # noqa: E402
from autopulse.vibsim import CHANNELS  # noqa: E402
from autopulse.vibstream import run_session  # noqa: E402

client = TestClient(split_app.app)
FAST = {"fs": 2000, "speed": 4.0, "window_s": 2.0, "rpm": 1200, "seed": 3}


def recv(ws, kind, state=None, limit=80):
    for _ in range(limit):
        m = ws.receive_json()
        if m["type"] == kind and (state is None or m.get("state") == state):
            return m
    raise AssertionError(f"no {kind} {state or ''}")


def analysis_after(ws, t, limit=80):
    """First analysis whose whole window was generated after stream time t (i.e. with the new settings)."""
    for _ in range(limit):
        m = ws.receive_json()
        if m["type"] == "analysis" and m["window"]["start_s"] >= t:
            return m
    raise AssertionError(f"no analysis window after t={t}")


def peak_ratio(an, f0, tol=1.5):
    f, a = np.array(an["spectrum"]["f_hz"]), np.array(an["spectrum"]["amplitude"])
    return a[np.abs(f - f0) < tol].max() / np.median(a)


def test_live_simulation_streams_valid_samples_and_analysis():
    with client.websocket_connect("/api/vibration/live") as ws:
        assert recv(ws, "state")["state"] == "idle"
        cfg = {**FAST, "fault": "misfire", "severity": 0.9, "condition": "cold"}
        ws.send_json({"cmd": "start", "source": "simulator", "settings": cfg})
        st = recv(ws, "state", "running")
        assert st["source"] == "simulator" and st["simulated"] is True and st["truth"]["fault"] == "misfire"
        assert {k: st["settings"][k] for k in cfg} == cfg                       # every control reached the simulator

        prev_t1 = 0.0
        for _ in range(3):                                                      # consecutive, gap-free batches
            b = recv(ws, "batch")
            assert set(b["channels"]) == set(CHANNELS) and b["fs"] == 2000
            assert b["t0"] == pytest.approx(prev_t1) and b["t1"] > b["t0"]
            for c in CHANNELS:
                t, y = np.array(b["channels"][c]["t"]), np.array(b["channels"][c]["y"])
                assert len(t) == len(y) > 0 and np.all(np.isfinite(t)) and np.all(np.isfinite(y))
                assert np.all(np.diff(t) > 0) and t[0] >= b["t0"] and t[-1] < b["t1"]
            prev_t1 = b["t1"]

        an = recv(ws, "analysis")
        w = an["window"]
        assert w["samples"] == pytest.approx(w["duration_s"] * 2000, abs=1) and w["duration_s"] <= 2.0 + 1e-6
        assert len(an["spectrum"]["f_hz"]) == len(an["spectrum"]["amplitude"]) > 10
        z = np.array(an["spectrogram"]["power_db"])
        assert z.shape == (len(an["spectrogram"]["f_hz"]), len(an["spectrogram"]["t_s"]))
        assert set(an["features"]) >= set(CHANNELS) and an["orders"]["rpm"] == 1200
        c = an["classification"]                                                # real model output: split/models exists
        assert c["status"] == "available" and "SVM" in c["model"]["name"] and abs(sum(c["probabilities"].values()) - 1) < 1e-3

        ws.send_json({"cmd": "pause"})
        recv(ws, "state", "paused")
        ws.send_json({"cmd": "resume"})
        recv(ws, "state", "running")
        ws.send_json({"cmd": "stop"})
        assert recv(ws, "state", "stopped")["elapsed_s"] > 0
        ws.send_json({"cmd": "reset"})
        s = recv(ws, "state", "idle")
        assert s["samples"] == 0 and s["elapsed_s"] == 0


def test_rpm_and_fault_controls_change_the_generated_signal():
    with client.websocket_connect("/api/vibration/live") as ws:
        recv(ws, "state")
        ws.send_json({"cmd": "start", "source": "simulator", "settings": FAST})
        recv(ws, "state", "running")
        an = recv(ws, "analysis")
        assert peak_ratio(an, 1200 / 30) > 5                                    # I4 second order at 2 x rpm/60

        ws.send_json({"cmd": "update", "settings": {"rpm": 2400}})
        t = recv(ws, "state", "running")["elapsed_s"]
        an = analysis_after(ws, t)
        assert an["orders"]["rpm"] == 2400 and peak_ratio(an, 2400 / 30) > 5    # the peak moved with the RPM
    with client.websocket_connect("/api/vibration/live") as ws:                # fault: knock rings at 5.5-8 kHz
        recv(ws, "state")
        ws.send_json({"cmd": "start", "settings": {"fs": 24000, "speed": 4.0, "window_s": 1.0, "severity": 1.0, "seed": 0}})
        before = recv(ws, "analysis")["features"]["accel_x"]["spectral_centroid_hz"]
        ws.send_json({"cmd": "update", "settings": {"fault": "knock"}})
        st = recv(ws, "state", "running")
        assert st["truth"]["fault"] == "knock"
        after = analysis_after(ws, st["elapsed_s"])["features"]["accel_x"]["spectral_centroid_hz"]
        assert after > 1.15 * before


def test_switching_modes_leaves_one_session_and_no_queue_behind():
    """What the split tab does on a mode change: close one socket, open the next."""
    with client.websocket_connect("/api/vibration/live") as ws:            # Live simulation
        recv(ws, "state")
        ws.send_json({"cmd": "start", "source": "simulator", "settings": FAST})
        recv(ws, "batch")
    assert not split_app.hub.vib_queues
    with client.websocket_connect("/api/vibration/live") as ws:            # then Paired vehicle
        recv(ws, "state")
        assert len(split_app.hub.vib_queues) == 1                          # exactly one session listening
        ws.send_json({"cmd": "start", "source": "vehicle", "settings": {}})
        st = recv(ws, "state", "running")
        assert st["source"] == "vehicle" and st["truth"] is None
    assert not split_app.hub.vib_queues
    assert client.get("/api/health").json() == {"ok": True}


class FakeWS:
    """Minimal transport for run_session: scripted commands in, everything sent recorded."""
    def __init__(self, commands, disconnect_after_batches=2):
        self.inbox, self.sent, self.n = list(commands), [], disconnect_after_batches
        self.gone = asyncio.Event()

    async def send_json(self, m):
        if self.gone.is_set():
            raise AssertionError("message sent after the client disconnected")
        self.sent.append(m)

    async def receive_json(self):
        if self.inbox:
            return self.inbox.pop(0)
        while sum(m["type"] == "batch" for m in self.sent) < self.n:
            await asyncio.sleep(0.02)
        self.gone.set()
        raise ConnectionError("client went away")


def test_disconnect_cancels_the_simulation_task():
    async def main():
        ws = FakeWS([{"cmd": "start", "source": "simulator", "settings": FAST}])
        with pytest.raises(ConnectionError):
            await run_session(ws, None)
        sent = len(ws.sent)
        await asyncio.sleep(0.6)                                           # > two ticks: a leaked task would keep sending
        others = [t for t in asyncio.all_tasks() if t is not asyncio.current_task()]
        return sent, len(ws.sent), others
    sent, later, others = asyncio.run(main())
    assert later == sent and others == []


def test_missing_model_artifacts_keep_signal_analysis_running():
    def no_models():
        raise FileNotFoundError(2, "No such file", "models/svm.joblib")
    classify = make_classifier(no_models)

    async def main():
        ws = FakeWS([{"cmd": "start", "settings": FAST}], disconnect_after_batches=6)
        with pytest.raises(ConnectionError):
            await run_session(ws, classify)
        return [m for m in ws.sent if m["type"] == "analysis"]
    analyses = asyncio.run(main())
    assert analyses, "DSP analysis still produced"
    an = analyses[-1]
    assert len(an["spectrum"]["f_hz"]) > 10 and an["features"]["accel_x"]["rms"] > 0
    c = an["classification"]
    assert c["status"] == "unavailable" and c["label"] is None and c["probabilities"] is None
    assert "svm.joblib" in c["reason"]
