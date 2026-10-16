"""Full-size screenshots of the React UI for review (headless Edge with software WebGL).

    .venv\\Scripts\\python scripts\\checks\\ui_shot.py out_dir "page=garage&car=suv" [...]
"""
import os
import shutil
import subprocess
import sys
import tempfile
from pathlib import Path

EDGE = r"C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe"
out = Path(sys.argv[1])
out.mkdir(parents=True, exist_ok=True)
for q in sys.argv[2:]:
    base = os.environ.get("UI_BASE", "http://localhost:5173")
    url = f"{base}{q}" if q.startswith("/") else f"{base}/?{q}"
    name = os.environ.get("WIN", "1440,900").replace(",", "x") + "_" + q.strip("/").replace("=", "-").replace("&", "_").replace("/", "_").replace("?", "_") + ".png"
    prof = tempfile.mkdtemp(prefix="edge-ui-")
    try:
        subprocess.run([EDGE, "--headless=new", "--use-angle=swiftshader", "--enable-unsafe-swiftshader",
                        "--ignore-gpu-blocklist", "--no-first-run", "--no-default-browser-check", f"--user-data-dir={prof}",
                        f"--window-size={os.environ.get('WIN', '1440,900')}", "--virtual-time-budget=20000",
                        f"--screenshot={(out / name).resolve()}", url],
                       check=True, timeout=120, capture_output=True)
    finally:
        shutil.rmtree(prof, ignore_errors=True)
    print("wrote", out / name)
