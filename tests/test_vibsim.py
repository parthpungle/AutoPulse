"""Simulated real-time accelerometer: generator, rolling buffer, session state machine, WebSocket stream.

    .venv\\Scripts\\python -m pytest tests -q
"""
import sys
import time
from pathlib import Path

import numpy as np
import pytest
from fastapi.testclient import TestClient

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from autopulse import vibration, vibsim  # noqa: E402
from autopulse.signatures import spectrum  # noqa: E402
from backend.app import app  # noqa: E402

client = TestClient(app)


def sim(**k):
    return vibsim.VibrationSimulator(vibsim.validate(k))


# ---------------------------------------------------------------- settings
@pytest.mark.parametrize("bad", [{"fault": "nope"}, {"fs": 10}, {"fs": 48000}, {"rpm": 5}, {"severity": 2}, {"speed": 0},
                                 {"window_s": 99}, {"condition": "hot"}, {"car_type": "tank"}, {"seed": 1.5}, {"bogus": 1},
                                 {"fs": float("nan")}, {"rpm": True}])
def test_invalid_settings(bad):
    with pytest.raises(vibsim.SettingsError):
        vibsim.validate(bad)


# ---------------------------------------------------------------- generator
def test_consecutive_batches_are_gap_free_and_sized():
    s = sim(fs=2000, seed=3)
    expect = 0
    for n in (500, 1234, 2000, 777, 3000):             # deliberately straddles the 1 s source blocks
        i0, ch = s.read(n)
        assert i0 == expect and set(ch) == set(vibsim.CHANNELS) and all(len(v) == n for v in ch.values())
        assert all(np.isfinite(v).all() for v in ch.values())
        expect += n
    assert s.n_emitted == expect


def test_seeded_determinism_and_difference():
    a, b, c = sim(seed=1).read(4000)[1], sim(seed=1).read(4000)[1], sim(seed=2).read(4000)[1]
    assert np.array_equal(a["accel_x"], b["accel_x"]) and not np.array_equal(a["accel_x"], c["accel_x"])


def test_no_discontinuity_at_block_joins():
    fs = 4000
    x = sim(fs=fs, seed=0).read(3 * fs)[1]["accel_x"]
    d = np.abs(np.diff(x))
    for j in (fs, 2 * fs):                              # block boundaries
        assert d[j - 5:j + 5].max() < 8 * d.std() + 6 * d.mean()


def test_axes_properties():
    ch = sim(fs=4000, seed=0).read(8000)[1]
    assert ch["accel_z"].mean() == pytest.approx(1.0, abs=0.1)          # gravity offset on z only
    assert abs(ch["accel_x"].mean()) < 0.1
    assert ch["accel_x"].std() > ch["accel_y"].std()                     # gains 1.0 vs ~0.55


def test_dominant_frequency_follows_rpm():
    """An I4 always has second-order unbalance at 2 x rpm/60 Hz; the analysis should find a peak there."""
    for rpm in (1200, 2400):
        fs = 4000
        x = sim(fs=fs, rpm=rpm, seed=0).read(4 * fs)[1]["accel_x"]
        f, X = spectrum(x - x.mean(), fs)
        near = X[np.abs(f - rpm / 30) < 1.0].max()
        assert near > 5 * np.median(X), (rpm, near, np.median(X))


def test_fault_changes_signature():
    r = {}
    for f in ("healthy", "knock"):
        x = sim(fs=24000, fault=f, severity=1.0, seed=0).read(24000)[1]["accel_x"]
        r[f] = vibration.analyze({"a": x}, 24000.0)["features"]["a"]["spectral_centroid_hz"]
    assert r["knock"] > 1.15 * r["healthy"]          # knock adds 5.5-8 kHz ringing -> higher centroid


# ---------------------------------------------------------------- rolling buffer
def test_rolling_buffer_is_bounded_and_contiguous():
    s = sim(fs=2000)
    an = vibsim.RollingAnalyzer(2000, 2.0, 1500)
    for _ in range(40):
        an.push(*s.read(1000))
    assert an.buffered == 4000 and an.total == 40000          # bounded to 2 s; the running count loses nothing
    res = an.analyze("accel_x")
    assert res["window"]["start_s"] == pytest.approx(18.0) and res["window"]["end_s"] == pytest.approx(20.0)
    assert res["orders"]["rpm"] == 1500
    with pytest.raises(ValueError):
        an.push(5, {c: np.zeros(10) for c in vibsim.CHANNELS})     # a gap / overlap is refused, never accepted silently


def test_detail_channel_limits_payload():
    s = sim(fs=2000)
    an = vibsim.RollingAnalyzer(2000, 2.0)
    an.push(*s.read(4000))
    r = an.analyze("accel_y")
    assert list(r["spectrum"]) == ["accel_y"] and set(r["features"]) == {"accel_x", "accel_y", "accel_z", "magnitude"}


# ---------------------------------------------------------------- websocket session
def recv_until(ws, kind, limit=60):
    for _ in range(limit):
        m = ws.receive_json()
        if m["type"] == kind:
            return m
    raise AssertionError(f"no {kind} message")


def recv_state(ws, state):
    for _ in range(60):
        m = ws.receive_json()
        if m["type"] == "state" and m["state"] == state:
            return m
    raise AssertionError(f"never reached state {state}")


FAST = {"fs": 2000, "speed": 4.0, "window_s": 3.0, "rpm": 1800}


def test_stream_state_machine_and_payloads():
    with client.websocket_connect("/api/vibration/live") as ws:
        assert ws.receive_json()["state"] == "idle"
        ws.send_json({"cmd": "pause"})
        assert recv_until(ws, "error")["code"] == "bad_state"
        ws.send_json({"cmd": "start", "settings": {**FAST, "fault": "misfire", "seed": 5}})
        st = recv_state(ws, "running")
        assert st["simulated"] is True and st["truth"]["fault"] == "misfire" and st["assumptions"]
        ws.send_json({"cmd": "start", "settings": FAST})
        assert recv_until(ws, "error")["code"] == "bad_state"

        b1 = recv_until(ws, "batch")
        assert b1["fs"] == 2000 and b1["n"] == 2000 and set(b1["channels"]) == set(vibsim.CHANNELS)
        t = b1["channels"]["accel_x"]["t"]
        assert len(t) <= 100 and b1["t1"] - b1["t0"] == pytest.approx(1.0)
        assert all(b1["t0"] <= v < b1["t1"] for v in t) and t == sorted(t)
        an = recv_until(ws, "analysis")
        assert an["truth"]["fault"] == "misfire"                       # ground truth, reported separately
        assert an["classification"]["status"] in ("available", "error")
        assert an["detail_channel"] == "accel_x" and len(an["spectrum"]["f_hz"]) <= 1000
        z = np.array(an["spectrogram"]["power_db"])
        assert z.shape == (len(an["spectrogram"]["f_hz"]), len(an["spectrogram"]["t_s"])) and z.shape[0] <= 64
        assert an["window"]["duration_s"] <= 3.0 + 1e-6 and an["orders"]["rpm"] == 1800
        assert {"rms", "peak_to_peak", "crest_factor", "skewness", "kurtosis", "std", "mean"} <= set(an["features"]["accel_x"])

        ws.send_json({"cmd": "channel", "channel": "accel_z"})
        for _ in range(60):                                            # a later analysis switches to z
            m = ws.receive_json()
            if m["type"] == "analysis" and m["detail_channel"] == "accel_z":
                break
        else:
            raise AssertionError("channel switch never took effect")

        ws.send_json({"cmd": "pause"})
        mark = recv_state(ws, "paused")["elapsed_s"]
        time.sleep(1.0)                                                # paused: no samples may be produced
        ws.send_json({"cmd": "channel", "channel": "accel_y"})
        st = recv_state(ws, "paused")
        assert st["elapsed_s"] == pytest.approx(mark, abs=1e-6)
        ws.send_json({"cmd": "resume"})
        assert recv_state(ws, "running")["elapsed_s"] == pytest.approx(mark, abs=1e-6)
        assert recv_until(ws, "batch")["t0"] == pytest.approx(mark, abs=1e-6)   # continues exactly where it paused

        ws.send_json({"cmd": "update", "settings": {"fault": "knock", "rpm": 2500}})
        assert recv_state(ws, "running")["truth"]["fault"] == "knock"
        ws.send_json({"cmd": "update", "settings": {"fs": 1000}})
        assert recv_until(ws, "error")["code"] == "not_live"

        ws.send_json({"cmd": "stop"})
        s = recv_state(ws, "stopped")
        assert s["elapsed_s"] > 0
        ws.send_json({"cmd": "reset"})
        s = recv_state(ws, "idle")
        assert s["elapsed_s"] == 0 and s["samples"] == 0
        ws.send_json({"cmd": "start", "settings": {**FAST, "seed": 5}})        # a new run starts again from t=0
        assert recv_until(ws, "batch")["t0"] == 0


def test_invalid_start_and_commands():
    with client.websocket_connect("/api/vibration/live") as ws:
        ws.receive_json()
        ws.send_json({"cmd": "start", "settings": {"fs": 5}})
        assert recv_until(ws, "error")["code"] == "bad_fs"
        ws.send_json({"cmd": "start", "settings": {"fault": "gremlins"}})
        assert recv_until(ws, "error")["code"] == "bad_fault"
        ws.send_json({"cmd": "dance"})
        assert recv_until(ws, "error")["code"] == "bad_command"
        ws.send_json([1, 2])
        assert recv_until(ws, "error")["code"] == "bad_command"
        ws.send_json({"cmd": "channel", "channel": "nope"})
        assert recv_until(ws, "error")["code"] == "bad_channel"


def test_disconnect_mid_run_leaves_server_healthy():
    with client.websocket_connect("/api/vibration/live") as ws:
        ws.receive_json()
        ws.send_json({"cmd": "start", "settings": FAST})
        recv_until(ws, "batch")
    assert client.get("/api/health").json() == {"ok": True}


def test_existing_endpoints_and_csv_upload_still_work():
    assert client.get("/api/meta").status_code == 200
    csv = b"timestamp,accel_x\n" + b"".join(f"{i / 1000:.4f},{np.sin(i / 10):.5f}\n".encode() for i in range(1000))
    r = client.post("/api/vibration/analyze", files={"file": ("a.csv", csv, "text/csv")})
    assert r.status_code == 200 and r.json()["status"] == "success"
