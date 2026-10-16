"""Accelerometer-recording analysis: CSV validation, preprocessing, signatures, optional classification.

Pure Python (no FastAPI). Reuses autopulse.signatures for the spectrum (Hann, amplitude-corrected),
envelope spectrum, engine orders and STFT, so uploaded recordings go through the same DSP as the
simulated ones. Nothing here invents a sampling rate or a unit.
"""
import io
import json
from pathlib import Path

import numpy as np
import pandas as pd
from scipy import signal, stats

from autopulse.signatures import ORDERS, bandpass, envelope_spectrum, order_amplitudes, spectrum, stft_power

MAX_BYTES = 25 * 1024 * 1024
MAX_SAMPLES = 2_000_000
MIN_SAMPLES = 256
MAX_FS = 1_000_000.0
FS_TOLERANCE = 0.02          # timestamp-derived vs supplied sampling rate
IRREGULAR_FRACTION = 0.01    # share of intervals off by >10% before we refuse the recording
UNITS = ("g", "m/s2", "unknown")
TIME_UNITS = {"s": 1.0, "ms": 1e-3, "us": 1e-6}
N_BANDS = 8
MODEL_DIR = Path(__file__).resolve().parents[1] / "models"

TIME_ALIASES = ("timestamp", "time", "t", "time_s", "timestamp_s", "seconds", "time_ms")
AXIS_ALIASES = {
    "accel_x": ("accel_x", "acc_x", "ax", "accelerometer_x", "a_x", "accel_x_g"),
    "accel_y": ("accel_y", "acc_y", "ay", "accelerometer_y", "a_y", "accel_y_g"),
    "accel_z": ("accel_z", "acc_z", "az", "accelerometer_z", "a_z", "accel_z_g"),
}


class VibrationError(ValueError):
    """A problem with the upload or the analysis settings; carries a stable machine code."""

    def __init__(self, code, message, status=422):
        super().__init__(message)
        self.code, self.message, self.status = code, message, status


# ------------------------------------------------------------------ parsing / validation
def parse_csv(raw: bytes, axes=None, sampling_rate_hz=None, time_unit="s"):
    """Validate a CSV and return (channels, fs, meta, warnings).

    channels: {name: float64 array} in the file's own units. Nothing is dropped or interpolated:
    any non-numeric / non-finite sample, non-increasing timestamp or irregular interval is an error.
    """
    if len(raw) > MAX_BYTES:
        raise VibrationError("file_too_large", f"File is {len(raw) / 1e6:.1f} MB; the limit is {MAX_BYTES // 2**20} MB.", 413)
    if not raw.strip():
        raise VibrationError("empty_file", "The file is empty.")
    if time_unit not in TIME_UNITS:
        raise VibrationError("bad_time_unit", f"time_unit must be one of {sorted(TIME_UNITS)}.")
    try:
        df = pd.read_csv(io.BytesIO(raw), dtype=str, skipinitialspace=True)
    except (pd.errors.EmptyDataError, pd.errors.ParserError, UnicodeDecodeError) as e:
        raise VibrationError("unsupported_format", f"Could not read the file as CSV: {e}") from e
    df.columns = [str(c).strip() for c in df.columns]
    if len(df) == 0:
        raise VibrationError("empty_file", "The CSV has a header but no data rows.")
    if len(df) > MAX_SAMPLES:
        raise VibrationError("too_many_samples", f"{len(df):,} samples; the limit is {MAX_SAMPLES:,}.", 413)
    lower = {c.lower(): c for c in df.columns}

    # accelerometer columns: explicit selection wins; otherwise only well-known aliases
    chosen = []
    if axes:
        for a in axes:
            if a.lower() not in lower:
                raise VibrationError("missing_columns", f"Column '{a}' not found. Columns in file: {', '.join(df.columns)}.")
            chosen.append(lower[a.lower()])
    else:
        for canon, aliases in AXIS_ALIASES.items():
            hit = next((lower[a] for a in aliases if a in lower), None)
            if hit:
                chosen.append(hit)
        if not chosen:
            raise VibrationError("missing_columns", "No accelerometer columns found (expected accel_x / accel_y / accel_z "
                                 f"or aliases). Columns in file: {', '.join(df.columns)}. Select the axes explicitly.")
    if len(set(chosen)) != len(chosen):
        raise VibrationError("bad_axes", "The same column was selected more than once.")

    t_col = next((lower[a] for a in TIME_ALIASES if a in lower and lower[a] not in chosen), None)

    def numeric(col):
        v = pd.to_numeric(df[col], errors="coerce")
        bad_text = int(v.isna().sum() - df[col].isna().sum())
        if bad_text:
            raise VibrationError("non_numeric", f"Column '{col}' has {bad_text} non-numeric value(s).")
        n_bad = int((~np.isfinite(v.to_numpy(dtype=float))).sum())
        if n_bad:
            raise VibrationError("non_finite", f"Column '{col}' has {n_bad} empty, NaN or infinite value(s). "
                                 "Rows are not dropped or interpolated automatically; clean the file first.")
        return v.to_numpy(dtype=np.float64)

    channels = {c: numeric(c) for c in chosen}
    n = len(df)
    if n < MIN_SAMPLES:
        raise VibrationError("too_few_samples", f"Only {n} samples; at least {MIN_SAMPLES} are needed for a meaningful spectrum.")

    warnings = []
    fs_ts = None
    if t_col:
        t = numeric(t_col) * TIME_UNITS[time_unit]
        dt = np.diff(t)
        if np.any(dt <= 0):
            raise VibrationError("bad_timestamps", f"Timestamps in '{t_col}' are not strictly increasing "
                                 f"({int((dt <= 0).sum())} duplicate or backwards step(s)).")
        med = float(np.median(dt))
        fs_ts = 1.0 / med
        off = np.abs(dt - med) / med > 0.10
        if off.mean() > IRREGULAR_FRACTION:
            raise VibrationError("irregular_sampling", f"Sampling is irregular: {off.mean():.1%} of intervals deviate >10% from "
                                 f"the median ({med * 1e3:.4g} ms), max gap {dt.max() / med:.1f}x. Resample to a uniform rate first.")
        if off.any():
            warnings.append(f"{int(off.sum())} timestamp interval(s) deviate >10% from the median (max {dt.max() / med:.1f}x); "
                            "the recording is treated as uniformly sampled.")
        if sampling_rate_hz is not None and abs(sampling_rate_hz - fs_ts) / fs_ts > FS_TOLERANCE:
            raise VibrationError("sampling_rate_mismatch", f"Supplied sampling rate {sampling_rate_hz:g} Hz disagrees with the "
                                 f"timestamps ({fs_ts:.6g} Hz). Fix the value or clear the field to use the timestamps.")
    elif sampling_rate_hz is None:
        raise VibrationError("sampling_rate_required", "No timestamp column found, so the sampling frequency (Hz) must be supplied.")

    fs = float(sampling_rate_hz) if sampling_rate_hz is not None else float(fs_ts)
    if not (np.isfinite(fs) and 0 < fs <= MAX_FS):
        raise VibrationError("bad_sampling_rate", f"Sampling frequency must be between 0 and {MAX_FS:g} Hz.")
    meta = {"n_samples": n, "duration_s": n / fs, "sampling_rate_hz": fs,
            "sampling_rate_source": "supplied" if sampling_rate_hz is not None else "timestamps",
            "timestamp_column": t_col, "timestamp_rate_hz": fs_ts}
    return channels, fs, meta, warnings


# ------------------------------------------------------------------ preprocessing
def preprocess(x, fs, detrend="mean", highpass_hz=None, lowpass_hz=None):
    """Optional DC / linear-trend removal and Butterworth filtering. Units are untouched."""
    if detrend not in ("none", "mean", "linear"):
        raise VibrationError("bad_setting", "detrend must be 'none', 'mean' or 'linear'.")
    nyq = fs / 2
    for name, v in (("highpass_hz", highpass_hz), ("lowpass_hz", lowpass_hz)):
        if v is not None and not (0 < v < nyq):
            raise VibrationError("bad_setting", f"{name}={v:g} must be between 0 and the Nyquist frequency ({nyq:g} Hz).")
    if highpass_hz and lowpass_hz and highpass_hz >= lowpass_hz:
        raise VibrationError("bad_setting", "highpass_hz must be below lowpass_hz.")
    y = x.astype(np.float64)
    if detrend == "mean":
        y = y - y.mean()
    elif detrend == "linear":
        y = signal.detrend(y, type="linear")
    if highpass_hz and lowpass_hz:
        y = bandpass(y, fs, (highpass_hz, lowpass_hz))
    elif highpass_hz:
        y = signal.sosfiltfilt(signal.butter(4, highpass_hz, "highpass", fs=fs, output="sos"), y)
    elif lowpass_hz:
        y = signal.sosfiltfilt(signal.butter(4, lowpass_hz, "lowpass", fs=fs, output="sos"), y)
    return y


# ------------------------------------------------------------------ features
def _finite(v):
    v = float(v)
    return v if np.isfinite(v) else None


def time_features(x):
    """Time-domain signature of one channel; ratios that are undefined for a flat signal are None."""
    rms = float(np.sqrt(np.mean(x ** 2)))
    peak = float(np.abs(x).max())
    flat = float(np.std(x)) < 1e-12
    return {
        "mean": _finite(x.mean()), "std": _finite(x.std()), "rms": _finite(rms),
        "min": _finite(x.min()), "max": _finite(x.max()), "peak": _finite(peak),
        "peak_to_peak": _finite(x.max() - x.min()),
        "crest_factor": _finite(peak / rms) if rms > 1e-12 else None,
        "skewness": None if flat else _finite(stats.skew(x)),
        "kurtosis": None if flat else _finite(stats.kurtosis(x)),  # excess kurtosis (normal = 0)
        "zero_crossing_rate": _finite(np.mean(np.abs(np.diff(np.sign(x - x.mean()))) > 0)),
    }


def spectral_features(f, X, fs):
    """Peaks, band power fractions, centroid and bandwidth from a single-sided amplitude spectrum."""
    P = X ** 2
    total = P[1:].sum()
    edges = np.linspace(0, fs / 2, N_BANDS + 1)
    bands = []
    for k, (lo, hi) in enumerate(zip(edges[:-1], edges[1:])):
        m = (f > 0) & (f >= lo) & ((f < hi) if k < N_BANDS - 1 else (f <= hi))
        bands.append({"lo_hz": float(lo), "hi_hz": float(hi), "fraction": _finite(P[m].sum() / total) if total > 0 else None})
    centroid = bandwidth = None
    peaks = []
    if total > 0:
        centroid = float((f[1:] * P[1:]).sum() / total)
        bandwidth = float(np.sqrt((((f[1:] - centroid) ** 2) * P[1:]).sum() / total))
        idx, props = signal.find_peaks(X[1:], prominence=X[1:].max() * 0.05)
        idx = idx[np.argsort(X[1:][idx])[::-1][:8]] + 1
        peaks = [{"frequency_hz": float(f[i]), "amplitude": float(X[i])} for i in idx]
    return {"spectral_centroid_hz": centroid, "spectral_bandwidth_hz": bandwidth,
            "bands": bands, "peaks": peaks, "frequency_resolution_hz": float(f[1] - f[0]) if len(f) > 1 else None}


# ------------------------------------------------------------------ downsampling for the browser
def _peak_decimate(y, n_out):
    """Keep the largest-magnitude sample of each bucket so impulses survive downsampling."""
    if len(y) <= n_out:
        return np.arange(len(y))
    edges = np.linspace(0, len(y), n_out + 1).astype(int)
    return np.array([a + int(np.argmax(np.abs(y[a:b]))) for a, b in zip(edges[:-1], edges[1:]) if b > a])


def _peak_pool_xy(f, X, n_out):
    """Max-pool a spectrum to n_out points, keeping the frequency of each bucket's maximum."""
    if len(f) <= n_out:
        return f, X
    edges = np.linspace(0, len(f), n_out + 1).astype(int)
    idx = np.array([a + int(np.argmax(X[a:b])) for a, b in zip(edges[:-1], edges[1:]) if b > a])
    return f[idx], X[idx]


def _pool(a, axis, n_out, fn):
    if a.shape[axis] <= n_out:
        return a
    edges = np.linspace(0, a.shape[axis], n_out + 1).astype(int)
    parts = [fn(np.take(a, range(lo, hi), axis=axis), axis=axis, keepdims=True) for lo, hi in zip(edges[:-1], edges[1:]) if hi > lo]
    return np.concatenate(parts, axis=axis)


def _r(a, n=5):
    return [None if not np.isfinite(v) else round(float(v), n) for v in np.asarray(a, dtype=float).ravel()]


# ------------------------------------------------------------------ main entry
def analyze(channels, fs, *, detrend="mean", highpass_hz=None, lowpass_hz=None, rpm=None,
            envelope=False, nperseg=1024, overlap=0.5, max_points=2000, spec_shape=(96, 160), detail_channels=None):
    """Run the whole signature pipeline on {name: raw array}. Returns JSON-ready dicts plus the
    flat feature vector used for optional classification. detail_channels limits the (large)
    waveform / spectrum / spectrogram outputs to those channels; features are always computed for all."""
    if rpm is not None and not (0 < rpm < 30000):
        raise VibrationError("bad_setting", "rpm must be between 0 and 30000.")
    if overlap < 0 or overlap >= 1:
        raise VibrationError("bad_setting", "overlap must be in [0, 1).")
    warnings = []
    processed = {name: preprocess(x, fs, detrend, highpass_hz, lowpass_hz) for name, x in channels.items()}
    if len(processed) > 1:
        mag = np.sqrt(sum(v ** 2 for v in processed.values()))
        processed["magnitude"] = mag
    out = {"features": {}, "waveform": {}, "spectrum": {}, "spectrogram": {}}
    for name, y in processed.items():
        raw_mean = float(channels[name].mean()) if name in channels else None
        feats = time_features(y)
        if raw_mean is not None:
            feats["raw_mean"] = raw_mean
        ys = y - y.mean() if name == "magnitude" else y     # magnitude is >= 0: drop its DC for the spectrum
        f, X = spectrum(ys, fs)
        feats.update(spectral_features(f, X, fs))
        if feats["std"] is not None and feats["std"] < 1e-12:
            warnings.append(f"Channel '{name}' is constant after preprocessing; ratio features are undefined.")
        out["features"][name] = feats
        if detail_channels is not None and name not in detail_channels:
            continue
        idx = _peak_decimate(y, max_points)
        out["waveform"][name] = {"t_s": _r(idx / fs, 6), "y": _r(y[idx], 6)}
        fp, Xp = _peak_pool_xy(f, X, max_points)
        out["spectrum"][name] = {"f_hz": _r(fp, 3), "amplitude": _r(Xp, 8)}
        fS, tS, S, cfg = stft_power(ys, fs, nperseg, overlap)
        Sp = _pool(_pool(S, 0, spec_shape[0], np.mean), 1, spec_shape[1], np.mean)
        fP = _pool(fS[:, None], 0, spec_shape[0], np.mean).ravel()
        tP = _pool(tS[:, None], 0, spec_shape[1], np.mean).ravel()
        out["spectrogram"][name] = {"f_hz": _r(fP, 3), "t_s": _r(tP, 5), "power_db": np.round(Sp, 1).tolist(),
                                    **cfg, "sampling_rate_hz": fs, "unit": "dB re 1 unit^2"}
    first = next(iter(channels))
    out["channels"] = list(channels)
    out["analysis_channels"] = list(processed)

    if envelope:
        lo, hi = 0.25 * fs / 2, 0.9 * fs / 2
        fe, E = envelope_spectrum(processed[first], fs, band=(lo, hi))
        keep_e = fe <= min(500.0, fs / 4)
        out["envelope"] = {"channel": first, "band_hz": [lo, hi], "f_hz": _r(fe[keep_e], 3),
                           "amplitude": _r(E[keep_e], 8)}
    if rpm:
        f1, X1 = spectrum(processed[first], fs)
        f_rev = rpm / 60.0
        res = f1[1] - f1[0]
        keep_o = [(o, a) for o, a in zip(ORDERS, order_amplitudes(f1, X1, rpm)) if o * f_rev < 0.9 * fs / 2 and o * f_rev > 2 * res]
        out["orders"] = {"channel": first, "rpm": rpm, "orders": [o for o, _ in keep_o],
                         "frequency_hz": [o * f_rev for o, _ in keep_o], "amplitude": _r([a for _, a in keep_o], 8)}
        warnings.append("Order amplitudes assume the engine speed was constant at the supplied RPM for the whole recording.")
    out["warnings"] = warnings
    out["settings"] = {"detrend": detrend, "highpass_hz": highpass_hz, "lowpass_hz": lowpass_hz,
                       "spectrum_window": "hann", "stft": cfg, "frequency_resolution_hz": fs / len(next(iter(channels.values()))),
                       "plot_points_max": max_points}
    return out


def feature_vector_map(features):
    """Flat {channel.feature: value} view of the scalar features, used to assemble model input."""
    flat = {}
    for ch, d in features.items():
        for k, v in d.items():
            if isinstance(v, (int, float)) or v is None:
                flat[f"{ch}.{k}"] = v
        for i, b in enumerate(d.get("bands", [])):
            flat[f"{ch}.band_{i}_fraction"] = b["fraction"]
    return flat


# ------------------------------------------------------------------ classification
def classify(features, fs, model_dir=MODEL_DIR):
    """Run a compatible trained vibration classifier if one is installed; never fabricate a result.

    A compatible model is `vibration_classifier.joblib` plus `vibration_classifier.json` with
    {name, classes, feature_names ("<channel>.<feature>"), sampling_rate_hz (optional), domain, limitations}.
    The AutoPulse engine models (models/svm.joblib etc.) are NOT compatible: they were trained on
    24 kHz simulated engine-noise windows and need an RPM, so they are deliberately not used here.
    """
    model_dir = Path(model_dir)
    meta_p, model_p = model_dir / "vibration_classifier.json", model_dir / "vibration_classifier.joblib"
    if not (meta_p.exists() and model_p.exists()):
        return {"status": "unavailable", "label": None, "confidence": None, "probabilities": None, "model": None,
                "reason": "No trained classifier for accelerometer recordings is installed. The existing AutoPulse models "
                          "were trained on simulated 24 kHz engine windows with a known RPM and are not compatible with "
                          "uploaded accelerometer data."}
    try:
        import joblib
        meta = json.loads(meta_p.read_text())
        names, classes = meta["feature_names"], meta["classes"]
        want_fs = meta.get("sampling_rate_hz")
        if want_fs and abs(want_fs - fs) / want_fs > FS_TOLERANCE:
            return {"status": "unavailable", "label": None, "confidence": None, "probabilities": None,
                    "model": _model_info(meta),
                    "reason": f"The installed model expects {want_fs:g} Hz recordings; this one is {fs:g} Hz."}
        flat = feature_vector_map(features)
        missing = [n for n in names if flat.get(n) is None]
        if missing:
            return {"status": "unavailable", "label": None, "confidence": None, "probabilities": None,
                    "model": _model_info(meta),
                    "reason": f"Model input features not available for this recording: {', '.join(missing[:5])}."}
        proba = joblib.load(model_p).predict_proba(np.array([[flat[n] for n in names]], dtype=float))[0]
        k = int(np.argmax(proba))
        return {"status": "available", "label": classes[k], "confidence": float(proba[k]),
                "probabilities": {c: float(p) for c, p in zip(classes, proba)}, "model": _model_info(meta), "reason": None}
    except Exception as e:  # noqa: BLE001 - surface any loading/inference failure as status=error
        return {"status": "error", "label": None, "confidence": None, "probabilities": None, "model": None,
                "reason": f"Classifier failed: {type(e).__name__}: {e}"}


def _model_info(meta):
    return {k: meta.get(k) for k in ("name", "classes", "domain", "limitations", "sampling_rate_hz", "trained_on")}
