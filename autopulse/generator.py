"""Physics-inspired synthetic engine vibration/acoustic generator with injectable faults.

Each window is built on engine kinematics: crank angle advances with RPM, a 4-stroke
4-cylinder engine fires every 180 deg of crank, and each mechanical event (combustion,
knock, valve impact, bearing defect) excites structural resonances. Faults change which
events happen and what they excite, so each fault leaves its own physical signature.
"""
from dataclasses import dataclass

import numpy as np
from scipy.signal import fftconvolve, lfilter

FS = 24000          # Hz, covers knock resonance (~6-7.5 kHz) with margin
DUR = 1.0           # seconds per analysis window
N_CYL = 4

ENGINE_FAULTS = ["healthy", "misfire", "knock", "valve_tick", "bearing", "belt_squeal", "imbalance"]
FAULT_LABELS = {
    "healthy": "Healthy",
    "misfire": "Misfire",
    "knock": "Knock / detonation",
    "valve_tick": "Valve train wear (tappet tick)",
    "bearing": "Accessory bearing fault",
    "belt_squeal": "Belt slip / squeal",
    "imbalance": "Imbalance / engine mount",
}


@dataclass
class CarProfile:
    """Per-car physical parameters, so no two simulated cars sound identical."""
    car_id: int
    resonances: tuple       # structural resonances of block/body (Hz)
    knock_freq: float       # first circumferential cylinder mode (Hz), Draper: 1.84*c/(pi*bore)
    pulley_ratio: float     # accessory (alternator) pulley speed / crank speed
    bpfo_ratio: float       # bearing outer-race defect frequency / shaft frequency
    squeal_freq: float      # belt squeal tone (Hz)
    noise: float            # background noise level
    tick_offset: float      # valve tick position within the cycle (fraction of 720 deg)


def make_car(car_id: int) -> CarProfile:
    rng = np.random.default_rng(1000 + car_id)
    bore = rng.uniform(0.078, 0.090)
    c = rng.uniform(880, 980)
    return CarProfile(
        car_id=car_id,
        resonances=tuple(np.array([1150.0, 2600.0, 5200.0]) * rng.uniform(0.9, 1.1, 3)),
        knock_freq=1.84 * c / (np.pi * bore),
        pulley_ratio=rng.uniform(2.4, 2.9),
        bpfo_ratio=rng.uniform(2.9, 3.4),
        squeal_freq=rng.uniform(2600, 3400),
        noise=rng.uniform(0.8, 1.2),
        tick_offset=rng.uniform(0.05, 0.2),
    )


def _kernel(fs, freqs, decay, length_s, amps=None):
    t = np.arange(int(length_s * fs)) / fs
    amps = amps if amps is not None else [1.0] * len(freqs)
    return sum(a * np.exp(-decay * t) * np.sin(2 * np.pi * f * t) for a, f in zip(amps, freqs))


def _place(n, fs, times, amps, kernel):
    """Impulse train at event times convolved with an event kernel."""
    train = np.zeros(n)
    idx = np.round(np.asarray(times) * fs).astype(int)
    ok = (idx >= 0) & (idx < n)
    np.add.at(train, idx[ok], np.asarray(amps)[ok])
    return fftconvolve(train, kernel)[:n]


def synth_window(fault="healthy", rpm=1500.0, car=None, severity=1.0, coolant_c=90.0,
                 age=0.0, misfire_cyl=2, rng=None, fs=FS, dur=DUR):
    """Return one window of engine-block vibration/sound plus per-firing crank speed.

    severity: 0..1 fault strength. coolant_c: engine temperature (cold engines are noisier).
    age: 0..1 normal wear, raises noise floor and combustion roughness slowly.
    """
    rng = rng or np.random.default_rng()
    car = car or make_car(0)
    n = int(fs * dur)
    t = np.arange(n) / fs
    f_rev = rpm / 60.0
    cycle = 2.0 / f_rev                       # 720 deg of crank
    phase = rng.uniform(0, cycle)
    load = 0.5 + rpm / 4000.0
    cold = max(0.0, (50.0 - coolant_c) / 50.0)  # 0 when warm, ~1 when stone cold

    # firing events: cylinder k fires at k*180 deg within each 720 deg cycle
    n_cycles = int(dur / cycle) + 3
    times, cyls = [], []
    for c_i in range(-1, n_cycles):
        for k in range(N_CYL):
            times.append(phase + (c_i + k / N_CYL) * cycle - cycle)
            cyls.append(k)
    times, cyls = np.array(times), np.array(cyls)
    amps = load * (1 + (0.08 + 0.05 * age) * rng.standard_normal(len(times)))

    crank = rpm * (1 + 0.003 * rng.standard_normal(len(times)))
    if fault == "misfire":
        p = 0.6 + 0.4 * severity
        miss = (cyls == misfire_cyl) & (rng.random(len(times)) < p)
        amps[miss] *= (1 - 0.9 * severity)
        crank[miss] -= rpm * 0.025 * severity

    k_comb = _kernel(fs, car.resonances, 250, 0.04, [1.0, 0.6, 0.3])
    x = _place(n, fs, times, amps, k_comb)

    # cold engine: piston slap / looser clearances add a 3.2 kHz rattle per firing
    if cold > 0:
        x += _place(n, fs, times, amps * 0.8 * cold, _kernel(fs, [3200], 700, 0.015))

    if fault == "knock":
        hit = rng.random(len(times)) < 0.25 + 0.5 * severity
        k_knock = _kernel(fs, [car.knock_freq, car.knock_freq * 1.66], 1200, 0.012, [1.0, 0.4])
        x += _place(n, fs, times[hit] + 0.0015, amps[hit] * 0.9 * severity, k_knock)

    if fault == "valve_tick":
        tick_t = phase + (np.arange(-1, n_cycles) + car.tick_offset) * cycle
        k_tick = _kernel(fs, [4200, 6800], 900, 0.012, [1.0, 0.5])
        x += _place(n, fs, tick_t, np.full(len(tick_t), 1.2 * severity), k_tick)

    if fault == "bearing":
        bpfo = car.bpfo_ratio * car.pulley_ratio * f_rev
        bt = np.arange(0, dur, 1 / bpfo) + 0.01 * rng.standard_normal(int(np.ceil(dur * bpfo))) / bpfo
        mod = 1 + 0.5 * np.sin(2 * np.pi * car.pulley_ratio * f_rev * bt)
        x += _place(n, fs, bt, 0.45 * severity * mod, _kernel(fs, [3500], 600, 0.01))

    if fault == "belt_squeal":
        inst_f = car.squeal_freq + 40 * np.sin(2 * np.pi * 7 * t)
        tone = np.sin(2 * np.pi * np.cumsum(inst_f) / fs)
        env = np.clip(np.sin(2 * np.pi * rng.uniform(1.5, 3.0) * t + rng.uniform(0, 6)), 0, None)
        x += 0.5 * severity * (1 + 0.5 * cold) * env * tone

    # rotating/reciprocating unbalance: an I4 always has some 2nd order; faults add 1x
    rpm_k = (rpm / 2000.0) ** 2
    x += 0.10 * rpm_k * np.sin(2 * np.pi * 2 * f_rev * t + rng.uniform(0, 6))
    if fault == "imbalance":
        x += 0.8 * severity * rpm_k * np.sin(2 * np.pi * f_rev * t + rng.uniform(0, 6))
        x += 0.3 * severity * rpm_k * np.sin(2 * np.pi * 2 * f_rev * t + rng.uniform(0, 6))

    # background: white sensor noise + low-frequency road/body noise, rising slowly with age
    lvl = 0.05 * car.noise * (1 + 0.6 * age)
    x += lvl * rng.standard_normal(n)
    x += lfilter([0.02], [1, -0.98], 3 * lvl * rng.standard_normal(n))

    x *= rng.uniform(0.8, 1.2)  # mounting / microphone gain variation
    return {"signal": x.astype(np.float32), "crank_speed": crank[(times >= 0) & (times < dur)],
            "fs": fs, "rpm": rpm, "fault": fault}
