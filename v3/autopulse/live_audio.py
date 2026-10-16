"""Live microphone audio: validation, preprocessing and inference with the real-engine-audio model.

Same chain as the real-data evaluation (realdata.load_engine_audio -> evaluate_real.eval_audio):
mono -> resample_poly to 24 kHz -> z-score -> 1 s window -> estimate_rpm -> signatures.features.
One difference, on purpose: a live stream has no "recording" to normalise over, so each window is
z-scored on its own. train_live_audio.py trains the saved model with that same per-window step, so
training and live inference see identical inputs.

A prediction is only reported when the window passes two gates:
  quality  - not silent, not too quiet, not clipped, finite samples
  novelty  - its signature resembles the real engine recordings the model was trained on
Passing both does not make it a validated diagnosis: the training set is 321 phone recordings.
"""
import time
from dataclasses import dataclass, field
from pathlib import Path

import numpy as np
from scipy.signal import resample_poly

from .realdata import estimate_rpm
from .signatures import FEATURE_NAMES, features, stft_image

ARTIFACT = Path(__file__).resolve().parents[1] / "models" / "live_audio.joblib"
ARTIFACT_VERSION = 2
MODEL_FS = 24000          # rate the real-audio pipeline resamples to (realdata.load_engine_audio)
WINDOW_S = 1.0            # window length used in training
MIN_FS, MAX_FS = 8000, 192000
MAX_INPUT_S = 4.0         # longest payload accepted; only the last WINDOW_S is analysed
QUIET_DBFS = -50.0        # RMS below this is mostly microphone self-noise
CLIP_LEVEL = 0.999        # |sample| at or above this counts as clipped (float input in [-1, 1])
CLIP_FRAC = 0.001         # more than 0.1% clipped samples -> clipped window
EVIDENCE = ["spectral_centroid_khz", "spectral_flatness", "kurtosis", "crest_factor",
            "zero_cross_rate", "env_peak_prominence"]
BAND_FEATURES = [n for n in FEATURE_NAMES if n.startswith("band_")]


class AudioInputError(ValueError):
    """The submitted samples cannot be analysed (empty, non-finite, wrong rate, too short...)."""


class ModelUnavailable(RuntimeError):
    """No compatible trained live-audio model on disk."""


class InvalidModelOutput(RuntimeError):
    """The model returned something that is not a probability vector over its classes."""


@dataclass
class Prepared:
    signal: np.ndarray            # MODEL_FS, WINDOW_S long, z-scored
    fs: int
    quality: dict
    fs_in: int
    n_in: int
    timings: dict = field(default_factory=dict)


# ------------------------------------------------------------------ preprocessing
def to_mono(x):
    """1-D passes through; (n_samples, n_channels) is averaged across channels, as in load_engine_audio."""
    x = np.asarray(x, dtype=np.float64)
    if x.ndim == 1:
        return x
    if x.ndim == 2:
        return x.mean(axis=1)
    raise AudioInputError(f"expected 1-D or (samples, channels) audio, got shape {x.shape}")


def resample(x, fs_in, fs_out=MODEL_FS):
    return x if fs_in == fs_out else resample_poly(x, fs_out, fs_in)


def normalize(x):
    """Zero mean, unit variance: the formula load_engine_audio applies, here per window."""
    return (x - x.mean()) / (x.std() + 1e-9)


def quality(x):
    """Level checks on the raw window (float samples, full scale = 1.0), before any normalisation."""
    rms = float(np.sqrt(np.mean(x ** 2)))
    peak = float(np.abs(x).max())
    clip_frac = float(np.mean(np.abs(x) >= CLIP_LEVEL))
    rms_dbfs = float(20 * np.log10(rms + 1e-12))
    warnings = []
    if np.std(x) < 1e-7:
        status = "silent"
        warnings.append("No signal: the microphone is delivering silence (muted or disconnected?).")
    elif clip_frac > CLIP_FRAC:
        status = "clipped"
        warnings.append(f"{clip_frac:.1%} of samples are clipped; move the microphone away or lower the input gain.")
    elif rms_dbfs < QUIET_DBFS:
        status = "quiet"
        warnings.append(f"Input level {rms_dbfs:.0f} dBFS is too quiet to analyse (needs > {QUIET_DBFS:.0f} dBFS).")
    else:
        status = "ok"
    return {"status": status, "rms_dbfs": rms_dbfs, "peak": peak, "clip_fraction": clip_frac,
            "dc_offset": float(x.mean()), "warnings": warnings}


def split_windows(x, fs, window_s=WINDOW_S, hop_s=0.5):
    """Fixed-length windows (same stepping as load_engine_audio); a tail shorter than a window is dropped."""
    if window_s <= 0 or hop_s <= 0:
        raise ValueError("window_s and hop_s must be positive")
    n, hop = int(round(window_s * fs)), int(round(hop_s * fs))
    return [x[s:s + n] for s in range(0, len(x) - n + 1, hop)]


def prepare_window(samples, fs_in):
    """Validate one capture and turn its last WINDOW_S into the model's input."""
    t0 = time.perf_counter()
    try:
        whole = not isinstance(fs_in, bool) and float(fs_in).is_integer()
    except (TypeError, ValueError):
        whole = False
    if not whole:
        raise AudioInputError(f"sample rate must be a whole number of Hz, got {fs_in!r}")
    fs_in = int(fs_in)
    if not MIN_FS <= fs_in <= MAX_FS:
        raise AudioInputError(f"sample rate {fs_in} Hz outside {MIN_FS}-{MAX_FS} Hz")
    x = to_mono(samples)
    if x.size == 0:
        raise AudioInputError("empty audio")
    if not np.all(np.isfinite(x)):
        raise AudioInputError("audio contains NaN or infinite samples")
    if x.size > MAX_INPUT_S * fs_in:
        raise AudioInputError(f"audio longer than {MAX_INPUT_S:.0f} s")
    n_in = int(round(WINDOW_S * fs_in))
    if x.size < n_in:
        raise AudioInputError(f"need {WINDOW_S:.1f} s of audio ({n_in} samples at {fs_in} Hz), got {x.size}")
    x = x[-n_in:]
    q = quality(x)
    y = resample(x, fs_in)
    n = int(WINDOW_S * MODEL_FS)
    y = y[:n] if len(y) >= n else np.pad(y, (0, n - len(y)))  # resampling can land one sample off
    return Prepared(normalize(y), MODEL_FS, q, fs_in, int(x.size),
                    {"preprocess_ms": (time.perf_counter() - t0) * 1000})


LOG_RMS = FEATURE_NAMES.index("log_rms")


def featurize(signal, fs=MODEL_FS):
    """Signature vector as in evaluate_real.eval_audio (rpm estimated from sound, no crank speed), for a
    per-window z-scored signal. Its log_rms is 0 by construction; what remains is float rounding noise
    (~1e-11 for float32 input, ~1e-9 for float64) that a StandardScaler would blow up, so it is pinned to 0."""
    rpm = estimate_rpm(signal, fs)
    x = features(signal, fs, rpm)
    x[LOG_RMS] = 0.0
    if x.shape != (len(FEATURE_NAMES),):
        raise AudioInputError(f"feature vector has shape {x.shape}, expected ({len(FEATURE_NAMES)},)")
    if not np.all(np.isfinite(x)):
        raise AudioInputError("feature extraction produced non-finite values")
    return x, rpm


# ------------------------------------------------------------------ model
def check_proba(p, n_classes):
    p = np.asarray(p, dtype=np.float64).ravel()
    if p.shape != (n_classes,):
        raise InvalidModelOutput(f"model returned {p.shape[0]} scores for {n_classes} classes")
    if not np.all(np.isfinite(p)) or np.any(p < -1e-6) or np.any(p > 1 + 1e-6) or abs(p.sum() - 1) > 1e-3:
        raise InvalidModelOutput("model scores are not a probability vector")
    return np.clip(p, 0, 1)


class LiveAudioModel:
    """The bundle written by train_live_audio.py, loaded once and validated against this pipeline."""

    REQUIRED = ("version", "model", "classes", "feature_names", "fs", "window_s", "normalization",
                "novelty", "novelty_threshold", "metrics", "dataset")

    def __init__(self, bundle):
        missing = [k for k in self.REQUIRED if k not in bundle]
        if missing:
            raise ModelUnavailable(f"model file is missing {missing}")
        if bundle["version"] != ARTIFACT_VERSION:
            raise ModelUnavailable(f"model file version {bundle['version']}, this code expects {ARTIFACT_VERSION}")
        if list(bundle["feature_names"]) != FEATURE_NAMES:
            raise ModelUnavailable("model was trained on a different feature set; re-run train_live_audio.py")
        if bundle["fs"] != MODEL_FS or bundle["window_s"] != WINDOW_S or bundle["normalization"] != "per_window":
            raise ModelUnavailable("model preprocessing (rate / window / normalisation) differs from the live pipeline")
        self.b = bundle
        self.model = bundle["model"]
        self.classes = list(bundle["classes"])

    @classmethod
    def load(cls, path=ARTIFACT):
        path = Path(path)
        if not path.exists():
            raise ModelUnavailable(f"{path.name} not found; train it with `python train_live_audio.py` "
                                   "(needs `python scripts/download_data.py engine_audio`)")
        import joblib
        try:
            bundle = joblib.load(path)
        except Exception as e:  # corrupt file or incompatible library versions
            raise ModelUnavailable(f"could not load {path.name}: {type(e).__name__}") from e
        if not isinstance(bundle, dict):
            raise ModelUnavailable(f"{path.name} is not a live-audio model bundle")
        return cls(bundle)

    def info(self):
        b = self.b
        return {"model_name": b.get("model_name"), "classes": self.classes, "fs": b["fs"], "window_s": b["window_s"],
                "dataset": b["dataset"], "metrics": b["metrics"], "trained_at": b.get("trained_at"),
                "normalization": b["normalization"]}

    def proba(self, x):
        return check_proba(self.model.predict_proba(x[None])[0], len(self.classes))

    def novelty_score(self, x):
        """Higher = more like the training engine recordings (IsolationForest score_samples)."""
        return float(self.b["novelty"].score_samples(x[None])[0])

    def analyze(self, samples, fs_in):
        prep = prepare_window(samples, fs_in)
        return analyze_prepared(prep, self)


def analyze_prepared(prep, model=None):
    """Features, spectrogram and (when both gates pass) the model's scores for one prepared window."""
    timings = dict(prep.timings)
    t = time.perf_counter()
    x, rpm = featurize(prep.signal, prep.fs)
    f, tt, S = stft_image(prep.signal, prep.fs)
    timings["features_ms"] = (time.perf_counter() - t) * 1000
    named = dict(zip(FEATURE_NAMES, x.tolist()))
    out = {
        "quality": prep.quality,
        "input": {"sample_rate": prep.fs_in, "samples": prep.n_in, "model_rate": prep.fs},
        "evidence": {"features": {k: named[k] for k in EVIDENCE},
                     "bands": [{"name": k.removeprefix("band_").replace("_", "–") + " Hz", "log_rel_power": named[k]}
                               for k in BAND_FEATURES],
                     "envelope_rate_hz": rpm / 30.0,
                     "rpm_if_4cyl_4stroke": rpm},
        "spectrogram": {"f": np.round(f, 0).tolist(), "t": np.round(tt, 3).tolist(), "z": np.round(S, 1).tolist()},
        "prediction": None,
    }
    if model is None:
        out["prediction_status"] = {"code": "no_model", "message": "Live microphone capture is active, but a compatible trained model is unavailable."}
    elif prep.quality["status"] != "ok":
        out["prediction_status"] = {"code": "bad_quality", "message": "Prediction withheld: " + " ".join(prep.quality["warnings"])}
    else:
        t = time.perf_counter()
        nov = model.novelty_score(x)
        thr = float(model.b["novelty_threshold"])
        p = model.proba(x)
        timings["inference_ms"] = (time.perf_counter() - t) * 1000
        out["novelty"] = {"score": nov, "threshold": thr, "in_distribution": nov >= thr}
        if nov < thr:
            out["prediction_status"] = {
                "code": "out_of_distribution",
                "message": "Prediction withheld: this sound does not resemble the engine recordings the model was "
                           "trained on (voice, music, fans and room noise usually land here)."}
        else:
            k = int(p.argmax())
            out["prediction"] = {"label": model.classes[k], "score": float(p[k]),
                                 "scores": dict(zip(model.classes, np.round(p, 4).tolist()))}
            out["prediction_status"] = {
                "code": "ok",
                "message": "Model output for an engine-like sound. Not a validated diagnosis: the model was trained "
                           "on 321 phone recordings and has not been validated on this microphone or vehicle."}
    timings["total_ms"] = sum(v for k, v in timings.items() if k != "total_ms")
    out["timings"] = {k: round(v, 2) for k, v in timings.items()}
    return out
