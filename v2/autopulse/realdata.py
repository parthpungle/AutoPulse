"""Loaders for the public real-world datasets in data/raw (see scripts/download_data.py).

Downloaded files are treated as data only: CSV via pandas, WAV via scipy, MATLAB files via scipy.io.
"""
from pathlib import Path

import numpy as np
import pandas as pd
from scipy.io import loadmat, wavfile
from scipy.signal import resample_poly

from .signatures import envelope_spectrum

RAW = Path(__file__).resolve().parents[1] / "data" / "raw"

CAROBD_COLS = {
    "ENGINE_RUN_TINE": "run_time_s", "ENGINE_RPM": "rpm", "VEHICLE_SPEED": "speed_kph",
    "THROTTLE": "throttle_pct", "ENGINE_LOAD": "engine_load", "COOLANT_TEMPERATURE": "coolant_c",
    "LONG_TERM_FUEL_TRIM_BANK_1": "ltft_pct", "SHORT_TERM_FUEL_TRIM_BANK_1": "stft_pct",
    "INTAKE_MANIFOLD_PRESSURE": "map_kpa", "FUEL_TANK": "fuel_level_pct", "INTAKE_AIR_TEMP": "iat_c",
    "TIMING_ADVANCE": "timing_deg", "CATALYST_TEMPERATURE_BANK1_SENSOR1": "cat_c",
    "CONTROL_MODULE_VOLTAGE": "battery_v", "FUEL_AIR_COMMANDED_EQUIV_RATIO": "lambda_cmd",
}


# ------------------------------------------------------------------ carOBD (real OBD-II, Toyota Etios)
def load_carobd():
    """{trip name: 1 Hz DataFrame}. Rows end with a trailing comma, so index_col=False is essential;
    the logger writes several rows per run-time second, which are averaged to 1 Hz."""
    trips = {}
    for f in sorted((RAW / "carobd").glob("*.csv"), key=lambda p: (p.stem.rstrip("0123456789"),
                                                                    int("0" + "".join(filter(str.isdigit, p.stem))))):
        d = pd.read_csv(f, skipinitialspace=True, index_col=False)
        d = d.loc[:, ~d.columns.str.startswith("Unnamed")]
        d.columns = [c.replace("()", "").strip() for c in d.columns]
        d = d.rename(columns=CAROBD_COLS)[list(CAROBD_COLS.values())]
        d = d.groupby(d.run_time_s.round()).mean().reset_index(drop=True)
        d = d[d.rpm > 400].reset_index(drop=True)  # engine running only
        if len(d) >= 120:
            d["trip"] = f.stem
            d["group"] = f.stem.rstrip("0123456789")
            trips[f.stem] = d
    return trips


# ------------------------------------------------------------------ engine condition table (HF)
def load_engine_condition():
    d = pd.read_csv(RAW / "engine_condition" / "engine_data.csv")
    d.columns = ["rpm", "oil_pressure", "fuel_pressure", "coolant_pressure", "oil_temp_c", "coolant_c", "condition"]
    return d


# ------------------------------------------------------------------ real engine audio (HF)
AUDIO_CLASS_MAP = {"healthy": "healthy", "misfire": "misfire", "tappet_issue": "valve_tick", "belt_issue": "belt_squeal"}


def estimate_rpm(x, fs, lo_hz=12.0, hi_hz=90.0):
    """Engine speed from sound alone: the envelope repeats at the firing frequency
    (4-stroke 4-cylinder: 2 firings per crank revolution), so rpm = f_fire * 60 / 2."""
    fe, E = envelope_spectrum(x, fs, band=(300, 6000))
    sel = (fe >= lo_hz) & (fe <= hi_hz)
    f_fire = fe[sel][int(np.argmax(E[sel]))]
    return float(f_fire * 30.0)


def load_engine_audio(fs_out=24000, window_s=1.0, hop_s=0.5):
    """Real phone recordings of engines. Returns a list of 1 s windows with clip ids, so
    train/test can be split by recording (windows of one clip never sit on both sides)."""
    out = []
    for f in sorted((RAW / "engine_audio").glob("*.wav")):
        label = AUDIO_CLASS_MAP.get(f.stem.rsplit("_", 1)[0])
        if label is None:
            continue
        fs, y = wavfile.read(f)
        y = y.astype(np.float64)
        if y.ndim > 1:
            y = y.mean(axis=1)
        y = resample_poly(y, fs_out, fs) if fs != fs_out else y
        y = (y - y.mean()) / (y.std() + 1e-9)
        n, hop = int(window_s * fs_out), int(hop_s * fs_out)
        for start in range(0, len(y) - n + 1, hop):
            out.append({"clip": f.stem, "label": label, "signal": y[start:start + n].astype(np.float32), "fs": fs_out})
    return out


# ------------------------------------------------------------------ CWRU bearings (real vibration)
def load_cwru(window_s=1.0, hop_s=0.5, max_windows_per_file=40):
    """Drive-end accelerometer at 12 kHz. Classes: normal / inner / ball / outer race; load 0-3 HP."""
    out = []
    for f in sorted((RAW / "cwru").glob("*.mat")):
        label_full, load, _ = f.stem.split("_load")[0], int(f.stem.split("_load")[1][0]), None
        m = loadmat(f)
        de = next(v for k, v in m.items() if k.endswith("_DE_time")).ravel().astype(np.float64)
        rpm_key = [k for k in m if k.endswith("RPM")]
        rpm = float(np.ravel(m[rpm_key[0]])[0]) if rpm_key else 1797.0 - 22 * load
        fs = 12000
        n, hop = int(window_s * fs), int(hop_s * fs)
        starts = list(range(0, len(de) - n + 1, hop))[:max_windows_per_file]
        for s in starts:
            out.append({"file": f.stem, "label": label_full.split("_")[0], "size": label_full,
                        "load": load, "rpm": rpm, "signal": de[s:s + n].astype(np.float32), "fs": fs})
    return out
