"""Validation + DSP correctness for autopulse.vibration, and the /api/vibration/analyze endpoint.

    .venv\\Scripts\\python -m pytest tests -q
"""
import io
import json
import sys
from pathlib import Path

import joblib
import numpy as np
import pytest
from fastapi.testclient import TestClient

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from autopulse import vibration as vib  # noqa: E402
from backend.app import app  # noqa: E402

client = TestClient(app)
FS = 1000.0


def csv_bytes(cols, fs=FS, timestamps=True, n=2000):
    t = np.arange(n) / fs
    lines = [",".join((["timestamp"] if timestamps else []) + list(cols))]
    for i in range(n):
        lines.append(",".join(([f"{t[i]:.6f}"] if timestamps else []) + [f"{c[i]:.6f}" for c in cols.values()]))
    return ("\n".join(lines) + "\n").encode()


def sine(f, a=1.0, n=2000, fs=FS, off=0.0):
    return a * np.sin(2 * np.pi * f * np.arange(n) / fs) + off


def post(raw, **data):
    return client.post("/api/vibration/analyze", files={"file": ("rec.csv", raw, "text/csv")}, data=data)


# ---------------------------------------------------------------- validation
def test_three_axis_ok():
    ch, fs, meta, w = vib.parse_csv(csv_bytes({"accel_x": sine(50), "accel_y": sine(80), "accel_z": sine(120)}))
    assert list(ch) == ["accel_x", "accel_y", "accel_z"]
    assert fs == pytest.approx(FS) and meta["sampling_rate_source"] == "timestamps" and meta["n_samples"] == 2000


def test_single_axis_with_alias_and_no_timestamps():
    ch, fs, *_ = vib.parse_csv(csv_bytes({"AX": sine(50)}, timestamps=False), sampling_rate_hz=1000)
    assert list(ch) == ["AX"] and fs == 1000


def expect(code, *a, **k):
    with pytest.raises(vib.VibrationError) as e:
        vib.parse_csv(*a, **k)
    assert e.value.code == code


def test_errors():
    good = {"accel_x": sine(50)}
    expect("empty_file", b"")
    expect("empty_file", b"timestamp,accel_x\n")
    expect("missing_columns", csv_bytes({"foo": sine(5)}))
    expect("missing_columns", csv_bytes(good), axes=["accel_q"])
    expect("sampling_rate_required", csv_bytes(good, timestamps=False))
    expect("too_few_samples", csv_bytes(good, n=100))
    expect("file_too_large", b"x" * (vib.MAX_BYTES + 1))
    expect("bad_time_unit", csv_bytes(good), time_unit="hours")
    bad = csv_bytes(good).decode().splitlines()
    bad[10] = "0.009,abc"
    expect("non_numeric", "\n".join(bad).encode())
    for tok in ("nan", "inf", ""):
        bad = csv_bytes(good).decode().splitlines()
        bad[10] = f"0.009,{tok}"
        expect("non_finite", "\n".join(bad).encode())
    dup = csv_bytes(good).decode().splitlines()
    dup[20] = dup[19]
    expect("bad_timestamps", "\n".join(dup).encode())
    back = csv_bytes(good).decode().splitlines()
    back[20], back[21] = back[21], back[20]
    expect("bad_timestamps", "\n".join(back).encode())
    expect("sampling_rate_mismatch", csv_bytes(good), sampling_rate_hz=500)


def test_irregular_and_minor_jitter():
    t = np.arange(2000) / FS
    t[500:] += 0.05   # one gap: only 1 of 1999 intervals off -> warning, not error
    raw = "timestamp,accel_x\n" + "\n".join(f"{a:.6f},{b:.6f}" for a, b in zip(t, sine(50))) + "\n"
    _, _, _, w = vib.parse_csv(raw.encode())
    assert any("deviate" in x for x in w)
    t = np.cumsum(np.random.default_rng(0).uniform(0.0005, 0.0015, 2000))
    raw = "timestamp,accel_x\n" + "\n".join(f"{a:.6f},{b:.6f}" for a, b in zip(t, sine(50))) + "\n"
    expect("irregular_sampling", raw.encode())


def test_invalid_settings():
    with pytest.raises(vib.VibrationError):
        vib.preprocess(sine(5), FS, highpass_hz=600)       # above Nyquist
    with pytest.raises(vib.VibrationError):
        vib.preprocess(sine(5), FS, highpass_hz=200, lowpass_hz=100)
    with pytest.raises(vib.VibrationError):
        vib.analyze({"a": sine(5)}, FS, rpm=-1)


# ---------------------------------------------------------------- DSP
def run(chs, **k):
    return vib.analyze(chs, FS, **k)


def test_sine_rms_peak_frequency_and_amplitude():
    r = run({"a": sine(100, a=2.0)})
    f = r["features"]["a"]
    assert f["rms"] == pytest.approx(2 / np.sqrt(2), rel=1e-3)
    assert f["crest_factor"] == pytest.approx(np.sin(np.deg2rad(72)) * np.sqrt(2), rel=1e-3)  # sampled peak is sin(72 deg)
    pk = f["peaks"][0]
    assert pk["frequency_hz"] == pytest.approx(100, abs=f["frequency_resolution_hz"])
    assert pk["amplitude"] == pytest.approx(2.0, rel=0.02)      # window-corrected amplitude
    assert f["frequency_resolution_hz"] == pytest.approx(FS / 2000)


def test_two_components_and_dc_removal():
    r = run({"a": sine(60, 1.0, off=5.0) + sine(210, 0.5)})
    f = r["features"]["a"]
    assert f["raw_mean"] == pytest.approx(5.0, abs=1e-2) and abs(f["mean"]) < 1e-9
    fr = sorted(p["frequency_hz"] for p in f["peaks"][:2])
    assert fr[0] == pytest.approx(60, abs=1) and fr[1] == pytest.approx(210, abs=1)
    keep = run({"a": sine(60, 1.0, off=5.0)}, detrend="none")["features"]["a"]
    assert keep["mean"] == pytest.approx(5.0, abs=1e-2)


def test_impulse_crest_and_kurtosis():
    x = np.zeros(2000)
    x[1000] = 10.0
    f = run({"a": x}, detrend="none")["features"]["a"]
    assert f["peak"] == 10.0 and f["crest_factor"] == pytest.approx(np.sqrt(2000), rel=1e-6) and f["kurtosis"] > 100


def test_constant_signal_is_safe():
    r = run({"a": np.full(2000, 3.0)})
    f = r["features"]["a"]
    assert f["rms"] == 0 and f["crest_factor"] is None and f["kurtosis"] is None and f["peaks"] == []
    assert any("constant" in w for w in r["warnings"])
    json.dumps(r)   # no NaN leaks into JSON


def test_multiaxis_channels_and_magnitude():
    r = run({"x": sine(50, 3.0), "y": sine(120, 1.0)})
    assert r["analysis_channels"] == ["x", "y", "magnitude"]
    assert r["features"]["x"]["rms"] > r["features"]["y"]["rms"] * 2.9
    assert r["features"]["x"]["peaks"][0]["frequency_hz"] == pytest.approx(50, abs=1)
    assert r["features"]["y"]["peaks"][0]["frequency_hz"] == pytest.approx(120, abs=1)
    assert r["features"]["magnitude"]["rms"] == pytest.approx(np.hypot(3 / np.sqrt(2), 1 / np.sqrt(2)), rel=1e-3)


def test_stft_shape_and_axes():
    r = run({"a": sine(100)})
    sg = r["spectrogram"]["a"]
    z = np.array(sg["power_db"])
    assert z.shape == (len(sg["f_hz"]), len(sg["t_s"]))
    assert sg["f_hz"][-1] == pytest.approx(FS / 2, rel=0.02) and sg["t_s"][-1] <= 2.0
    assert sg["nperseg"] == 1024 and sg["noverlap"] == 512 and sg["sampling_rate_hz"] == FS
    ridge = np.array(sg["f_hz"])[z.mean(1).argmax()]
    assert abs(ridge - 100) < 15


def test_sampling_rate_changes_frequency_axis():
    x = sine(100)
    a = vib.analyze({"a": x}, 1000.0)["features"]["a"]["peaks"][0]["frequency_hz"]
    b = vib.analyze({"a": x}, 2000.0)["features"]["a"]["peaks"][0]["frequency_hz"]
    assert b == pytest.approx(2 * a, rel=0.05)


def test_downsampling_keeps_impulse_and_bounds_size():
    x = np.zeros(100000)
    x[54321] = 7.0
    r = vib.analyze({"a": x}, 10000.0, detrend="none")
    assert len(r["waveform"]["a"]["y"]) <= 2000 and max(r["waveform"]["a"]["y"]) == 7.0
    assert len(r["spectrum"]["a"]["f_hz"]) <= 2000


def test_envelope_and_orders_optional():
    r = run({"a": sine(100)}, rpm=3000, envelope=True)
    assert r["envelope"]["f_hz"] and r["orders"]["rpm"] == 3000
    assert 1.0 in r["orders"]["orders"]
    plain = run({"a": sine(100)})
    assert plain.get("envelope") is None and plain.get("orders") is None


# ---------------------------------------------------------------- classification
def test_classification_unavailable_without_model(tmp_path):
    r = run({"a": sine(100)})
    c = vib.classify(r["features"], FS, model_dir=tmp_path)
    assert c["status"] == "unavailable" and c["label"] is None and c["confidence"] is None


def test_classification_with_compatible_model(tmp_path):
    from sklearn.linear_model import LogisticRegression
    r = run({"a": sine(100)})
    names = ["a.rms", "a.kurtosis"]
    X = np.array([[0.5, -1.5], [0.6, -1.4], [3.0, 5.0], [2.8, 6.0]])
    joblib.dump(LogisticRegression().fit(X, ["low", "low", "high", "high"]), tmp_path / "vibration_classifier.joblib")
    (tmp_path / "vibration_classifier.json").write_text(json.dumps(
        {"name": "toy", "classes": ["high", "low"], "feature_names": names, "sampling_rate_hz": FS, "domain": "test only"}))
    c = vib.classify(r["features"], FS, model_dir=tmp_path)
    assert c["status"] == "available" and c["label"] == "low" and 0.5 < c["confidence"] <= 1
    assert c["model"]["name"] == "toy" and set(c["probabilities"]) == {"high", "low"}
    assert vib.classify(r["features"], 2000.0, model_dir=tmp_path)["status"] == "unavailable"   # rate mismatch


def test_classification_error_status(tmp_path):
    (tmp_path / "vibration_classifier.joblib").write_bytes(b"not a model")
    (tmp_path / "vibration_classifier.json").write_text(json.dumps({"classes": ["a"], "feature_names": ["a.rms"]}))
    c = vib.classify(run({"a": sine(100)})["features"], FS, model_dir=tmp_path)
    assert c["status"] == "error" and c["label"] is None


# ---------------------------------------------------------------- API
def test_api_success_schema():
    r = post(csv_bytes({"accel_x": sine(50), "accel_y": sine(80)}), units="g", sensor_location="block", rpm="3000")
    assert r.status_code == 200
    d = r.json()
    assert d["status"] == "success" and d["source"] == "uploaded_recording"
    assert d["sampling_rate_hz"] == pytest.approx(FS) and d["channels"] == ["accel_x", "accel_y"]
    assert d["recording"]["units"] == "g" and d["recording"]["sensor_location"] == "block" and d["recording"]["filename"] == "rec.csv"
    for k in ("features", "waveform", "spectrum", "spectrogram", "settings", "warnings", "orders"):
        assert k in d
    assert d["classification"]["status"] == "unavailable" and d["classification"]["label"] is None
    assert any("units were not" in w for w in post(csv_bytes({"accel_x": sine(50)})).json()["warnings"])


def test_api_errors():
    r = post(b"")
    assert r.status_code == 422 and r.json()["status"] == "error" and r.json()["code"] == "empty_file"
    assert post(csv_bytes({"foo": sine(5)})).json()["code"] == "missing_columns"
    assert post(csv_bytes({"accel_x": sine(5)}), units="furlongs").json()["code"] == "bad_units"
    assert post(csv_bytes({"accel_x": sine(5)}), sampling_rate_hz="500").json()["code"] == "sampling_rate_mismatch"
    assert post(csv_bytes({"accel_x": sine(5)}), highpass_hz="900").json()["code"] == "bad_setting"
    big = post(b"a,b\n" + b"1,2\n" * (vib.MAX_BYTES // 4 + 10))
    assert big.status_code == 413 and big.json()["code"] == "file_too_large"


def test_api_classifier_failure_is_reported(monkeypatch):
    monkeypatch.setattr(vib, "classify", lambda *a, **k: {"status": "error", "label": None, "confidence": None,
                                                         "probabilities": None, "model": None, "reason": "boom"})
    r = post(csv_bytes({"accel_x": sine(50)}))
    assert r.status_code == 200 and r.json()["classification"]["status"] == "error" and r.json()["features"]


def test_sample_file_and_existing_endpoints():
    sample = Path(__file__).resolve().parents[1] / "data" / "samples" / "synthetic_accel_3axis.csv"
    d = post(sample.read_bytes(), units="g").json()
    assert d["status"] == "success" and d["sampling_rate_hz"] == pytest.approx(2000)
    assert d["features"]["accel_x"]["peaks"][0]["frequency_hz"] == pytest.approx(25, abs=1)
    assert client.get("/api/health").json() == {"ok": True}
    assert "engine_faults" in client.get("/api/meta").json()
    assert "contexts" in client.get("/api/baseline").json()
    assert "components" in client.get("/api/wear").json()
    assert client.get("/api/results").status_code == 200
    assert client.post("/api/signature", json={}).status_code == 200
