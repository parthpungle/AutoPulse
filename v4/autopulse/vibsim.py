"""Real-time SIMULATED engine accelerometer: a seeded sample generator and a rolling-window analyzer.

Nothing here is a measurement. The source signal comes from autopulse.generator.synth_window (the
physics-inspired engine simulator the classifiers were trained on); the X/Y/Z channels are
projections of that source with fixed, seeded gains and independent sensor noise. Assumptions:

* the block vibration is one scalar source seen by three axes with gains X=1.0, Y~0.55, Z~0.8 (+-10%),
  not a rigid-body model of real mounting directions;
* every axis adds independent white sensor noise (3% of the source RMS), Z also carries +1 g gravity;
* units are g by assumption; successive 1 s source windows are cross-faded (20 ms, equal power), so
  they are continuous in amplitude but not phase-coherent;
* the source is generated at 24 kHz and anti-alias resampled to the requested rate.
"""
from dataclasses import asdict, dataclass
from math import gcd

import numpy as np
from scipy.signal import resample_poly

from autopulse import vibration
from autopulse.generator import CAR_TYPES, ENGINE_FAULTS, FAULT_LABELS, FS as NATIVE_FS, make_car, synth_window

CHANNELS = ("accel_x", "accel_y", "accel_z")
GAINS = {"accel_x": 1.0, "accel_y": 0.55, "accel_z": 0.8}
XFADE_S = 0.02
CONDITIONS = {"warm": 90.0, "cold": 25.0}     # coolant temperature the engine runs at (cold = noisier)
LIMITS = {"fs": (1000, NATIVE_FS), "rpm": (600, 6000), "severity": (0.0, 1.0), "speed": (0.25, 4.0),
          "window_s": (1.0, 10.0)}
ASSUMPTIONS = ("Simulated signal, not hardware data.", "Axes are seeded projections of one source signal.",
               "Units are g by assumption.", "RPM is constant between settings changes.")


class SettingsError(ValueError):
    def __init__(self, code, message):
        super().__init__(message)
        self.code, self.message = code, message


@dataclass
class Settings:
    fault: str = "healthy"
    severity: float = 0.8
    rpm: float = 1500.0
    condition: str = "warm"
    fs: int = 4000
    speed: float = 1.0
    window_s: float = 4.0
    car_type: str = "sedan"
    seed: int = 0
    envelope: bool = False

    def to_dict(self):
        return asdict(self)


LIVE_KEYS = {"fault", "severity", "rpm", "condition", "speed"}   # may change while a run is in progress


def validate(values, base=None):
    """Return a Settings built from `base` + `values`, or raise SettingsError naming the problem."""
    s = Settings(**asdict(base)) if base else Settings()
    for k, v in (values or {}).items():
        if not hasattr(s, k):
            raise SettingsError("unknown_setting", f"Unknown setting '{k}'.")
        setattr(s, k, v)
    if s.fault not in ENGINE_FAULTS:
        raise SettingsError("bad_fault", f"fault must be one of {ENGINE_FAULTS}.")
    if s.condition not in CONDITIONS:
        raise SettingsError("bad_condition", f"condition must be one of {list(CONDITIONS)}.")
    if s.car_type not in CAR_TYPES:
        raise SettingsError("bad_car", f"car_type must be one of {list(CAR_TYPES)}.")
    for k, (lo, hi) in LIMITS.items():
        v = getattr(s, k)
        if isinstance(v, bool) or not isinstance(v, (int, float)) or not np.isfinite(v) or not lo <= v <= hi:
            raise SettingsError("bad_" + k, f"{k} must be a number between {lo} and {hi}.")
    if not isinstance(s.seed, int) or isinstance(s.seed, bool):
        raise SettingsError("bad_seed", "seed must be an integer.")
    s.fs = int(s.fs)
    return s


class VibrationSimulator:
    """Produces consecutive, gap-free X/Y/Z samples at s.fs; sample i has timestamp i / fs."""

    def __init__(self, settings: Settings):
        self.s = settings
        self.rng = np.random.default_rng(settings.seed)
        self.car = make_car(8, settings.car_type)
        self.fs = settings.fs
        self.n_emitted = 0
        self._fifo = {c: np.zeros(0) for c in CHANNELS}
        self._tail = None                 # last XFADE_S of the previous second, per channel
        self.native = None                # latest raw 24 kHz source window (for the classifier)
        self._xf = int(round(XFADE_S * self.fs))
        self._gain = {c: g * self.rng.uniform(0.9, 1.1) for c, g in GAINS.items()}

    def update(self, s: Settings):
        self.s = s                        # fault / rpm / condition take effect from the next 1 s block

    def _block(self):
        s = self.s
        w = synth_window(s.fault, rpm=s.rpm, car=self.car, severity=s.severity, coolant_c=CONDITIONS[s.condition],
                         misfire_cyl=1, rng=self.rng)
        self.native = w
        src = w["signal"].astype(np.float64)
        if self.fs != NATIVE_FS:
            g = gcd(self.fs, NATIVE_FS)
            src = resample_poly(src, self.fs // g, NATIVE_FS // g)
        rms = float(np.sqrt(np.mean(src ** 2))) + 1e-12
        out = {}
        for c in CHANNELS:
            y = self._gain[c] * src + 0.03 * rms * self.rng.standard_normal(len(src))
            out[c] = y + (1.0 if c == "accel_z" else 0.0)
        return out

    def _extend(self):
        blk = self._block()
        xf = self._xf
        fade = np.linspace(0, np.pi / 2, xf)
        fin, fout = np.sin(fade), np.cos(fade)
        prev, new = self._tail, {}
        for c in CHANNELS:
            y = blk[c]
            head = prev[c] * fout + y[:xf] * fin if prev else y[:xf]
            self._fifo[c] = np.concatenate([self._fifo[c], head, y[xf:-xf]])
            new[c] = y[-xf:]
        self._tail = new

    def read(self, n):
        """Next n samples per channel: (first sample index, {channel: array})."""
        while len(self._fifo[CHANNELS[0]]) < n:
            self._extend()
        i0 = self.n_emitted
        out = {}
        for c in CHANNELS:
            out[c], self._fifo[c] = self._fifo[c][:n], self._fifo[c][n:]
        self.n_emitted += n
        return i0, out


class RollingAnalyzer:
    """Keeps the last `window_s` seconds of every channel (bounded memory) and analyses them on demand."""

    def __init__(self, fs, window_s, rpm=None, envelope=False, units="g"):
        self.fs, self.window_s, self.rpm, self.envelope, self.units = fs, window_s, rpm, envelope, units
        self.maxlen = int(round(window_s * fs))
        self.buf = {}
        self.total = 0                    # samples pushed since the run started (never reset by trimming)

    def push(self, i0, chans):
        n = len(next(iter(chans.values())))
        if i0 != self.total:
            raise ValueError(f"gap or overlap in stream: expected sample {self.total}, got {i0}")
        for c, y in chans.items():
            self.buf[c] = np.concatenate([self.buf.get(c, np.zeros(0)), y])[-self.maxlen:]
        self.total += n

    @property
    def buffered(self):
        return len(next(iter(self.buf.values()))) if self.buf else 0

    def ready(self):
        return self.buffered >= min(self.maxlen, max(vibration.MIN_SAMPLES, int(self.fs * 1.0)))

    def analyze(self, detail_channel):
        n = self.buffered
        res = vibration.analyze({c: v for c, v in self.buf.items()}, float(self.fs), rpm=self.rpm, envelope=self.envelope,
                                detail_channels=[detail_channel], max_points=1000, spec_shape=(64, 96))
        res["window"] = {"start_s": (self.total - n) / self.fs, "end_s": self.total / self.fs, "duration_s": n / self.fs,
                         "samples": n, "target_s": self.window_s}
        return res


def truth(s: Settings):
    """The fault the simulator is injecting: the demonstration's ground truth, NOT a model output."""
    return {"fault": s.fault, "label": FAULT_LABELS[s.fault], "severity": s.severity if s.fault != "healthy" else 0.0}
