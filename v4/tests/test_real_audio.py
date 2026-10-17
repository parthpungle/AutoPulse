import numpy as np
from conftest import needs_real_models

from autopulse import real_audio


def engine_like(seconds=3.0, fs=44100, seed=0):
    """A synthetic engine-ish clip: firing pulses at ~27 Hz through a 1.2 kHz resonance, plus noise."""
    rng = np.random.default_rng(seed)
    t = np.arange(int(seconds * fs)) / fs
    pulses = (np.sin(2 * np.pi * 27 * t) > 0.97).astype(float)
    k = np.arange(400)
    ring = np.convolve(pulses, np.exp(-k / 60) * np.sin(2 * np.pi * 1200 * k / fs))[:len(t)]
    return (0.3 * ring + 0.02 * rng.normal(size=len(t))).astype(np.float32), fs


def test_windows_from_signal_drops_silence():
    x, fs = engine_like()
    padded = np.concatenate([x, np.zeros(2 * fs, np.float32)])
    kept, dropped = real_audio.windows_from_signal(padded, fs)
    assert len(kept) >= 4 and dropped >= 2


@needs_real_models
def test_classify_clip_probabilities_valid():
    x, fs = engine_like()
    r = real_audio.classify_clip(x, fs)
    assert r["n_windows"] == 5                                        # 3 s, 1 s windows every 0.5 s
    assert np.isclose(sum(r["ensemble"]), 1, atol=1e-3)
    assert all(np.isclose(sum(p), 1, atol=1e-3) for p in r["per_window"])
    assert all(np.isclose(sum(p), 1, atol=1e-3) for p in r["per_model"].values())
    assert r["verdict"] in real_audio.CLASSES + ["unsure"]
    assert 0 <= r["confidence"] <= 1 and r["source"] == "real-audio models"
