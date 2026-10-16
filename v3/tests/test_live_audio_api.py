"""FastAPI live-audio routes: payload validation, busy/timeout handling, model-unavailable state."""
import time

import numpy as np
import pytest
from fastapi.testclient import TestClient

import backend.app as api

client = TestClient(api.app)  # no context manager: skips the startup warm-up of the simulator models
OCTET = {"Content-Type": "application/octet-stream"}


def window(fs=48000, amp=0.3):
    t = np.arange(fs) / fs
    rng = np.random.default_rng(0)
    return (amp * (np.sin(2 * np.pi * 440 * t) + 0.2 * rng.standard_normal(fs))).astype("<f4")


def post(samples, fs=48000, headers=OCTET):
    return client.post(f"/api/live-audio/analyze?sample_rate={fs}", content=np.asarray(samples, "<f4").tobytes(),
                       headers=headers)


def test_status_reports_model_and_limits():
    r = client.get("/api/live-audio/status").json()
    assert r["source"] == "live_microphone" and r["limits"]["window_s"] == 1.0
    assert r["model_available"] == (r["reason"] is None)


def test_analyze_valid_window():
    r = post(window())
    assert r.status_code == 200, r.text
    d = r.json()
    assert d["source"] == "live_microphone" and d["input"]["sample_rate"] == 48000
    assert d["quality"]["status"] == "ok" and len(d["spectrogram"]["z"]) == 64
    assert d["prediction_status"]["code"] in ("ok", "out_of_distribution", "no_model")


@pytest.mark.parametrize("make,code", [
    (lambda: post(window(), headers={"Content-Type": "application/json"}), 415),
    (lambda: post(np.zeros(int(api.LIVE_MAX_BYTES / 4) + 10)), 413),
    (lambda: client.post("/api/live-audio/analyze?sample_rate=48000", content=b"abcde", headers=OCTET), 422),
    (lambda: client.post("/api/live-audio/analyze?sample_rate=48000", content=b"", headers=OCTET), 422),
    (lambda: post(np.full(48000, np.nan)), 422),
    (lambda: post(window()[:1000]), 422),
    (lambda: post(window(), fs=1000), 422),
    (lambda: client.post("/api/live-audio/analyze", content=window().tobytes(), headers=OCTET), 422),
])
def test_malformed_requests_rejected(make, code):
    assert make().status_code == code


def test_quiet_input_withheld():
    d = post(window(amp=1e-5)).json()
    assert d["quality"]["status"] == "quiet" and d["prediction"] is None


def test_model_unavailable(monkeypatch):
    monkeypatch.setattr(api, "live_model", lambda: (None, "live_audio.joblib not found"))
    assert client.get("/api/live-audio/status").json()["model_available"] is False
    d = post(window()).json()
    assert d["prediction"] is None and d["prediction_status"]["code"] == "no_model"


def test_busy_returns_429():
    assert api._live_slots.acquire(blocking=False) and api._live_slots.acquire(blocking=False)
    try:
        assert post(window()).status_code == 429
    finally:
        api._live_slots.release()
        api._live_slots.release()
    assert post(window()).status_code == 200


def test_timeout_returns_504_and_frees_slot(monkeypatch):
    real = api.la.analyze_prepared
    monkeypatch.setattr(api, "LIVE_TIMEOUT_S", 0.2)
    monkeypatch.setattr(api.la, "analyze_prepared", lambda *a: (time.sleep(0.6), real(*a))[1])
    assert post(window()).status_code == 504
    time.sleep(0.8)  # the worker finishes in the background and gives its slot back
    monkeypatch.setattr(api.la, "analyze_prepared", real)
    assert post(window()).status_code == 200


def test_invalid_model_output_returns_500(monkeypatch):
    def broken(*a):
        raise api.la.InvalidModelOutput("model returned 3 scores for 4 classes")
    monkeypatch.setattr(api.la, "analyze_prepared", broken)
    r = post(window())
    assert r.status_code == 500 and "rejected" in r.json()["detail"]


def test_existing_routes_still_work():
    assert client.get("/api/health").json() == {"ok": True}
    assert "real" in client.get("/api/results").json()
