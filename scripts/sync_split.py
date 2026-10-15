"""Copy the shared vibration-analysis files from the single-laptop app into split/ (a self-contained copy).

    .venv\\Scripts\\python scripts/sync_split.py

Split-only files (split/frontend/src/pages/VibrationTab.jsx, split/backend/*) are not touched.
"""
import shutil
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
FILES = [
    "autopulse/vibration.py", "autopulse/vibsim.py", "autopulse/vibstream.py", "autopulse/vibclassify.py",
    "autopulse/signatures.py",
    "frontend/src/vibStreamState.js", "frontend/src/pages/VibrationLive.jsx", "frontend/src/pages/VibrationAnalysis.jsx",
    "frontend/src/components/charts/Heatmap.jsx", "frontend/tests/vibStreamState.test.js",
    "frontend/public/samples/synthetic_accel_3axis.csv", "data/samples/synthetic_accel_3axis.csv",
]

if __name__ == "__main__":
    for f in FILES:
        dst = ROOT / "split" / f
        dst.parent.mkdir(parents=True, exist_ok=True)
        shutil.copyfile(ROOT / f, dst)
        print("copied", f)
