"""Cross-sensor residuals for OBD-II: what one sensor reads minus what the others say it should read.

A drifting MAP sensor or a retarded ignition still reports values inside the normal range, so the signal alone
looks fine. But manifold pressure is largely set by rpm, throttle and intake temperature, ignition timing by rpm,
load and coolant, and the short-term fuel trim by rpm and load. Models of those relations, learned on healthy
trips, turn a drift into a residual that grows away from zero.
"""
import numpy as np
from sklearn.ensemble import HistGradientBoostingRegressor

RELATIONS = {   # name -> (target column, predictor columns); columns of autopulse.realdata.load_carobd() trips
    "map": ("map_kpa", ["rpm", "throttle_pct", "iat_c"]),
    "timing": ("timing_deg", ["rpm", "engine_load", "coolant_c"]),
    "stft": ("stft_pct", ["rpm", "engine_load"]),
}
WINDOW_TARGET = {"map": "map_kpa", "timing": "timing_deg", "stft": "stft_mean"}   # the window feature it explains
RESID_FEATS = [f"{n}_res" for n in RELATIONS] + [f"{n}_res_std" for n in RELATIONS]


class ResidualModels:
    """One gradient-boosting regressor per relation, fitted on rows of healthy (learning) trips only."""

    def __init__(self, seed=0):
        self.models = {n: HistGradientBoostingRegressor(max_iter=200, learning_rate=0.1, random_state=seed)
                       for n in RELATIONS}

    def fit(self, trips):
        import pandas as pd
        d = pd.concat(trips, ignore_index=True)
        for n, (target, cols) in RELATIONS.items():
            ok = d[cols + [target]].notna().all(axis=1)
            self.models[n].fit(d.loc[ok, cols].to_numpy(), d.loc[ok, target].to_numpy())
        return self

    def window_columns(self, w):
        """For one window of 1 Hz rows: each relation's mean prediction and the std of its row residuals."""
        out = {}
        for n, (target, cols) in RELATIONS.items():
            pred = self.models[n].predict(w[cols].to_numpy())
            out[f"{n}_pred"] = float(np.mean(pred))
            out[f"{n}_res_std"] = float(np.std(w[target].to_numpy() - pred))
        return out


def add_residuals(wins):
    """Residual means from window means: computed AFTER any fault injection on the window features, so a drift
    injected into map_kpa or timing_deg moves the residual while the predictors (rpm, throttle, ...) do not."""
    wins = wins.copy()
    for n, col in WINDOW_TARGET.items():
        wins[f"{n}_res"] = wins[col] - wins[f"{n}_pred"]
    return wins
