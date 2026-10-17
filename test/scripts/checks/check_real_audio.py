"""Sanity check for the real-audio path: hold out 3 recordings (3 different classes), retrain every model without
them, then classify the held-out WAV files from disk with classify_clip(), as the dashboard would.

    .venv\\Scripts\\python scripts\\checks\\check_real_audio.py

Needs data/raw/engine_audio. Saves nothing; models/real_audio is untouched.
"""
import json
import sys
from pathlib import Path

import numpy as np
from scipy.io import wavfile

sys.path.insert(0, str(Path(__file__).resolve().parents[2]))
from autopulse import real_audio  # noqa: E402
from autopulse.realdata import RAW, load_engine_audio  # noqa: E402

# 3 recordings, one each from 3 of the 4 classes; these are the dashboard's sample clips (frontend/public/samples)
HOLD_CLASSES = ["healthy", "misfire", "belt_squeal"]

if __name__ == "__main__":
    wins = load_engine_audio()
    rng = np.random.default_rng(0)
    held = [rng.choice(sorted({w["clip"] for w in wins if w["label"] == c})) for c in HOLD_CLASSES]
    train = [w for w in wins if w["clip"] not in held]
    y = np.array([real_audio.CLASSES.index(w["label"]) for w in train])
    _, X, S = real_audio.window_features([w["signal"] for w in train])
    print(f"held out {held}; retraining on {len(train)} windows from "
          f"{len({w['clip'] for w in train})} recordings (CNN takes a few minutes) ...")
    models = real_audio.fit_real_models(X, S, y)

    for clip, truth in zip(held, HOLD_CLASSES):
        fs, x = wavfile.read(RAW / "engine_audio" / f"{clip}.wav")
        r = real_audio.classify_clip(x, fs, models=models)
        print(f"\n{clip}  (true: {truth}, file {fs} Hz, {len(x) / fs:.1f} s)")
        print(f"  verdict {r['verdict']}  confidence {r['confidence']:.3f}  rpm_est {r['rpm_est']:.0f}  "
              f"windows {r['n_windows']} kept, {r['n_dropped']} dropped  [{r['source']}]")
        print("  ensemble   ", dict(zip(r["classes"], r["ensemble"])))
        for name, p in r["per_model"].items():
            print(f"  {name:22s}", dict(zip(r["classes"], p)))

    # the silence filter: the same clip with 3 s of digital silence appended should drop those windows only
    fs, x = wavfile.read(RAW / "engine_audio" / f"{held[0]}.wav")
    padded = np.concatenate([x, np.zeros(3 * fs, dtype=x.dtype)])
    r = real_audio.classify_clip(padded, fs, models=models)
    print(f"\nsilence check, {held[0]} + 3 s silence: {r['n_windows']} kept, {r['n_dropped']} dropped, "
          f"verdict {r['verdict']} ({r['confidence']:.3f})")
    print("\nfull output for the first clip (per_window truncated):")
    r = real_audio.classify_clip(x, fs, models=models)
    print(json.dumps({**r, "per_window": r["per_window"][:3] + ["..."]}, indent=1))
