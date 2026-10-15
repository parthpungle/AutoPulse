"""Build the AutoPulse concept report PDF.

    .venv\\Scripts\\python report\\build.py [--png all|1,2,3]

Two passes: the first render finds the page each section starts on (from an
invisible @@sNN@@ marker in each section opener), the second fills those page
numbers into the contents.
"""
import argparse
import json
import re
import shutil
from pathlib import Path

from pypdf import PdfReader

from render import rasterise, render

HERE = Path(__file__).parent
SRC = HERE / "src" / "report.html"
TOC_JS = HERE / "src" / "toc.js"
WORK = HERE / "out" / "report.pdf"
FINAL = HERE / "AutoPulse-Concept-Report.pdf"


def section_pages(pdf: Path) -> dict:
    pages = {}
    for number, page in enumerate(PdfReader(str(pdf)).pages, start=1):
        text = re.sub(r"\s+", "", page.extract_text() or "")
        for key in re.findall(r"@@(s\d\d)@@", text):
            pages.setdefault(key, number)
    return pages


INPUTS = {"SVM (RBF)": "28 signature features", "Softmax regression": "28 signature features",
          "ANN (MLP + softmax)": "28 signature features", "CNN (spectrogram)": "64 × 95 STFT image"}


def write_results() -> None:
    """Model scores come straight from training, never typed by hand."""
    met = json.loads((HERE.parent / "models" / "metrics.json").read_text())
    rows = [{"model": k, "input": INPUTS.get(k, ""), "acc": v["accuracy"], "f1": v["macro_f1"]}
            for k, v in sorted(met["models"].items(), key=lambda kv: -kv[1]["macro_f1"])]
    real_file = HERE.parent / "models" / "real_metrics.json"
    real = json.loads(real_file.read_text()) if real_file.exists() else {}
    for r in real.values():  # confusion matrices are not needed in the report
        for m in r.get("models", {}).values():
            m.pop("confusion", None)
    (HERE / "src" / "results.js").write_text(
        f"window.RESULTS = {json.dumps(rows)};\nwindow.REAL = {json.dumps(real)};\n", encoding="utf-8")


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--png", default="")
    args = ap.parse_args()

    write_results()
    TOC_JS.write_text("window.TOC = {};\n", encoding="utf-8")
    render(SRC, WORK)
    first = section_pages(WORK)

    TOC_JS.write_text(f"window.TOC = {json.dumps(first)};\n", encoding="utf-8")
    render(SRC, WORK)
    second = section_pages(WORK)

    if first != second:
        print("warning: section pages moved between passes", first, second)
    pages = len(PdfReader(str(WORK)).pages)
    print(f"{pages} pages; sections start on {second}")

    shutil.copyfile(WORK, FINAL)
    print(f"wrote {FINAL.name} ({FINAL.stat().st_size / 1024 / 1024:.1f} MB)")
    if args.png:
        rasterise(WORK, args.png)


if __name__ == "__main__":
    main()
