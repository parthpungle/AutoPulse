"""Signature extraction: time, frequency (FFT), order, envelope and time-frequency (STFT)."""
import numpy as np
from scipy import signal, stats

BANDS = [(20, 200), (200, 500), (500, 1000), (1000, 2000), (2000, 3000), (3000, 4000),
         (4000, 5000), (5000, 6000), (6000, 7500), (7500, 10000)]
ORDERS = [0.5, 1.0, 1.5, 2.0, 3.0, 4.0]
KNOCK_BAND = (5500, 8000)
EPS = 1e-9


def spectrum(x, fs):
    """Single-sided amplitude spectrum with a Hann window."""
    w = np.hanning(len(x))
    X = np.abs(np.fft.rfft(x * w)) * 2 / np.sum(w)
    return np.fft.rfftfreq(len(x), 1 / fs), X


def order_amplitudes(f, X, rpm):
    """Spectrum amplitude at multiples of crank rotation (engine orders)."""
    f_rev = rpm / 60.0
    out = []
    for o in ORDERS:
        i = int(np.argmin(np.abs(f - o * f_rev)))
        out.append(X[max(i - 1, 0):i + 2].max())
    return np.array(out)


def bandpass(x, fs, band, order=4):
    """Band-pass, clipped to what the sample rate can represent (real recordings vary: 12-48 kHz)."""
    lo, hi = band[0], min(band[1], 0.45 * fs)
    if lo >= hi:
        return np.zeros_like(x)
    sos = signal.butter(order, (lo, hi), "bandpass", fs=fs, output="sos")
    return signal.sosfiltfilt(sos, x)


def envelope_spectrum(x, fs, band=(2000, 7500)):
    """Hilbert envelope spectrum: reveals repetition rate of impacts (bearings, tappets)."""
    env = np.abs(signal.hilbert(bandpass(x, fs, band)))
    env -= env.mean()
    return spectrum(env, fs)


def stft_image(x, fs, n_freq=64):
    """Log-power STFT spectrogram, pooled to n_freq bins (CNN input)."""
    f, t, Z = signal.stft(x, fs, nperseg=512, noverlap=256)
    S = np.log10(np.abs(Z[:256]) ** 2 + 1e-10)
    pool = 256 // n_freq
    return f[:256].reshape(n_freq, pool).mean(1), t, S.reshape(n_freq, pool, -1).mean(1)


def stft_power(x, fs, nperseg=1024, overlap=0.5):
    """Generic STFT power in dB (Hann window, unpooled) for arbitrary-rate recordings.
    Returns frequency bins (Hz), time bins (s), power (dB re 1 unit^2) and the settings used."""
    nperseg = int(min(nperseg, len(x)))
    noverlap = int(nperseg * overlap)
    f, t, Z = signal.stft(x, fs, nperseg=nperseg, noverlap=noverlap, boundary=None, padded=False)
    return f, t, 10 * np.log10(np.abs(Z) ** 2 + 1e-12), {"nperseg": nperseg, "noverlap": noverlap, "window": "hann"}


FEATURE_NAMES = (
    ["log_rms", "crest_factor", "kurtosis", "skewness", "zero_cross_rate"]
    + [f"band_{lo}_{hi}" for lo, hi in BANDS]
    + [f"order_{o}" for o in ORDERS]
    + ["spectral_centroid_khz", "spectral_flatness",
       "env_peak_order", "env_peak_prominence", "knock_band_kurtosis",
       "crank_irregularity", "crank_min_dip"]
)


def features(x, fs, rpm, crank_speed=None):
    """Hand-crafted signature vector (for SVM / ANN / Softmax and the adaptive baseline)."""
    x = np.asarray(x, dtype=np.float64)
    rms = np.sqrt(np.mean(x ** 2)) + EPS
    f, X = spectrum(x, fs)
    P = X ** 2
    total = P.sum() + EPS

    bands = [np.log10(P[(f >= lo) & (f < hi)].sum() / total + EPS) for lo, hi in BANDS]
    orders = np.log10(order_amplitudes(f, X, rpm) / rms + EPS)
    centroid = (f * P).sum() / total / 1000
    flatness = np.exp(np.mean(np.log(P[1:] + EPS))) / (np.mean(P[1:]) + EPS)

    fe, E = envelope_spectrum(x, fs)
    sel = (fe > 3) & (fe < 400)
    i = int(np.argmax(E[sel]))
    env_peak_order = fe[sel][i] / (rpm / 60.0)
    env_prom = np.log10(E[sel][i] / (np.median(E[sel]) + EPS) + EPS)

    kb = bandpass(x, fs, KNOCK_BAND)
    knock_kurt = stats.kurtosis(kb) if np.any(kb) else 0.0

    if crank_speed is not None and len(crank_speed) > 2:
        cs = np.asarray(crank_speed)
        irregularity = np.std(cs) / np.mean(cs) * 100
        min_dip = (np.mean(cs) - cs.min()) / np.mean(cs) * 100
    else:
        irregularity = min_dip = 0.0

    flat = np.ptp(x) == 0                                     # constant input (dead sensor): no shape to measure
    vec = [np.log10(rms), np.abs(x).max() / rms,
           0.0 if flat else stats.kurtosis(x), 0.0 if flat else stats.skew(x),
           np.mean(np.abs(np.diff(np.sign(x)))) / 2]
    vec += bands + list(orders)
    vec += [centroid, flatness, env_peak_order, env_prom, knock_kurt, irregularity, min_dip]
    return np.array(vec, dtype=np.float64)


def annotate_peaks(rpm, car=None):
    """Frequencies worth labelling on an FFT plot for this RPM."""
    f_rev = rpm / 60.0
    marks = {
        "0.5x (misfire / cam)": 0.5 * f_rev,
        "1x crank": f_rev,
        "2x firing (I4)": 2 * f_rev,
    }
    if car is not None:
        marks["knock resonance"] = car.knock_freq
    return marks
