"""Quick check that every fault produces a distinct signature."""
import sys
import time
from pathlib import Path

import numpy as np

sys.path.insert(0, str(Path(__file__).resolve().parents[2]))
from autopulse.generator import ENGINE_FAULTS, make_car, synth_window  # noqa: E402
from autopulse.signatures import FEATURE_NAMES, features, stft_image  # noqa: E402

SHOW = ("kurtosis", "order_1.0", "band_6000_7500", "env_peak_order",
        "knock_band_kurtosis", "crank_min_dip", "band_2000_3000")

car = make_car(8)
rng = np.random.default_rng(0)
t = time.time()
for f in ENGINE_FAULTS:
    w = synth_window(f, rpm=1500, car=car, rng=rng)
    x = features(w["signal"], w["fs"], w["rpm"], w["crank_speed"])
    S = stft_image(w["signal"], w["fs"])[2]
    print(f"{f:12s}", {n: round(float(v), 2) for n, v in zip(FEATURE_NAMES, x) if n in SHOW}, S.shape)
print(f"{(time.time() - t) / len(ENGINE_FAULTS) * 1000:.0f} ms per window")
