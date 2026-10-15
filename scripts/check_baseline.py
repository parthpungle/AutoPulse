"""Compare static vs adaptive baseline over a simulated car life (false alarms, detection delay)."""
import sys
from pathlib import Path

import numpy as np

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from autopulse.baseline import simulate_life  # noqa: E402
from autopulse.generator import make_car, synth_window  # noqa: E402
from autopulse.signatures import features  # noqa: E402

prior_file = Path(__file__).resolve().parents[1] / "models" / "population_prior.npz"
if prior_file.exists():
    p = np.load(prior_file)
    mean, std = p["mean"], p["std"]
else:
    rng = np.random.default_rng(0)
    X = []
    for car_id in range(8):
        car = make_car(car_id)
        for _ in range(40):
            w = synth_window("healthy", rpm=rng.uniform(750, 4000), car=car,
                             coolant_c=rng.choice([rng.uniform(10, 45), rng.uniform(80, 95)]),
                             age=rng.uniform(0, 1), rng=rng)
            X.append(features(w["signal"], w["fs"], w["rpm"], w["crank_speed"]))
    X = np.array(X)
    mean, std = X.mean(0), X.std(0) + 1e-6

L = simulate_life(mean, std)
fault_day = L[L.fault_active].day.min()
for col in ("static", "adaptive"):
    before = L[(~L.fault_active) & (L.day >= 14)]
    after = L[L.fault_active]
    fa = before[before[f"{col}_alarm"]].day.nunique()
    det = after[after[f"{col}_alarm"]].day.min()
    print(f"{col:9s} false-alarm days={fa:3d}  detection delay={det - fault_day if np.isfinite(det) else 'missed'}")
    for ctx in ("cold_start", "warm_idle"):
        d = L[L.context == ctx]
        print(f"   {ctx:10s} healthy score p50={d[~d.fault_active][f'{col}_score'].median():.2f} "
              f"p95={d[~d.fault_active][f'{col}_score'].quantile(.95):.2f}  "
              f"fault p50={d[d.fault_active][f'{col}_score'].median():.2f}")
