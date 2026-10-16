"""Physics-inspired synthetic engine vibration/acoustic generator with injectable faults.

Each window is built on engine kinematics: crank angle advances with RPM, a 4-stroke
4-cylinder engine fires every 180 deg of crank, and each mechanical event (combustion,
knock, valve impact, bearing defect) excites structural resonances. Faults change which
events happen and what they excite, so each fault leaves its own physical signature.

Three sensors per window (synth_window): "accel" (= "signal", the block accelerometer, structure-borne),
"mic" (air-borne: a different transfer path plus its own background noise) and "obd" (the engine's OBD-II
context for that second). mic and obd use their own random stream seeded from the accel signal, so the
accel output and the caller's rng sequence are exactly what they were before these channels existed.
"""
from dataclasses import dataclass, replace

import numpy as np
from scipy.signal import butter, fftconvolve, lfilter

FS = 24000          # Hz, covers knock resonance (~6-7.5 kHz) with margin
TRAIN_RPM_RANGE = (750, 4000)   # rpm the models are trained on (train.py, train_fusion.py); outside it = extrapolation
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


CAR_TYPES = {
    # body/engine families; every range sits inside the training distribution of make_car()
    "hatchback": {"label": "Hatchback · 1.2 L petrol", "bore": (0.078, 0.081), "res": (0.98, 1.08), "noise": (1.0, 1.2)},
    "sedan": {"label": "Sedan · 1.5 L petrol", "bore": (0.080, 0.084), "res": (0.95, 1.05), "noise": (0.9, 1.1)},
    "suv": {"label": "SUV · 2.0 L", "bore": (0.085, 0.090), "res": (0.90, 0.98), "noise": (0.85, 1.0)},
    "pickup": {"label": "Pickup · 2.4 L", "bore": (0.087, 0.090), "res": (0.90, 0.95), "noise": (0.8, 0.95)},
    "coupe": {"label": "Sports coupe · 2.0 L turbo", "bore": (0.083, 0.087), "res": (1.02, 1.10), "noise": (1.05, 1.2)},
}


def make_car(car_id: int, car_type: str = None) -> CarProfile:
    """car_id picks one physical unit; car_type (optional) narrows it to a body/engine family."""
    rng = np.random.default_rng(1000 + car_id + (0 if car_type is None else 97 * list(CAR_TYPES).index(car_type)))
    t = CAR_TYPES.get(car_type)
    bore = rng.uniform(*(t["bore"] if t else (0.078, 0.090)))
    c = rng.uniform(880, 980)
    res_scale = rng.uniform(*t["res"], 3) if t else rng.uniform(0.9, 1.1, 3)
    return CarProfile(
        car_id=car_id,
        resonances=tuple(np.array([1150.0, 2600.0, 5200.0]) * res_scale),
        knock_freq=1.84 * c / (np.pi * bore),
        pulley_ratio=rng.uniform(2.4, 2.9),
        bpfo_ratio=rng.uniform(2.9, 3.4),
        squeal_freq=rng.uniform(2600, 3400),
        noise=rng.uniform(*(t["noise"] if t else (0.8, 1.2))),
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
                 age=0.0, misfire_cyl=2, rng=None, fs=FS, dur=DUR, noise_scale=1.0, randomize=False,
                 bg_noise_bank=None):
    """Return one window of engine-block vibration ("signal" = "accel"), engine sound ("mic"),
    the OBD-II context ("obd") and per-firing crank speed.

    severity: 0..1 fault strength. coolant_c: engine temperature (cold engines are noisier).
    age: 0..1 normal wear, raises noise floor and combustion roughness slowly.
    noise_scale: multiplies the background noise of both sensors (1 = the training conditions).
    randomize: domain randomisation for sim-to-real training. rpm (600-6500) and severity (0.05-1.0) are drawn
    here instead of taken from the arguments, the car's resonances move +-20%, and both sensors get a random EQ
    tilt, short reverb, background at 0-30 dB SNR (a clip from bg_noise_bank, e.g. real healthy 1 s windows,
    else coloured noise) and +-12 dB gain. randomize=False is exactly the original generator.
    """
    rng = rng or np.random.default_rng()
    car = car or make_car(0)
    if randomize:
        rpm, severity = rng.uniform(600, 6500), rng.uniform(0.05, 1.0)
        car = replace(car, resonances=tuple(np.asarray(car.resonances) * rng.uniform(0.8, 1.2, 3)))
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

    # every source is also kept on its own (parts) so the microphone can hear it through a different path;
    # the accelerometer signal x is summed exactly as before
    parts = {k: np.zeros(n) for k in ("comb", "knock", "tick", "bearing", "squeal", "orders")}
    k_comb = _kernel(fs, car.resonances, 250, 0.04, [1.0, 0.6, 0.3])
    x = _place(n, fs, times, amps, k_comb)
    parts["comb"] += x

    # cold engine: piston slap / looser clearances add a 3.2 kHz rattle per firing
    if cold > 0:
        p = _place(n, fs, times, amps * 0.8 * cold, _kernel(fs, [3200], 700, 0.015))
        x += p
        parts["comb"] += p

    if fault == "knock":
        hit = rng.random(len(times)) < 0.25 + 0.5 * severity
        k_knock = _kernel(fs, [car.knock_freq, car.knock_freq * 1.66], 1200, 0.012, [1.0, 0.4])
        p = _place(n, fs, times[hit] + 0.0015, amps[hit] * 0.9 * severity, k_knock)
        x += p
        parts["knock"] += p

    if fault == "valve_tick":
        tick_t = phase + (np.arange(-1, n_cycles) + car.tick_offset) * cycle
        k_tick = _kernel(fs, [4200, 6800], 900, 0.012, [1.0, 0.5])
        p = _place(n, fs, tick_t, np.full(len(tick_t), 1.2 * severity), k_tick)
        x += p
        parts["tick"] += p

    if fault == "bearing":
        bpfo = car.bpfo_ratio * car.pulley_ratio * f_rev
        bt = np.arange(0, dur, 1 / bpfo) + 0.01 * rng.standard_normal(int(np.ceil(dur * bpfo))) / bpfo
        mod = 1 + 0.5 * np.sin(2 * np.pi * car.pulley_ratio * f_rev * bt)
        p = _place(n, fs, bt, 0.45 * severity * mod, _kernel(fs, [3500], 600, 0.01))
        x += p
        parts["bearing"] += p

    if fault == "belt_squeal":
        inst_f = car.squeal_freq + 40 * np.sin(2 * np.pi * 7 * t)
        tone = np.sin(2 * np.pi * np.cumsum(inst_f) / fs)
        env = np.clip(np.sin(2 * np.pi * rng.uniform(1.5, 3.0) * t + rng.uniform(0, 6)), 0, None)
        p = 0.5 * severity * (1 + 0.5 * cold) * env * tone
        x += p
        parts["squeal"] += p

    # rotating/reciprocating unbalance: an I4 always has some 2nd order; faults add 1x
    rpm_k = (rpm / 2000.0) ** 2
    p = 0.10 * rpm_k * np.sin(2 * np.pi * 2 * f_rev * t + rng.uniform(0, 6))
    x += p
    parts["orders"] += p
    if fault == "imbalance":
        p = 0.8 * severity * rpm_k * np.sin(2 * np.pi * f_rev * t + rng.uniform(0, 6))
        x += p
        parts["orders"] += p
        p = 0.3 * severity * rpm_k * np.sin(2 * np.pi * 2 * f_rev * t + rng.uniform(0, 6))
        x += p
        parts["orders"] += p

    # background: white sensor noise + low-frequency road/body noise, rising slowly with age
    lvl = 0.05 * car.noise * (1 + 0.6 * age) * noise_scale
    x += lvl * rng.standard_normal(n)
    x += lfilter([0.02], [1, -0.98], 3 * lvl * rng.standard_normal(n))

    x *= rng.uniform(0.8, 1.2)  # mounting / microphone gain variation
    acc = x.astype(np.float32)
    srng = np.random.default_rng(np.frombuffer(acc[:16].tobytes(), dtype=np.uint32))  # mic + OBD: own stream
    mic = _mic(parts, fs, n, car, noise_scale, srng).astype(np.float32)
    obd = _obd(fault, severity, rpm, coolant_c, car, srng)
    if randomize:
        acc = _randomize(acc, fs, rng, bg_noise_bank)
        mic = _randomize(mic, fs, rng, bg_noise_bank)
    return {"signal": acc, "accel": acc, "mic": mic, "obd": obd, "crank_speed": crank[(times >= 0) & (times < dur)],
            "fs": fs, "rpm": rpm, "fault": fault}


def _randomize(x, fs, rng, bank=None):
    """Recording-chain randomisation: EQ tilt, short reverb, background at 0-30 dB SNR, +-12 dB gain."""
    n = len(x)
    y = np.asarray(x, dtype=np.float64)
    b, a = butter(1, 1000, "highpass", fs=fs)                 # tilt: add or remove treble above ~1 kHz
    y = y + rng.uniform(-0.6, 1.0) * lfilter(b, a, y)
    m = int(rng.uniform(0.02, 0.08) * fs)                     # 20-80 ms of reflections
    ir = rng.standard_normal(m) * np.exp(-np.arange(m) / (rng.uniform(0.005, 0.02) * fs))
    y = y + rng.uniform(0.1, 0.5) * fftconvolve(y, ir / np.sqrt(np.sum(ir ** 2)))[:n]
    if bank is not None and len(bank):
        bg = np.resize(np.asarray(bank[int(rng.integers(len(bank)))], dtype=np.float64), n)
    else:                                                     # coloured noise, spectrum ~ 1/f^beta, beta 0..2
        spec = np.fft.rfft(rng.standard_normal(n))
        f = np.fft.rfftfreq(n, 1 / fs)
        spec[1:] /= f[1:] ** (rng.uniform(0, 2) / 2)
        spec[0] = 0
        bg = np.fft.irfft(spec, n)
    snr_db = rng.uniform(0, 30)
    y = y + bg * (y.std() / (bg.std() + 1e-12)) * 10 ** (-snr_db / 20)
    return (y * 10 ** (rng.uniform(-12, 12) / 20)).astype(np.float32)


# ------------------------------------------------------------------ microphone (air-borne path)
# How strongly each source reaches a microphone near the engine bay, relative to the block accelerometer.
# Thin covers, belts and pulleys radiate into air well; low-order rigid-body motion and a bearing buried in
# an accessory housing reach the air poorly but shake the block directly.
MIC_GAIN = {
    "comb": 0.5,       # combustion: heard, but most of it is structure-borne
    "knock": 0.7,      # 6-7 kHz cylinder ring radiates through the block walls, somewhat damped
    "tick": 1.8,       # valve-train clicks radiate from the thin cam cover: much clearer in air
    "bearing": 0.45,   # defect impacts sit inside the accessory housing: best felt on the structure
    "squeal": 2.2,     # a slipping belt is an air-borne tone first; the block barely moves with it
    "orders": 0.12,    # 1x/2x (imbalance, mounts) are 25-130 Hz rigid-body motion: weak radiators
}


def _mic(parts, fs, n, car, noise_scale, rng):
    src = sum(g * parts[k] for k, g in MIC_GAIN.items())
    # radiation: panels barely radiate below ~80 Hz, and the bay radiates best around 1-5 kHz
    b, a = butter(2, 80, "highpass", fs=fs)
    y = lfilter(b, a, src)
    b, a = butter(2, [1000, 5000], "bandpass", fs=fs)
    y = y + 0.8 * lfilter(b, a, y)
    # engine bay / garage reverberation: a decaying noise impulse response (~0.1 s)
    m = int(0.1 * fs)
    ir = rng.standard_normal(m) * np.exp(-np.arange(m) / (0.02 * fs))
    y = y + 0.35 * fftconvolve(y, ir / np.sqrt(np.sum(ir ** 2)))[:n]
    y *= rng.uniform(0.35, 0.6)             # distance: the mic is ~0.5-1 m from the block, not bolted to it
    # independent background the accelerometer does not pick up
    road = lfilter(*butter(2, 400, "lowpass", fs=fs), rng.standard_normal(n))      # road / wind rumble
    tt = np.arange(n) / fs
    f_fan = rng.uniform(140, 260)
    fan = 0.012 * sum(np.sin(2 * np.pi * h * f_fan * tt + rng.uniform(0, 6)) / h for h in (1, 2, 3))  # cooling fan
    other = np.zeros(n)
    if rng.random() < 0.5:                  # another engine idling nearby, at its own speed
        cyc = 2.0 / (rng.uniform(700, 1000) / 60.0)
        ev = np.arange(rng.uniform(0, cyc / 4), n / fs, cyc / 4)
        other = _place(n, fs, ev, np.full(len(ev), 0.12), _kernel(fs, [900, 2100], 260, 0.04, [1.0, 0.5]))
    hiss = 0.012 * rng.standard_normal(n)  # microphone self-noise
    y += noise_scale * car.noise * (0.04 * road + fan + other + hiss)
    return y * rng.uniform(0.8, 1.2)        # phone / mic gain


# ------------------------------------------------------------------ OBD-II context for the window
def _obd(fault, severity, rpm, coolant_c, car, rng):
    """What the ECU reports during this second. Only faults that change combustion move the OBD values,
    and only modestly: mechanical noises (valve tick, bearing, belt squeal, imbalance) leave fuelling alone."""
    throttle = 8 + 0.012 * rpm + rng.normal(0, 3)
    load = float(np.clip(15 + 0.015 * rpm + rng.normal(0, 4), 10, 100))
    map_kpa = 30 + 0.55 * load + rng.normal(0, 1.5)
    ltft = np.random.default_rng(500 + car.car_id).normal(0, 2.0) + rng.normal(0, 0.5)   # this car's fuel adaptation
    closed_loop = coolant_c >= 50                       # a cold engine runs open loop: trims stay near 0
    stft_mean, stft_sd = 0.0, (2.0 if closed_loop else 0.5)
    if fault == "misfire":
        # unburnt oxygen from the dead cylinder reaches the upstream O2 sensor, which reads lean: the ECU adds
        # fuel (STFT up) and the trim swings harder; LTFT adapts a little; idle control opens the throttle a
        # touch to hold speed, so MAP and throttle rise a few units
        if closed_loop:
            stft_mean += 3.0 * severity
            stft_sd *= 1 + 1.5 * severity
            ltft += 2.0 * severity
        map_kpa += 2.0 * severity
        throttle += 2.0 * severity
    elif fault == "knock":
        # the knock sensor makes the ECU retard timing: less torque per gram of air, so slightly more air
        # (MAP, throttle) for the same speed; fuelling is unchanged
        map_kpa += 1.5 * severity
        throttle += 1.5 * severity
    stft = rng.normal(stft_mean, stft_sd, 10)           # ten 0.1 s OBD samples within the second
    return {"rpm": float(rpm), "coolant_c": float(coolant_c), "throttle_pct": float(np.clip(throttle, 5, 100)),
            "load_pct": load, "stft_pct": float(stft.mean()), "stft_std": float(stft.std()),
            "ltft_pct": float(ltft), "map_kpa": float(map_kpa)}
