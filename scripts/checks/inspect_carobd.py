"""Check carOBD column sets, sampling and running ranges per trip group."""
from collections import Counter
from pathlib import Path

import numpy as np
import pandas as pd

RAW = Path(__file__).resolve().parents[2] / "data" / "raw" / "carobd"


def read(f):
    d = pd.read_csv(f, skipinitialspace=True, index_col=False)
    d = d.loc[:, ~d.columns.str.startswith("Unnamed")]
    d.columns = [c.replace("()", "").strip() for c in d.columns]
    return d


sets = Counter()
frames = []
for f in sorted(RAW.glob("*.csv")):
    d = read(f)
    sets[tuple(d.columns)] += 1
    d["trip"] = f.stem
    frames.append(d)
for cols, n in sets.items():
    print(n, "files:", len(cols), "cols", cols[:6], "...")

d = frames[0]
print("\nfirst trip head (run time, rpm, speed, coolant):")
print(d[["ENGINE_RUN_TINE", "ENGINE_RPM", "VEHICLE_SPEED", "COOLANT_TEMPERATURE"]].iloc[::40].head(12).to_string())
rt = d["ENGINE_RUN_TINE"].to_numpy()
print("run-time unique values:", len(np.unique(rt)), "rows:", len(rt))

allx = pd.concat(frames, ignore_index=True)
on = allx[allx["ENGINE_RPM"] > 500]
cols = ["ENGINE_RPM", "VEHICLE_SPEED", "COOLANT_TEMPERATURE", "LONG_TERM_FUEL_TRIM_BANK_1",
        "SHORT_TERM_FUEL_TRIM_BANK_1", "INTAKE_MANIFOLD_PRESSURE", "CONTROL_MODULE_VOLTAGE", "TIMING_ADVANCE",
        "ENGINE_LOAD", "INTAKE_AIR_TEMP", "CATALYST_TEMPERATURE_BANK1_SENSOR1"]
print("\nrunning rows:", len(on))
print(on[cols].describe().T[["mean", "std", "min", "max"]].round(2).to_string())
