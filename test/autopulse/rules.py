"""Hard-limit safety rules. These never adapt and always tell the driver what to do now."""
from dataclasses import dataclass, field

import numpy as np

CRITICAL, WARNING, INFO = "critical", "warning", "info"
TYRES = {"tyre_fl_psi": "front-left", "tyre_fr_psi": "front-right",
         "tyre_rl_psi": "rear-left", "tyre_rr_psi": "rear-right"}


@dataclass
class Alert:
    severity: str
    title: str
    message: str
    actions: list = field(default_factory=list)
    nearest: str = ""        # maps search term for "nearest help"

    @property
    def maps_url(self):
        return f"https://www.google.com/maps/search/{self.nearest.replace(' ', '+')}+near+me" if self.nearest else ""


def _rate(series, window):
    s = np.asarray(series)[-window:]
    return (s[-1] - s[0]) / max(len(s) - 1, 1)


def _range(minutes):
    lo, hi = minutes * 0.7, minutes * 1.3
    return f"~{lo:.0f}-{hi:.0f} min"


def evaluate(df):
    """Run every rule on the telemetry seen so far (DataFrame, 1 Hz). Returns alerts, worst first."""
    if len(df) < 5:
        return []
    last = df.iloc[-1]
    alerts = []
    running = last.rpm > 500

    # tyres
    for col, name in TYRES.items():
        r = _rate(df[col], 20)
        if last[col] < 22 or r < -0.05:
            alerts.append(Alert(CRITICAL, f"Rapid pressure loss - {name} tyre",
                                f"{name.capitalize()} tyre at {last[col]:.0f} psi and falling {abs(r) * 60:.0f} psi/min.",
                                ["Slow down gradually, don't brake hard", "Hazard lights on",
                                 "Pull over somewhere safe and fit the spare / call for help"],
                                "tyre puncture repair"))
        elif last[col] < 29:
            alerts.append(Alert(WARNING, f"Low pressure - {name} tyre",
                                f"{name.capitalize()} tyre at {last[col]:.1f} psi (others ~{df[list(TYRES)].iloc[-1].median():.0f}).",
                                ["Top up at the next air pump", "Check for a nail if it keeps dropping"],
                                "air pump petrol pump"))

    # oil pressure: no range estimate, it is never safe to continue
    if running and last.oil_pressure_bar < 0.5:
        alerts.append(Alert(CRITICAL, "Oil pressure lost - STOP ENGINE NOW",
                            f"Oil pressure {last.oil_pressure_bar:.2f} bar at {last.rpm:.0f} rpm.",
                            ["Pull over and switch the engine off immediately",
                             "Do not restart - running without oil pressure destroys the engine in minutes",
                             "Check oil level when cool; arrange a tow"], "car mechanic"))

    # coolant / overheating
    t_rate = _rate(df.coolant_c, 30)
    v_rate = _rate(df.battery_v, 30)
    belt = running and last.battery_v < 13.0 and t_rate > 0.03 and last.coolant_c > 95
    if belt:
        alerts.append(Alert(CRITICAL, "Serpentine belt likely broken",
                            "Charging voltage and engine temperature are failing together - both are belt-driven.",
                            ["Pull over safely and switch the engine off",
                             "Steering may get heavy if power steering is belt-driven",
                             "Do not drive on: engine will overheat"], "car mechanic"))
    elif last.coolant_c > 112:
        alerts.append(Alert(CRITICAL, "Engine overheating",
                            f"Coolant at {last.coolant_c:.0f} C.",
                            ["Pull over and switch the engine off",
                             "Do NOT open the radiator cap while hot",
                             "Check coolant level after 30 min"], "car mechanic"))
    elif last.coolant_c > 103 or (last.coolant_c > 95 and t_rate > 0.04):
        mins = (115 - last.coolant_c) / max(t_rate, 1e-3) / 60
        alerts.append(Alert(WARNING, "Engine running hot - possible coolant leak",
                            f"Coolant {last.coolant_c:.0f} C, rising {t_rate * 60:.1f} C/min. "
                            f"Estimated time to critical: {_range(mins)}.",
                            ["Turn the AC OFF (reduces engine load)",
                             "Heater to MAX HOT, fan full - dumps engine heat into the cabin",
                             "Drive gently to the nearest mechanic, avoid idling in traffic"], "car mechanic"))

    # charging
    if running and not belt and last.battery_v < 13.0 and df.battery_v.iloc[-20:].max() < 13.2:
        soc = np.clip((last.battery_v - 11.8) / (12.6 - 11.8), 0, 1)
        usable_ah = 45 * 0.5 * soc
        mins_all = usable_ah / 30 * 60      # ~30 A with AC blower, lights, infotainment
        mins_min = usable_ah / 12 * 60      # ~12 A with non-essentials off
        alerts.append(Alert(WARNING, "Battery not charging (alternator)",
                            f"System voltage {last.battery_v:.1f} V while running. Driving time left on battery: "
                            f"{_range(mins_all)}, or {_range(mins_min)} with non-essentials off.",
                            ["Switch off AC blower, rear defogger, seat heaters, infotainment",
                             "Don't switch the engine off until you reach help - it may not restart",
                             "Head to the nearest workshop now"], "car battery alternator repair"))

    # fuel leak: level dropping much faster than the fuel actually burned
    if len(df) > 120:
        w = df.iloc[-120:]
        burned = (w.fuel_rate_lph / 3600).sum() / 45 * 100
        lost = w.fuel_level_pct.iloc[0] - w.fuel_level_pct.iloc[-1]
        if lost > 3 * burned + 0.3:
            alerts.append(Alert(CRITICAL, "Possible fuel leak",
                                f"Fuel level fell {lost:.1f}% in 2 min but the engine only burned {burned:.2f}%.",
                                ["Stop in a safe open area, engine off", "Do not restart, no smoking/flames",
                                 "Move away from the car and call for help"], "car mechanic"))

    # softer rule-based findings
    if running and last.speed_kph < 2 and last.ltft_pct > 10:
        alerts.append(Alert(INFO, "Engine running lean at idle",
                            f"Long-term fuel trim +{last.ltft_pct:.0f}% at idle - typical of an intake vacuum leak.",
                            ["Book an inspection for intake hoses / gaskets"], "car mechanic"))
    if last.t > 300 and last.coolant_c < 75:
        alerts.append(Alert(INFO, "Engine not reaching temperature",
                            f"Coolant only {last.coolant_c:.0f} C after {last.t / 60:.0f} min - thermostat may be stuck open.",
                            ["Higher fuel use and weak cabin heating until fixed", "Replace thermostat at next service"]))
    range_km = last.fuel_level_pct / 100 * 45 / 6.5 * 100
    if range_km < 60:
        alerts.append(Alert(INFO, "Low fuel", f"Estimated range ~{range_km:.0f} km.",
                            ["Refuel soon"], "petrol pump"))

    order = {CRITICAL: 0, WARNING: 1, INFO: 2}
    return sorted(alerts, key=lambda a: order[a.severity])
