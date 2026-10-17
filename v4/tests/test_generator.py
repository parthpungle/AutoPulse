import numpy as np

from autopulse.generator import ENGINE_FAULTS, make_car, synth_window

ORIGINAL_KEYS = {"signal", "crank_speed", "fs", "rpm", "fault"}       # what synth_window returned before fusion


def window(seed=0, **kw):
    return synth_window("misfire", rpm=1800, car=make_car(3), severity=0.8, rng=np.random.default_rng(seed), **kw)


def test_same_seed_identical_output():
    a, b = window(7), window(7)
    for k in ("signal", "mic", "crank_speed"):
        assert np.array_equal(a[k], b[k])
    assert a["obd"] == b["obd"]


def test_different_seed_differs():
    assert not np.array_equal(window(1)["signal"], window(2)["signal"])


def test_default_keys_kept_and_new_channels_present():
    w = window()
    assert ORIGINAL_KEYS <= set(w)
    assert {"accel", "mic", "obd"} <= set(w)
    assert np.array_equal(w["accel"], w["signal"])                   # accel is the old signal
    assert len(w["mic"]) == len(w["accel"]) == w["fs"]
    assert {"rpm", "coolant_c", "throttle_pct", "load_pct", "stft_pct", "stft_std", "ltft_pct", "map_kpa"} <= set(w["obd"])


def test_every_fault_generates_finite_windows():
    for f in ENGINE_FAULTS:
        w = synth_window(f, rpm=1500, car=make_car(1), rng=np.random.default_rng(0))
        assert np.isfinite(w["signal"]).all() and np.isfinite(w["mic"]).all()


def test_randomize_mode_runs_and_draws_its_own_rpm():
    w = window(3, randomize=True)
    assert np.isfinite(w["accel"]).all() and np.isfinite(w["mic"]).all()
    assert 600 <= w["rpm"] <= 6500
    bank = [np.random.default_rng(1).normal(size=24000).astype(np.float32)]
    assert np.isfinite(window(4, randomize=True, bg_noise_bank=bank)["mic"]).all()
