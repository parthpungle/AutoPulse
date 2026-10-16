"""Print the shape and key columns of each downloaded dataset (sanity check before loaders)."""
from pathlib import Path

import numpy as np
import pandas as pd
from scipy.io import loadmat, wavfile

RAW = Path(__file__).resolve().parents[2] / "data" / "raw"

ec = RAW / "engine_condition" / "engine_data.csv"
if ec.exists():
    df = pd.read_csv(ec)
    print("engine_condition", df.shape, list(df.columns))
    print(df.describe().T[["mean", "min", "max"]].round(2))
    print(df.iloc[:, -1].value_counts())

files = sorted((RAW / "carobd").glob("*.csv"))
if files:
    groups = {}
    for f in files:
        groups.setdefault("".join(c for c in f.stem if c.isalpha()), []).append(f)
    print("\ncarobd trips per group:", {k: len(v) for k, v in groups.items()})
    d = pd.read_csv(files[0], skipinitialspace=True)
    d = d.loc[:, ~d.columns.str.startswith("Unnamed")]
    d.columns = [c.replace(" ()", "").strip() for c in d.columns]
    print("columns:", list(d.columns))
    lens, run = [], []
    for f in files:
        x = pd.read_csv(f, skipinitialspace=True)
        x.columns = [c.replace(" ()", "").strip() for c in x.columns]
        lens.append(len(x))
        run.append(x["ENGINE_RUN_TINE"].diff().median())
    print(f"rows per trip: min {min(lens)}, median {int(np.median(lens))}, max {max(lens)}; "
          f"median run-time step {np.median(run):.2f} s")
    x = pd.concat([pd.read_csv(f, skipinitialspace=True) for f in files[:40]])
    x.columns = [c.replace(" ()", "").strip() for c in x.columns]
    on = x[x["ENGINE_RPM"] > 500]
    print(on[["ENGINE_RPM", "VEHICLE_SPEED", "COOLANT_TEMPERATURE", "LONG_TERM_FUEL_TRIM_BANK_1",
              "SHORT_TERM_FUEL_TRIM_BANK_1", "INTAKE_MANIFOLD_PRESSURE", "CONTROL_MODULE_VOLTAGE",
              "TIMING_ADVANCE"]].describe().T[["mean", "std", "min", "max"]].round(2))

mats = sorted((RAW / "cwru").glob("*.mat"))
if mats:
    m = loadmat(mats[0])
    print("\ncwru", mats[0].name, {k: np.shape(v) for k, v in m.items() if not k.startswith("__")})

wavs = sorted((RAW / "engine_audio").glob("*.wav"))
if wavs:
    for w in wavs[:3] + wavs[-2:]:
        fs, y = wavfile.read(w)
        print("audio", w.name, fs, y.shape, y.dtype, f"{len(y) / fs:.1f}s")
