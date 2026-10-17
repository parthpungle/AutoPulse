import io

import numpy as np
import pytest
import soundfile as sf
from conftest import needs_real_models, needs_sim_models
from fastapi.testclient import TestClient


@pytest.fixture(scope="module")
def client():
    from backend.app import app
    return TestClient(app)        # no `with`: skips startup (LAN discovery, auto-pair); these routes need none of it


def wav_bytes(seconds, fs=16000, seed=0):
    t = np.arange(int(seconds * fs)) / fs
    x = 0.2 * np.sin(2 * np.pi * 220 * t) + 0.05 * np.random.default_rng(seed).normal(size=len(t))
    b = io.BytesIO()
    sf.write(b, x.astype(np.float32), fs, format="WAV")
    return b.getvalue()


@needs_sim_models
def test_meta(client):
    r = client.get("/api/meta")
    assert r.status_code == 200
    d = r.json()
    assert d["engine_faults"] and d["car_types"] and "SVM" in d["models"]


def test_results(client):
    r = client.get("/api/results")
    assert r.status_code == 200
    assert {"simulator", "real", "matlab"} <= set(r.json())


@needs_sim_models
def test_wear(client):
    r = client.get("/api/wear")
    assert r.status_code == 200
    assert {"components", "battery"} <= set(r.json())


@needs_real_models
def test_classify_audio_small_wav(client):
    r = client.post("/api/classify-audio", files={"file": ("tone.wav", wav_bytes(2.0), "audio/wav")})
    assert r.status_code == 200
    d = r.json()
    assert np.isclose(sum(d["ensemble"]), 1, atol=1e-3)
    assert d["n_windows"] == 3 and "sig" in d and d["model_info"]["n_recordings"] > 0


def test_classify_audio_too_large_is_413(client):
    r = client.post("/api/classify-audio", files={"file": ("big.wav", bytes(10_000_001), "audio/wav")})
    assert r.status_code == 413


def test_classify_audio_too_long_is_413(client):
    r = client.post("/api/classify-audio", files={"file": ("long.wav", wav_bytes(31.0, fs=8000), "audio/wav")})
    assert r.status_code == 413


def test_classify_audio_undecodable_is_415(client):
    r = client.post("/api/classify-audio", files={"file": ("x.mp3", b"ID3\x03\x00" + bytes(2000), "audio/mpeg")})
    assert r.status_code == 415
