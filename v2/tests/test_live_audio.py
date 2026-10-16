"""Live microphone pipeline: preprocessing, gates and model handling (autopulse/live_audio.py).

Generated signals check the plumbing only; they say nothing about real-world engine-fault accuracy.
"""
import numpy as np
import pytest

from autopulse import live_audio as la
from autopulse.realdata import RAW, estimate_rpm, load_engine_audio
from autopulse.signatures import FEATURE_NAMES, features


def tone(f=1000.0, fs=48000, dur=1.0, amp=0.3):
    t = np.arange(int(fs * dur)) / fs
    return amp * np.sin(2 * np.pi * f * t)


def engine_like(fs=48000, dur=1.0, rpm=1500, amp=0.3, seed=0):
    """Impulse train at the 4-cylinder firing rate plus noise: enough structure for the feature extractor."""
    rng = np.random.default_rng(seed)
    n = int(fs * dur)
    x = 0.05 * rng.standard_normal(n)
    k = np.arange(int(0.01 * fs)) / fs
    ring = np.exp(-300 * k) * np.sin(2 * np.pi * 900 * k)
    for s in np.arange(0, n - len(ring), int(fs / (rpm / 30))):
        x[s:s + len(ring)] += ring
    return amp * x / np.abs(x).max()


# ------------------------------------------------------------------ windows, mono, resampling
def test_split_windows_count_and_length():
    x = np.arange(48000 * 3)
    w = la.split_windows(x, 48000, 1.0, 0.5)
    assert len(w) == 5 and all(len(s) == 48000 for s in w)
    assert w[1][0] == 24000
    assert la.split_windows(np.zeros(1000), 48000) == []
    with pytest.raises(ValueError):
        la.split_windows(x, 48000, 1.0, 0)


def test_to_mono():
    st = np.stack([np.ones(10), -np.ones(10) * 3], axis=1)
    np.testing.assert_allclose(la.to_mono(st), -np.ones(10))
    np.testing.assert_array_equal(la.to_mono(np.arange(4)), np.arange(4))
    with pytest.raises(la.AudioInputError):
        la.to_mono(np.zeros((2, 2, 2)))


@pytest.mark.parametrize("fs", [16000, 44100, 48000, 96000])
def test_resampled_to_model_rate_keeps_frequency(fs):
    p = la.prepare_window(tone(1000, fs), fs)
    assert p.fs == la.MODEL_FS and p.signal.shape == (int(la.WINDOW_S * la.MODEL_FS),)
    f = np.fft.rfftfreq(len(p.signal), 1 / p.fs)
    assert abs(f[np.argmax(np.abs(np.fft.rfft(p.signal)))] - 1000) <= 2


def test_prepare_window_normalizes_and_uses_last_second():
    x = np.concatenate([np.zeros(24000), tone(500, 24000, 1.0, 0.2) + 0.1])
    p = la.prepare_window(x, 24000)
    assert abs(p.signal.mean()) < 1e-9 and abs(p.signal.std() - 1) < 1e-6
    assert p.quality["status"] == "ok" and p.n_in == 24000


# ------------------------------------------------------------------ invalid input
@pytest.mark.parametrize("samples,fs,msg", [
    (np.array([]), 48000, "empty"),
    (np.full(48000, np.nan), 48000, "NaN"),
    (np.r_[np.zeros(47999), np.inf], 48000, "NaN or infinite"),
    (np.zeros(1000), 48000, "need"),
    (np.zeros(48000 * 5), 48000, "longer"),
    (np.zeros(48000), 0, "outside"),
    (np.zeros(48000), 250000, "outside"),
    (np.zeros(48000), 44100.5, "whole number"),
    (np.zeros(48000), "abc", "whole number"),
    (np.zeros(48000), True, "whole number"),
])
def test_invalid_inputs_rejected(samples, fs, msg):
    with pytest.raises(la.AudioInputError, match=msg):
        la.prepare_window(samples, fs)


# ------------------------------------------------------------------ quality gate
def test_quality_flags():
    assert la.quality(tone(amp=0.3))["status"] == "ok"
    assert la.quality(np.clip(tone(amp=3.0), -1, 1))["status"] == "clipped"
    assert la.quality(tone(amp=1e-4))["status"] == "quiet"
    assert la.quality(np.zeros(48000))["status"] == "silent"
    q = la.quality(tone(amp=0.5))
    assert q["rms_dbfs"] == pytest.approx(20 * np.log10(0.5 / np.sqrt(2)), abs=0.1) and q["warnings"] == []


# ------------------------------------------------------------------ features
def test_feature_shape_matches_training_pipeline():
    p = la.prepare_window(engine_like(), 48000)
    x, rpm = la.featurize(p.signal)
    assert x.shape == (len(FEATURE_NAMES),) and np.all(np.isfinite(x))
    # identical to evaluate_real.eval_audio's call for the same 24 kHz window
    ref = features(p.signal, 24000, estimate_rpm(p.signal, 24000))
    ref[la.LOG_RMS] = 0.0  # the one deliberate difference (see featurize)
    np.testing.assert_array_equal(x, ref)
    assert 1200 <= rpm <= 1800  # firing rate of the impulse train recovered


def test_features_invariant_to_dtype_and_gain():
    """Regression: per-window z-scoring leaves log_rms as rounding noise that differed between float32 training
    windows and float64 live windows; after scaling it dominated the model (every window -> belt squeal)."""
    x = engine_like()
    ref, _ = la.featurize(la.prepare_window(x, 48000).signal)
    assert ref[la.LOG_RMS] == 0.0
    for variant in (x.astype(np.float32), x * 0.05, x * 2.5):
        v, _ = la.featurize(la.prepare_window(variant, 48000).signal)
        np.testing.assert_allclose(v, ref, rtol=1e-4, atol=1e-6)
    f32, _ = la.featurize(la.normalize(la.prepare_window(x, 48000).signal.astype(np.float32).astype(np.float64)))
    np.testing.assert_allclose(f32, ref, rtol=1e-4, atol=1e-5)


# ------------------------------------------------------------------ model output and artifacts
def test_check_proba():
    np.testing.assert_allclose(la.check_proba([0.25] * 4, 4), [0.25] * 4)
    for bad in ([0.5, 0.5], [np.nan, 0.5, 0.25, 0.25], [0.9, 0.9, 0.1, 0.1], [1.5, -0.5, 0, 0]):
        with pytest.raises(la.InvalidModelOutput):
            la.check_proba(bad, 4)


def test_missing_and_corrupt_artifacts(tmp_path):
    with pytest.raises(la.ModelUnavailable, match="not found"):
        la.LiveAudioModel.load(tmp_path / "nope.joblib")
    bad = tmp_path / "bad.joblib"
    bad.write_bytes(b"not a pickle")
    with pytest.raises(la.ModelUnavailable, match="could not load"):
        la.LiveAudioModel.load(bad)
    import joblib
    joblib.dump([1, 2], tmp_path / "list.joblib")
    with pytest.raises(la.ModelUnavailable, match="not a live-audio"):
        la.LiveAudioModel.load(tmp_path / "list.joblib")


class FakeModel:
    def __init__(self, proba, novelty=0.0):
        self.p, self.n = proba, novelty

    def predict_proba(self, X):
        return np.array([self.p])

    def score_samples(self, X):
        return np.array([self.n])


def bundle(proba=(0.7, 0.1, 0.1, 0.1), novelty=0.0, **over):
    b = {"version": la.ARTIFACT_VERSION, "model": FakeModel(proba), "novelty": FakeModel(proba, novelty),
         "novelty_threshold": -0.5, "classes": ["healthy", "misfire", "valve_tick", "belt_squeal"],
         "feature_names": FEATURE_NAMES, "fs": la.MODEL_FS, "window_s": la.WINDOW_S,
         "normalization": "per_window", "metrics": {}, "dataset": {}}
    b.update(over)
    return b


@pytest.mark.parametrize("over,msg", [
    ({"feature_names": FEATURE_NAMES[:-1]}, "feature set"),
    ({"fs": 48000}, "preprocessing"),
    ({"normalization": "per_recording"}, "preprocessing"),
    ({"version": 99}, "version"),
])
def test_incompatible_bundle_rejected(over, msg):
    with pytest.raises(la.ModelUnavailable, match=msg):
        la.LiveAudioModel(bundle(**over))


def test_gates_and_prediction():
    good = la.prepare_window(engine_like(), 48000)
    r = la.analyze_prepared(good, la.LiveAudioModel(bundle()))
    assert r["prediction_status"]["code"] == "ok" and r["prediction"]["label"] == "healthy"
    assert r["prediction"]["score"] == pytest.approx(0.7)
    assert len(r["spectrogram"]["z"]) == 64 and r["timings"]["total_ms"] > 0

    ood = la.analyze_prepared(good, la.LiveAudioModel(bundle(novelty=-0.9)))
    assert ood["prediction"] is None and ood["prediction_status"]["code"] == "out_of_distribution"

    quiet = la.prepare_window(engine_like(amp=1e-5), 48000)
    q = la.analyze_prepared(quiet, la.LiveAudioModel(bundle(novelty=-0.9)))
    assert q["prediction"] is None and q["prediction_status"]["code"] == "bad_quality"
    assert "novelty" not in q  # model never consulted on unusable audio

    none = la.analyze_prepared(good, None)
    assert none["prediction"] is None and none["prediction_status"]["code"] == "no_model"
    assert none["evidence"]["features"]  # signal view still works without a model

    with pytest.raises(la.InvalidModelOutput):
        la.analyze_prepared(good, la.LiveAudioModel(bundle(proba=(np.nan, 0, 0, 1))))


# ------------------------------------------------------------------ real artifact + real recordings
needs_real = pytest.mark.skipif(not la.ARTIFACT.exists() or not (RAW / "engine_audio").exists(),
                                reason="needs models/live_audio.joblib and data/raw/engine_audio")


@needs_real
def test_live_path_matches_training_windows():
    """A raw recording fed the live way gives the same model input as the training loader (up to edge effects
    of resampling a 1 s chunk instead of the whole file)."""
    from scipy.io import wavfile
    f = sorted((RAW / "engine_audio").glob("healthy_*.wav"))[0]
    fs, y = wavfile.read(f)
    y = y.astype(np.float64)
    y = (y.mean(axis=1) if y.ndim > 1 else y) / np.abs(y).max()
    live = la.prepare_window(y[fs // 2: fs // 2 + fs], fs).signal  # 0.5-1.5 s = training window #1
    clip_windows = [w for w in load_engine_audio() if w["clip"] == f.stem]
    train = la.normalize(clip_windows[1]["signal"].astype(np.float64))
    mid = slice(1000, -1000)
    assert np.corrcoef(live[mid], train[mid])[0, 1] > 0.99


@needs_real
def test_real_model_loads_and_scores_real_recording():
    m = la.LiveAudioModel.load()
    assert m.classes == ["healthy", "misfire", "valve_tick", "belt_squeal"]
    from scipy.io import wavfile
    f = sorted((RAW / "engine_audio").glob("misfire_*.wav"))[0]
    fs, y = wavfile.read(f)
    y = y.astype(np.float64)
    y = (y.mean(axis=1) if y.ndim > 1 else y) / (np.abs(y).max() + 1e-9) * 0.5
    r = m.analyze(y[:fs], fs)
    assert r["quality"]["status"] == "ok"
    assert r["prediction_status"]["code"] in ("ok", "out_of_distribution")
    if r["prediction"]:
        assert set(r["prediction"]["scores"]) == set(m.classes)
        assert sum(r["prediction"]["scores"].values()) == pytest.approx(1, abs=1e-3)


@needs_real
def test_live_path_agrees_with_training_path_on_raw_recordings():
    """Raw WAVs fed the live way (native rate, any gain, 1 s chunks) must get the same model output as the
    training loader's windows of the same recordings. In-sample: a consistency check, not an accuracy figure."""
    from scipy.io import wavfile
    m = la.LiveAudioModel.load()
    wins = load_engine_audio()
    agree = total = 0
    for f in [sorted((RAW / "engine_audio").glob(f"{c}_*.wav"))[i] for c in ("healthy", "misfire", "tappet_issue", "belt_issue") for i in (0, 5)]:
        fs, y = wavfile.read(f)
        y = y.astype(np.float64)
        y = (y.mean(axis=1) if y.ndim > 1 else y) / (np.abs(y).max() + 1e-9) * 0.3
        train = [w for w in wins if w["clip"] == f.stem]
        for k, w in enumerate(train[:6]):
            a = m.proba(la.featurize(la.normalize(w["signal"].astype(np.float64)))[0]).argmax()
            b = m.proba(la.featurize(la.prepare_window(y[k * fs // 2: k * fs // 2 + fs], fs).signal)[0]).argmax()
            agree += a == b
            total += 1
    assert agree / total >= 0.9, f"live and training paths agree on only {agree}/{total} windows"
