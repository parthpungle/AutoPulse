"""Download the free, no-login public datasets into data/raw/<name>/ (skips files already present).

    .venv\\Scripts\\python scripts\\download_data.py [carobd engine_condition engine_audio cwru]

Sources (all public, no account needed):
  carobd           github.com/eron93br/carOBD      real 1 Hz OBD-II logs, Toyota Etios
  engine_condition huggingface dhani10/engine-condition-dataset   19.5k labelled telemetry rows
  engine_audio     huggingface RashmiKarunarathne/MyDataSet       real engine WAVs: healthy/misfire/tappet/belt
  cwru             engineering.case.edu bearing data center       12 kHz drive-end vibration, normal + faults
Datasets behind a login (UFPB acoustic on IEEE DataPort, ...) are deliberately not here.
"""
import json
import sys
import urllib.request
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

RAW = Path(__file__).resolve().parents[1] / "data" / "raw"
UA = {"User-Agent": "AutoPulse-research/0.1"}

# CWRU 12 kHz drive-end files: normal + inner race / ball / outer race (@6:00) at 0.007" and 0.021", loads 0-3 HP
CWRU = {
    "normal": [97, 98, 99, 100],
    "inner_007": [105, 106, 107, 108], "ball_007": [118, 119, 120, 121], "outer_007": [130, 131, 132, 133],
    "inner_021": [209, 210, 211, 212], "ball_021": [222, 223, 224, 225], "outer_021": [234, 235, 236, 237],
}


def fetch(url, dest):
    if dest.exists() and dest.stat().st_size > 0:
        return "skip"
    dest.parent.mkdir(parents=True, exist_ok=True)
    tmp = dest.with_suffix(dest.suffix + ".part")
    with urllib.request.urlopen(urllib.request.Request(url, headers=UA), timeout=120) as r, open(tmp, "wb") as f:
        while chunk := r.read(1 << 16):
            f.write(chunk)
    tmp.replace(dest)
    return "ok"


def api(url):
    with urllib.request.urlopen(urllib.request.Request(url, headers=UA), timeout=60) as r:
        return json.loads(r.read())


def jobs_carobd():
    tree = api("https://api.github.com/repos/eron93br/carOBD/git/trees/master?recursive=1")["tree"]
    for t in tree:
        if t["path"].startswith("obdiidata/") and t["path"].endswith(".csv"):
            yield (f"https://raw.githubusercontent.com/eron93br/carOBD/master/{t['path']}",
                   RAW / "carobd" / Path(t["path"]).name)
    yield ("https://raw.githubusercontent.com/eron93br/carOBD/master/README.md", RAW / "carobd" / "README.md")


def jobs_engine_condition():
    base = "https://huggingface.co/datasets/dhani10/engine-condition-dataset/resolve/main"
    for f in ("data/engine_data.csv", "README.md"):
        yield f"{base}/{f}", RAW / "engine_condition" / Path(f).name


def jobs_engine_audio():
    info = api("https://huggingface.co/api/datasets/RashmiKarunarathne/MyDataSet")
    base = "https://huggingface.co/datasets/RashmiKarunarathne/MyDataSet/resolve/main"
    for s in info["siblings"]:
        if s["rfilename"].endswith(".wav"):
            yield f"{base}/{s['rfilename']}", RAW / "engine_audio" / Path(s["rfilename"]).name


def jobs_cwru():
    for label, nums in CWRU.items():
        for load, n in enumerate(nums):
            yield (f"https://engineering.case.edu/sites/default/files/{n}.mat",
                   RAW / "cwru" / f"{label}_load{load}_{n}.mat")


SOURCES = {"carobd": jobs_carobd, "engine_condition": jobs_engine_condition,
           "engine_audio": jobs_engine_audio, "cwru": jobs_cwru}

if __name__ == "__main__":
    names = sys.argv[1:] or list(SOURCES)
    for name in names:
        jobs = list(SOURCES[name]())
        with ThreadPoolExecutor(8) as pool:
            results = list(pool.map(lambda j: fetch(*j), jobs))
        size = sum(p.stat().st_size for p in (RAW / name).glob("*") if p.is_file()) / 1e6
        print(f"{name:17s} {results.count('ok'):4d} downloaded, {results.count('skip'):4d} already present, "
              f"{size:7.1f} MB in data/raw/{name}")
