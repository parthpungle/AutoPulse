"""Shared paths and skip markers. The suite needs no downloads: tests that use trained models or real data skip
themselves when those files are missing."""
import sys
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

MODELS = ROOT / "models"
needs_sim_models = pytest.mark.skipif(not (MODELS / "svm.joblib").exists(), reason="run train.py first")
needs_real_models = pytest.mark.skipif(not (MODELS / "real_audio" / "meta.json").exists(),
                                       reason="run train_real.py first")
needs_raw_data = pytest.mark.skipif(not (ROOT / "data" / "raw").exists(), reason="no data/raw (scripts/download_data.py)")
