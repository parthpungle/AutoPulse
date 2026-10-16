"""Render an HTML file to PDF with headless Edge, then rasterise pages for review.

    python render.py src/report.html out/NavPort-DevOps-Report.pdf [--png PAGES]

PAGES is a comma list like 1,2,5 or "all"; PNGs land next to the PDF in png/.
Run with PYTHONPATH pointing at pypdfium2 (the scratch rtools folder).
"""

import argparse
import shutil
import subprocess
import sys
import tempfile
from pathlib import Path

EDGE = r"C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe"


def render(html: Path, pdf: Path) -> None:
    # Absolute: Edge resolves a relative --print-to-pdf path against its own
    # install folder, not this process's working directory.
    pdf = pdf.resolve()
    pdf.parent.mkdir(parents=True, exist_ok=True)
    if pdf.exists():
        pdf.unlink()
    # A throwaway profile, so this never attaches to (or disturbs) an Edge
    # window that is already open.
    profile = tempfile.mkdtemp(prefix="edge-print-")
    try:
        subprocess.run([
            EDGE, "--headless=new", "--disable-gpu", "--no-first-run",
            "--no-default-browser-check", f"--user-data-dir={profile}",
            "--allow-file-access-from-files", "--no-pdf-header-footer",
            "--virtual-time-budget=8000", "--run-all-compositor-stages-before-draw",
            f"--print-to-pdf={pdf}", html.resolve().as_uri(),
        ], check=True, timeout=180, capture_output=True)
    finally:
        shutil.rmtree(profile, ignore_errors=True)
    if not pdf.exists():
        sys.exit("Edge produced no PDF")


def rasterise(pdf: Path, pages: str, scale: float = 1.3) -> None:
    import pypdfium2 as pdfium

    doc = pdfium.PdfDocument(str(pdf))
    wanted = range(len(doc)) if pages == "all" else [int(p) - 1 for p in pages.split(",")]
    out = pdf.parent / "png"
    out.mkdir(exist_ok=True)
    for i in wanted:
        doc[i].render(scale=scale).to_pil().save(out / f"page-{i + 1:02d}.png")
    print(f"{len(doc)} pages; rendered {len(list(wanted))} to {out}")


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("html", type=Path)
    ap.add_argument("pdf", type=Path)
    ap.add_argument("--png", default="")
    ap.add_argument("--scale", type=float, default=1.3)
    a = ap.parse_args()
    render(a.html, a.pdf)
    print(f"wrote {a.pdf} ({a.pdf.stat().st_size / 1024:.0f} KB)")
    if a.png:
        rasterise(a.pdf, a.png, a.scale)
