"""Write the deterministic SYNTHETIC 3-axis accelerometer sample used to try Insights -> Vibration Analysis.

    .venv\Scripts\python scripts/make_vibration_sample.py

Not a real engine recording and not evidence of diagnostic accuracy: 2 kHz sampling, 2 s, seed 0.
Components: 25 Hz (1x of ~1500 rpm) + 50 Hz and 100 Hz harmonics, a 400 Hz tone on x, gravity on z, white noise.
"""
from pathlib import Path

import numpy as np

FS, DUR = 2000, 2.0
OUT = Path(__file__).resolve().parents[1] / "data" / "samples" / "synthetic_accel_3axis.csv"

t = np.arange(int(FS * DUR)) / FS
rng = np.random.default_rng(0)
tone = lambda f, a: a * np.sin(2 * np.pi * f * t)  # noqa: E731
x = tone(25, 0.30) + tone(50, 0.12) + tone(400, 0.05) + rng.normal(0, 0.02, t.size)
y = tone(25, 0.18) + tone(100, 0.08) + rng.normal(0, 0.02, t.size)
z = 1.0 + tone(25, 0.10) + tone(50, 0.20) + rng.normal(0, 0.02, t.size)   # +1 g gravity offset
OUT.parent.mkdir(parents=True, exist_ok=True)
with open(OUT, "w", newline="\n") as fh:
    fh.write("timestamp,accel_x,accel_y,accel_z\n")
    for row in zip(t, x, y, z):
        fh.write(f"{row[0]:.4f},{row[1]:.5f},{row[2]:.5f},{row[3]:.5f}\n")
print(f"wrote {OUT} ({t.size} rows)")

# the dashboard's "Use sample recording" button fetches this copy
PUBLIC = Path(__file__).resolve().parents[1] / "frontend" / "public" / "samples" / OUT.name
PUBLIC.parent.mkdir(parents=True, exist_ok=True)
PUBLIC.write_bytes(OUT.read_bytes())
