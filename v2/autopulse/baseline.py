"""Adaptive, context-aware per-car baseline vs. a static baseline, plus wear (health %) tracking.

Normal for THIS car is learned per context (cold start / warm idle), updated slowly, and
only from windows that look healthy, so seasons and normal ageing are absorbed while a
sudden new fault still stands out.
"""
import numpy as np
import pandas as pd

from .generator import make_car, synth_window
from .signatures import FEATURE_NAMES, features

# env_peak_order is an argmax (jumps between peaks), so it is excluded from distance scoring
SCORE_IDX = np.array([i for i, n in enumerate(FEATURE_NAMES) if n != "env_peak_order"])
TOP_K = 5  # a fault moves a few features a lot, so score the k most deviating ones


def anomaly_score(z, top_k=TOP_K):
    z2 = np.sort(np.clip(z, -10, 10) ** 2)
    return float(np.sqrt(np.mean(z2[-top_k:])))


class StaticBaseline:
    """One fixed 'healthy' fingerprint learned once, ignoring context. The naive approach."""

    def __init__(self, threshold=3.0, score_idx=SCORE_IDX, top_k=TOP_K):
        self.threshold, self.idx, self.top_k = threshold, score_idx, top_k

    def fit(self, X):
        X = np.asarray(X)[:, self.idx]
        self.mean, self.std = X.mean(0), X.std(0) + 1e-6
        return self

    def score(self, x):
        return anomaly_score((x[self.idx] - self.mean) / self.std, self.top_k)


class AdaptiveBaseline:
    """Per-context EWMA baseline blended with a population prior until calibrated."""

    def __init__(self, prior_mean, prior_std, alpha=0.06, calib_n=10, threshold=3.0, gate=2.5, persist=2,
                 score_idx=SCORE_IDX, top_k=TOP_K, min_std_frac=0.15):
        self.idx, self.top_k, self.min_std_frac = score_idx, top_k, min_std_frac
        self.prior_mean = np.asarray(prior_mean)[score_idx]
        self.prior_std = np.asarray(prior_std)[score_idx]
        self.alpha, self.calib_n, self.threshold, self.persist = alpha, calib_n, threshold, persist
        self.gate = gate  # only windows scoring below this are trusted enough to learn from
        self.state = {}  # key -> dict(mean, var, n, streak, frozen)

    def _get(self, key):
        if key not in self.state:
            self.state[key] = {"mean": self.prior_mean.copy(), "var": self.prior_std ** 2,
                               "n": 0, "streak": 0, "frozen": False}
        return self.state[key]

    def _stats(self, s):
        w = min(s["n"] / self.calib_n, 1.0)
        mean = w * s["mean"] + (1 - w) * self.prior_mean
        std = np.sqrt(w * s["var"] + (1 - w) * self.prior_std ** 2)
        return mean, np.maximum(std, self.min_std_frac * self.prior_std)

    def score(self, x, key):
        mean, std = self._stats(self._get(key))
        return anomaly_score((x[self.idx] - mean) / std, self.top_k)

    def observe(self, x, key):
        """Score a window, decide anomaly, and update the baseline only if it looks healthy."""
        s = self._get(key)
        sc = self.score(x, key)
        s["streak"] = s["streak"] + 1 if sc > self.threshold else 0
        anomaly = s["streak"] >= self.persist
        if anomaly:  # a fault in one context means the car is suspect: stop learning everywhere
            for other in self.state.values():
                other["frozen"] = True
        if sc <= self.gate and not s["frozen"]:
            v = x[self.idx]
            a = 1.0 / (s["n"] + 1) if s["n"] < self.calib_n else self.alpha
            if s["n"] == 0:
                s["mean"], s["var"] = v.copy(), self.prior_std ** 2 * 0.25
            else:
                d = v - s["mean"]
                s["mean"] = s["mean"] + a * d
                s["var"] = (1 - a) * (s["var"] + a * d ** 2)
            s["n"] += 1
        return sc, anomaly

    def mark_serviced(self, key=None):
        for k in ([key] if key else list(self.state)):
            self.state.pop(k, None)


def ambient_for_day(day):
    """Summer (~32 C) at day 0 cooling to winter (~8 C) around day 180."""
    return 20 + 12 * np.cos(2 * np.pi * day / 365)


def simulate_life(prior_mean, prior_std, days=240, fault_day=175, car_id=3, seed=7):
    """One car over months: daily cold start + warm idle, normal ageing, seasons, then a valve fault."""
    rng = np.random.default_rng(seed)
    car = make_car(car_id)
    contexts = {"cold_start": dict(rpm=1100.0), "warm_idle": dict(rpm=800.0)}
    rows, calib = [], []
    adaptive = AdaptiveBaseline(prior_mean, prior_std)
    static = None
    for day in range(days):
        amb = ambient_for_day(day)
        age = day / 365 * 0.6
        fault = "valve_tick" if day >= fault_day else "healthy"
        sev = min(0.35 + (day - fault_day) / 120, 0.9) if fault != "healthy" else 0
        for ctx, p in contexts.items():
            coolant = amb + 3 if ctx == "cold_start" else 90.0
            w = synth_window(fault, rpm=p["rpm"] * rng.uniform(0.97, 1.03), car=car, severity=sev,
                             coolant_c=coolant, age=age, rng=rng)
            x = features(w["signal"], w["fs"], w["rpm"], w["crank_speed"])
            if day < 14:
                calib.append(x)
            if day == 14:
                static = StaticBaseline().fit(calib)
            a_score, a_alarm = adaptive.observe(x, ctx)
            s_score = static.score(x) if static else np.nan
            rows.append({"day": day, "context": ctx, "ambient_c": amb, "fault_active": fault != "healthy",
                         "adaptive_score": a_score, "adaptive_alarm": a_alarm,
                         "static_score": s_score, "static_alarm": bool(static and s_score > static.threshold)})
    return pd.DataFrame(rows)


def simulate_wear(days=240, seed=3):
    """Daily component health measurements with normal ageing, seasonal effects and noise."""
    rng = np.random.default_rng(seed)
    d = np.arange(days)
    amb = ambient_for_day(d)
    # battery: cranking voltage dip grows as internal resistance rises; cold makes it worse
    dip = 1.55 + 0.0028 * d + 0.025 * np.clip(25 - amb, 0, None) + rng.normal(0, 0.05, days)
    dip_temp_comp = dip - 0.025 * np.clip(25 - amb, 0, None)   # remove known cold effect
    km = np.cumsum(rng.uniform(15, 60, days))
    return pd.DataFrame({
        "day": d, "ambient_c": amb, "km": km,
        "crank_dip_v": dip, "crank_dip_comp_v": dip_temp_comp,
        "battery_health_pct": np.clip(100 * (3.2 - dip_temp_comp) / (3.2 - 1.55), 0, 100),
        "oil_life_pct": np.clip(100 - (km % 10000) / 100 * (1 + 0.3 * (amb < 15)), 0, 100),
        "brake_pad_pct": np.clip(100 - km / 40000 * 100 + rng.normal(0, 0.8, days), 0, 100),
        "tyre_tread_pct": np.clip(100 - km / 45000 * 100 + rng.normal(0, 0.8, days), 0, 100),
    })


def predict_days_to(series_days, values, limit):
    """Linear trend extrapolation: days until values cross limit (None if not trending there)."""
    k, b = np.polyfit(series_days, values, 1)
    if abs(k) < 1e-9:
        return None
    t = (limit - b) / k
    return max(t - series_days[-1], 0) if t > series_days[-1] else None
