"""1 Hz OBD-II style drive simulator with injectable slow (thermal/electrical/fluid) faults."""
import numpy as np
import pandas as pd

OBD_FAULTS = {
    "none": "No fault",
    "coolant_leak": "Coolant leak (overheating)",
    "thermostat_stuck": "Thermostat stuck open",
    "alternator_failure": "Alternator not charging",
    "belt_broken": "Serpentine belt broken",
    "puncture": "Tyre puncture (front-left)",
    "slow_leak": "Slow tyre leak (rear-right)",
    "vacuum_leak": "Intake vacuum leak",
    "low_oil_pressure": "Low oil pressure",
    "fuel_leak": "Fuel leak",
}
GEAR_RATIO = [0, 120, 70, 48, 36, 29]  # rpm per km/h per gear
TANK_L = 45.0


def _speed_profile(n, rng):
    """Urban-ish drive: idle, then random accelerate/cruise/brake segments."""
    target = np.zeros(n)
    t = 60
    while t < n:
        seg = int(rng.integers(30, 120))
        target[t:t + seg] = rng.choice([0, 25, 40, 55, 70, 90], p=[0.1, 0.2, 0.25, 0.2, 0.15, 0.1])
        t += seg
    speed = np.zeros(n)
    for i in range(1, n):
        speed[i] = speed[i - 1] + np.clip(target[i] - speed[i - 1], -6, 3)
    return np.clip(speed + rng.normal(0, 0.3, n), 0, None)


def simulate_drive(fault="none", duration_s=900, ambient_c=25.0, fault_start_s=240, seed=0):
    rng = np.random.default_rng(seed)
    n = duration_s
    speed = _speed_profile(n, rng)
    accel = np.gradient(speed)
    gear = np.clip(1 + (speed // 18).astype(int), 1, 5)
    rpm = np.maximum(800, speed * np.take(GEAR_RATIO, gear)) + rng.normal(0, 15, n)
    throttle = np.clip(8 + 1.2 * speed * 0.3 + 25 * np.clip(accel, 0, None), 5, 100)
    load = np.clip(throttle / 100 * 0.8 + 0.15, 0, 1)
    on = np.arange(n) >= fault_start_s
    since = np.clip(np.arange(n) - fault_start_s, 0, None)

    # coolant: warm-up toward thermostat setpoint, faults change the target/heat balance
    coolant = np.empty(n)
    T = ambient_c + 3
    for i in range(n):
        target, tau = 90.0, 200.0 / (0.5 + load[i])
        if fault == "thermostat_stuck":
            target, tau = ambient_c + 42, 380.0
        if fault in ("coolant_leak", "belt_broken") and on[i]:
            target, tau = 135.0, 260.0
        T += (target - T) / tau + rng.normal(0, 0.05)
        coolant[i] = T

    visc = np.interp(coolant, [0, 40, 90, 120], [1.6, 1.35, 1.0, 0.85])
    oil_p = np.clip((0.8 + 0.9 * rpm / 1000) * visc, 0, 5.5) + rng.normal(0, 0.05, n)
    if fault == "low_oil_pressure":
        oil_p *= np.where(on, np.clip(1 - since / 120, 0.2, 1), 1)

    batt = 14.2 + rng.normal(0, 0.04, n)
    if fault in ("alternator_failure", "belt_broken"):
        batt = np.where(on, 12.6 - since * (0.0012 + 0.001 * load), batt) + rng.normal(0, 0.02, n)

    tyres = 32.5 + 2.0 * (1 - np.exp(-np.arange(n) / 400))[:, None] + rng.normal(0, 0.05, (n, 4))
    if fault == "puncture":
        tyres[:, 0] -= np.where(on, np.clip(since * 0.25, 0, 30), 0)
    if fault == "slow_leak":
        tyres[:, 3] -= np.where(on, since * 0.008, 0)

    ltft = np.zeros(n) + rng.normal(0, 0.4, n)
    if fault == "vacuum_leak":
        idle = speed < 2
        ltft += np.where(on, np.where(idle, 14, 5) * np.clip(since / 60, 0, 1), 0)
    stft = rng.normal(0, 2.0, n)

    fuel_rate = 0.7 + 0.0035 * rpm * load + rng.normal(0, 0.05, n)        # L/h
    drop = fuel_rate / 3600 / TANK_L * 100                               # % per second
    if fault == "fuel_leak":
        drop = drop + np.where(on, 0.012, 0)
    fuel = 42 - np.cumsum(drop)

    return pd.DataFrame({
        "t": np.arange(n), "speed_kph": speed, "rpm": rpm, "throttle_pct": throttle,
        "engine_load": load * 100, "coolant_c": coolant, "oil_pressure_bar": oil_p,
        "battery_v": batt, "ltft_pct": ltft, "stft_pct": stft, "fuel_rate_lph": fuel_rate,
        "fuel_level_pct": fuel, "ambient_c": ambient_c,
        "tyre_fl_psi": tyres[:, 0], "tyre_fr_psi": tyres[:, 1],
        "tyre_rl_psi": tyres[:, 2], "tyre_rr_psi": tyres[:, 3],
    })
