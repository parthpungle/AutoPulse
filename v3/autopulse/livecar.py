"""A car you can drive one second at a time: the live version of telemetry.simulate_drive.

The vehicle node calls step() once per second. Each step returns what the car's sensors
would put on the wire: one OBD-II style row (1 Hz) and, while the engine runs, one
1-second engine-block vibration window (24 kHz) with per-firing crank speeds.
Breakdowns are switched on and off while it drives; each one starts acting from the
moment it is injected, exactly like a real failure would.

Engine sound source: "sim" (synth_window, the default) or "replay": consecutive 1 s windows of a real
recording, looping, prepared exactly as for the real-audio models. OBD stays simulated either way.
"""
from pathlib import Path

import numpy as np
from scipy.io import wavfile

from . import real_audio
from .generator import CAR_TYPES, ENGINE_FAULTS, FAULT_LABELS, make_car, synth_window
from .telemetry import GEAR_RATIO, OBD_FAULTS, TANK_L

ROOT = Path(__file__).resolve().parents[1]
RECORDING_DIRS = [ROOT / "frontend" / "public" / "samples", ROOT / "data" / "raw" / "engine_audio"]
AUDIO_LABEL = {"healthy": "healthy", "misfire": "misfire", "tappet_issue": "valve_tick", "belt_issue": "belt_squeal"}


def recordings():
    """Real engine recordings this laptop can replay: the bundled samples, then the full dataset if downloaded."""
    out, seen = [], set()
    for d in RECORDING_DIRS:
        for f in sorted(d.glob("*.wav")) if d.exists() else []:
            label = AUDIO_LABEL.get(f.stem.rsplit("_", 1)[0])
            if label and f.stem not in seen:
                seen.add(f.stem)
                out.append({"id": f.stem, "label": FAULT_LABELS[label], "fault": label, "path": f,
                            "sample": d == RECORDING_DIRS[0]})
    return out

MODES = {   # target speeds (km/h) the virtual driver picks from, and how long each segment lasts (s)
    "idle": {"label": "Parked, idling", "speeds": [0], "p": [1.0], "seg": (30, 60)},
    "city": {"label": "City", "speeds": [0, 20, 35, 50, 60], "p": [0.15, 0.2, 0.3, 0.25, 0.1], "seg": (15, 45)},
    "highway": {"label": "Highway", "speeds": [80, 95, 105, 115], "p": [0.2, 0.35, 0.3, 0.15], "seg": (20, 60)},
}


class LiveCar:
    def __init__(self, car_type="sedan", unit=8, seed=None):
        self.rng = np.random.default_rng(seed)
        self.ambient = 24.0
        self.mode = "city"
        self.engine_fault, self.severity = "healthy", 0.8
        # stress modifiers for "where it breaks" demos: background noise x1/x5/x10 on both sensors, fault strength
        # drawn per second from a band ("normal" 0.4-1.0 as in training, "early" 0.1-0.3) instead of the slider,
        # and a fixed engine speed (e.g. 5500 rpm, above the 750-4000 rpm the models were trained on)
        self.noise_mult, self.severity_band, self.rpm_override = 1.0, None, None
        self.obd_faults = {}            # fault id -> vehicle clock (s) when it was injected
        self.clock = 0                  # seconds since the node started, keeps running with the engine off
        self.fuel = 42.0
        self.source, self.recording, self._rec, self._rec_i, self._rec_tag = "sim", None, None, 0, None
        self.set_car(car_type, unit)

    def set_source(self, source, recording=None):
        """Engine sound: "sim" or "replay" of a real recording (id from recordings())."""
        if source == "sim":
            self.source = "sim"
            return
        if source != "replay":
            raise ValueError(f"unknown engine sound source {source}")
        recs = recordings()
        ids = [r["id"] for r in recs]
        rec = recording if recording in ids else (self.recording if self.recording in ids else None)
        if rec is None:
            if not recs:
                raise ValueError("no real recordings on this laptop (frontend/public/samples or data/raw/engine_audio)")
            rec = ids[0]
        if rec != self.recording or self._rec is None:
            fs, x = wavfile.read(recs[ids.index(rec)]["path"])
            y = real_audio.resample(real_audio.to_mono(x), fs)
            self._rec = real_audio.clip_windows(y)[0]            # z-scored 1 s windows, 0.5 s hop: as in training
            self._rec_i = 0
            self._rec_tag = f"rec-{ids.index(rec):02d}"           # what goes on the wire: not the file name (= label)
        self.source, self.recording = "replay", rec

    # ------------------------------------------------------------------ controls
    def set_car(self, car_type, unit):
        if car_type not in CAR_TYPES:
            raise ValueError(f"unknown car type {car_type}")
        self.car_type, self.unit = car_type, int(unit)
        self.car = make_car(self.unit, car_type)
        self.ignition = False
        self.trip_t = 0
        self.speed, self.target, self.seg_left = 0.0, 0.0, 0
        self.coolant = self.ambient + 3
        self.battery = 12.6
        self.tyre_loss = np.zeros(4)
        self.fuel = 42.0

    def start(self):
        if not self.ignition:
            self.ignition, self.trip_t = True, 0
            self.speed, self.target, self.seg_left = 0.0, 0.0, 8   # a few seconds of idle before pulling away

    def stop(self):
        self.ignition = False

    def inject(self, fault):
        if fault in ENGINE_FAULTS:
            self.engine_fault = fault
        elif fault in OBD_FAULTS and fault != "none":
            self.obd_faults.setdefault(fault, self.clock)
        else:
            raise ValueError(f"unknown fault {fault}")

    def repair(self, fault=None):
        """Repair one fault, or everything when fault is None (a visit to the workshop)."""
        if fault in (None, "all"):
            self.engine_fault = "healthy"
            self.obd_faults.clear()
            self.tyre_loss[:] = 0
            return
        if fault in ENGINE_FAULTS:
            self.engine_fault = "healthy"
        self.obd_faults.pop(fault, None)
        if fault == "puncture":
            self.tyre_loss[0] = 0
        if fault == "slow_leak":
            self.tyre_loss[3] = 0

    def since(self, fault):
        return self.clock - self.obd_faults[fault] if fault in self.obd_faults else -1

    @property
    def label(self):
        return CAR_TYPES[self.car_type]["label"]

    def truth(self):
        """What is actually broken. Only the vehicle's own control panel shows this; it is never transmitted."""
        rec = next((r for r in recordings() if r["id"] == self.recording), None) if self.source == "replay" else None
        return {"engine_fault": rec["fault"] if rec else self.engine_fault,
                "engine_label": rec["label"] if rec else FAULT_LABELS[self.engine_fault],
                "severity": self.severity, "source": self.source, "recording": self.recording,
                "stress": {"noise_mult": self.noise_mult, "severity_band": self.severity_band,
                           "rpm_override": self.rpm_override},
                "obd_faults": [{"id": f, "label": OBD_FAULTS[f], "since_s": self.since(f)} for f in self.obd_faults]}

    # ------------------------------------------------------------------ one second of driving
    def _driver(self):
        if not self.ignition:
            return 0.0
        self.seg_left -= 1
        if self.seg_left <= 0:
            m = MODES[self.mode]
            self.target = float(self.rng.choice(m["speeds"], p=m["p"]))
            self.seg_left = int(self.rng.integers(*m["seg"]))
        self.speed += np.clip(self.target - self.speed, -6, 3)
        return float(max(0.0, self.speed + self.rng.normal(0, 0.3)))

    def step(self, with_vibration=True):
        rng, on = self.rng, self.ignition
        self.clock += 1
        speed = self._driver()
        accel = speed - getattr(self, "_last_speed", 0.0)
        self._last_speed = speed
        f = self.since

        if on:
            self.trip_t += 1
            gear = int(np.clip(1 + speed // 18, 1, 5))
            idle = 800 + (300 if self.coolant < 45 else 0)              # cold engines idle higher
            rpm = max(idle, speed * GEAR_RATIO[gear]) + rng.normal(0, 15)
            if self.rpm_override:
                rpm = self.rpm_override + rng.normal(0, 15)
            throttle = float(np.clip(8 + 0.36 * speed + 25 * max(accel, 0), 5, 100))
            load = float(np.clip(throttle / 100 * 0.8 + 0.15, 0, 1))
        else:
            rpm = throttle = load = 0.0

        # coolant: warm-up to the thermostat setpoint; leaks / a broken belt push it towards boiling
        target, tau = (90.0, 70.0 / (0.5 + load)) if on else (self.ambient, 900.0)
        if on and "thermostat_stuck" in self.obd_faults:
            target, tau = self.ambient + 42, 150.0
        if on and (f("coolant_leak") >= 0 or f("belt_broken") >= 0):
            target, tau = 135.0, 90.0
        self.coolant += (target - self.coolant) / tau + rng.normal(0, 0.05)

        visc = np.interp(self.coolant, [0, 40, 90, 120], [1.6, 1.35, 1.0, 0.85])
        oil = float(np.clip((0.8 + 0.9 * rpm / 1000) * visc, 0, 5.5)) if on else 0.0
        if f("low_oil_pressure") >= 0:
            oil *= np.clip(1 - f("low_oil_pressure") / 90, 0.15, 1)
        oil = max(0.0, oil + (rng.normal(0, 0.05) if on else 0))

        charging = on and f("alternator_failure") < 0 and f("belt_broken") < 0
        goal = 14.2 if charging else 12.6
        self.battery += (goal - self.battery) * (0.3 if charging else 0.05)
        if on and not charging:
            self.battery -= 0.0012 + 0.001 * load                       # running on the battery alone
        battery = self.battery + rng.normal(0, 0.03)

        if f("puncture") >= 0:
            self.tyre_loss[0] = min(self.tyre_loss[0] + 0.25, 30)
        if f("slow_leak") >= 0:
            self.tyre_loss[3] = min(self.tyre_loss[3] + 0.03, 25)
        warm = 2.0 * (1 - np.exp(-self.trip_t / 400)) if on else 0.0
        tyres = 32.5 + warm - self.tyre_loss + rng.normal(0, 0.05, 4)

        ltft = rng.normal(0, 0.4)
        if on and f("vacuum_leak") >= 0:
            ltft += (14 if speed < 2 else 5) * np.clip(f("vacuum_leak") / 60, 0, 1)
        stft = rng.normal(0, 2.0) if on else 0.0

        fuel_rate = max(0.0, 0.7 + 0.0035 * rpm * load + rng.normal(0, 0.05)) if on else 0.0
        drop = fuel_rate / 3600 / TANK_L * 100
        if f("fuel_leak") >= 0:
            drop += 0.012
        self.fuel = max(0.0, self.fuel - drop)

        obd = {"t": self.trip_t, "clock": self.clock, "ignition": on, "speed_kph": speed, "rpm": float(rpm),
               "throttle_pct": throttle, "engine_load": load * 100, "coolant_c": float(self.coolant),
               "oil_pressure_bar": float(oil), "battery_v": float(battery), "ltft_pct": float(ltft),
               "stft_pct": float(stft), "fuel_rate_lph": float(fuel_rate), "fuel_level_pct": float(self.fuel),
               "ambient_c": float(self.ambient), "tyre_fl_psi": float(tyres[0]), "tyre_fr_psi": float(tyres[1]),
               "tyre_rl_psi": float(tyres[2]), "tyre_rr_psi": float(tyres[3])}

        vib = None
        if on and with_vibration and self.source == "replay":
            x = self._rec[self._rec_i % len(self._rec)]
            self._rec_i += 1
            vib = {"signal": x, "fs": real_audio.FS, "rpm": float(rpm), "crank_speed": [],
                   "source": "replay", "clip": self._rec_tag}
        elif on and with_vibration:
            sev = {"normal": (0.4, 1.0), "early": (0.1, 0.3)}.get(self.severity_band)
            w = synth_window(self.engine_fault, rpm=float(rpm), car=self.car,
                             severity=rng.uniform(*sev) if sev else self.severity, coolant_c=float(self.coolant),
                             misfire_cyl=1, rng=rng, noise_scale=self.noise_mult)
            vib = {"signal": w["accel"], "mic": w["mic"], "fs": w["fs"], "rpm": float(rpm), "crank_speed": w["crank_speed"]}
            # the ECU's fuel trims and MAP for this second come from the engine model (they react to a misfire);
            # breakdowns injected over OBD (e.g. a vacuum leak) still add on top of the trim
            e = w["obd"]
            obd.update(stft_pct=e["stft_pct"], stft_std=e["stft_std"], map_kpa=e["map_kpa"],
                       ltft_pct=obd["ltft_pct"] + e["ltft_pct"])
        return obd, vib
