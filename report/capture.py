"""Capture dashboard screenshots for the report with headless Edge (dashboard must be running on :8501)."""
import shutil
import subprocess
import tempfile
from pathlib import Path

EDGE = r"C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe"
OUT = Path(__file__).parent / "src" / "img"
SHOTS = {
    "dash-startup.png": ("view=startup&engine=misfire", "1440,720"),
    "dash-signature.png": ("view=signature&engine=knock", "1440,1360"),
    "dash-drive.png": ("view=drive&obd=coolant_leak&t=440", "1440,820"),
}

for name, (query, size) in SHOTS.items():
    profile = tempfile.mkdtemp(prefix="edge-shot-")
    try:
        subprocess.run([
            EDGE, "--headless=new", "--disable-gpu", "--no-first-run", "--no-default-browser-check",
            f"--user-data-dir={profile}", "--hide-scrollbars", f"--window-size={size}",
            "--virtual-time-budget=45000", f"--screenshot={(OUT / name).resolve()}",
            f"http://localhost:8501/?{query}",
        ], check=True, timeout=120, capture_output=True)
    finally:
        shutil.rmtree(profile, ignore_errors=True)
    # drop the sidebar (scenario controls) so the figure shows the product screen itself
    from PIL import Image
    img = Image.open(OUT / name)
    img.crop((330, 40, img.width - 50, img.height)).save(OUT / name)
    print("wrote", name, (OUT / name).stat().st_size // 1024, "KB")
