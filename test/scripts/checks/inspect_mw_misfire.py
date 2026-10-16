"""Diagnostics for the MathWorks misfire example export: TDC phase, per-slot speed gain, flag polarity."""
from pathlib import Path

import numpy as np
import pandas as pd

d = pd.read_csv(Path(__file__).resolve().parents[2] / "matlab" / "out" / "mw_misfire_signals.csv")
ang = d.crank_angle.to_numpy()
cyc = np.concatenate([[0], np.cumsum(np.diff(ang) < -300)])
theta = ang + 720 * cyc                                     # unwrapped crank angle (deg)
tq, w, flag = d.indicated_torque.to_numpy(), d.engine_speed.to_numpy(), d.misfire_cyl3.to_numpy()

# TDC phase from the torque minimum (end of compression), folded to 180 deg
bins = np.arange(0, 181, 2)
fold = np.mod(theta, 180)
prof = [tq[(fold >= a) & (fold < a + 2)].mean() for a in bins[:-1]]
theta0 = bins[int(np.argmin(prof))]
print(f"torque minimum at {theta0} deg (mod 180) -> TDC phase")

edges = np.arange(theta0 + 180 * np.ceil((theta[0] - theta0) / 180), theta[-1], 180)
rows = []
for k in range(len(edges) - 1):
    sel = (theta >= edges[k]) & (theta < edges[k + 1])
    if sel.sum() < 10:
        continue
    i0, i1 = np.where(sel)[0][[0, -1]]
    rows.append({"k": k, "slot": int(np.mod(round(edges[k] / 180), 4)), "gain": w[i1] - w[i0],
                 "torque": tq[sel].mean(), "flag_mean": flag[sel].mean()})
r = pd.DataFrame(rows)
print(r.groupby("slot")[["gain", "torque", "flag_mean"]].mean().round(3))
print("intervals with flag partly 0:\n", r[r.flag_mean < 0.99][["k", "slot", "gain", "torque", "flag_mean"]].round(3).to_string())
print("\nlowest-torque intervals:\n", r.nsmallest(12, "torque")[["k", "slot", "gain", "torque", "flag_mean"]].round(3).to_string())
