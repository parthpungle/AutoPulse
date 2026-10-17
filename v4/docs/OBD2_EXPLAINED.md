# OBD-II explained

What the port in every modern car can tell us, what it cannot, and why AutoPulse adds sensors. Written for the AutoPulse report.

**Start here:** [README](../README.md) · [Setup](SETUP.md) · [Architecture](ARCHITECTURE.md) · [docs index](README.md)

---

## 1. What it is

**OBD-II (On-Board Diagnostics, 2nd generation)** is a standard built into every modern car's engine computer (ECU). The ECU constantly watches the engine and emission parts. It stores fault codes when something goes wrong, turns on the **Check Engine light (MIL)**, and serves live sensor readings to anyone who plugs into the **OBD-II port**.

- **Where it's mandatory:** USA since 1996, Europe (EOBD) since 2001 petrol / 2004 diesel. **India: BS-VI (April 2020)** made OBD-II mandatory, and **BS-VI Phase 2 (April 2023)** tightened real-time emission monitoring. So practically every Indian car sold since 2020 has it, and many older ones do too.
- **Why it exists:** emissions law. That's why it's great for engine and emission data but weak on brakes, tyres and suspension (section 6).

---

## 2. The port (SAE J1962, 16 pins)

It's found under the dashboard, near the steering column, usually within ~60 cm of the driver.

| Pin | Purpose |
|---|---|
| 16 | +12 V battery (always on, so a dongle can be powered without the key) |
| 4, 5 | Chassis ground, signal ground |
| **6, 14** | **CAN-High / CAN-Low** (ISO 15765-4), used by almost all cars made after ~2008 |
| 7, 15 | K-line / L-line (ISO 9141-2, ISO 14230 KWP2000), older European/Asian cars |
| 2, 10 | SAE J1850 PWM/VPW, older Ford/GM |
| others | Manufacturer-specific (often extra CAN buses) |

**Reading it:** plug in an **ELM327 Bluetooth/Wi-Fi dongle** (~₹400–1,500; better ones like OBDLink/Veepeak ~₹3–8k). Then read it from a phone app (Car Scanner, Torque) or Python (**python-OBD**).

---

## 3. The 10 "services" (modes), what each one checks

| Service | Name | What you get | AutoPulse use |
|---|---|---|---|
| **01** | Current data | Live sensor values (PIDs, next section) | Live telemetry, baseline learning |
| **02** | Freeze frame | Snapshot of sensors at the moment a fault code was set | Context of past faults |
| **03** | Stored DTCs | Confirmed fault codes (P0301…) | Startup scan |
| **04** | Clear DTCs | Erases codes, turns off MIL, resets monitors | (Only on user request) |
| 05 | O2 sensor test results | Older non-CAN cars only | — |
| **06** | **On-board monitor test results** | The ECU's own self-test numbers with min/max limits: **misfire counts per cylinder**, catalyst efficiency, EVAP leak test, O2 sensor response… | **Gold for wear trends.** You see a value creeping toward its limit *before* a code is set |
| **07** | Pending DTCs | Faults seen once but not confirmed yet | Early warning |
| 08 | Control on-board system | Lets a tool command tests (e.g. EVAP leak test) | Active scans (where supported) |
| **09** | Vehicle info | VIN, calibration IDs, in-use monitor counters | Identify the car → load right baseline |
| **0A** | Permanent DTCs | Codes that can't be cleared until the ECU itself confirms the fix | Detect "codes cleared to hide a fault" |

---

## 4. Key live PIDs (Service 01)

Not every car supports every PID. **PID 0x00/0x20/0x40…** returns a bitmask of which ones the car supports, so the app must auto-detect.

| PID | Signal | What it tells us |
|---|---|---|
| 01 | Monitor status | MIL on/off, number of DTCs, readiness of each monitor |
| 04 | Calculated engine load | Context (how hard the engine is working) |
| **05** | **Coolant temperature** | Warm-up curve (thermostat), overheating, coolant leak |
| **06–09** | **Short/Long-term fuel trims** (bank 1/2) | Vacuum leaks, injector/fuel-pump problems, MAF drift |
| 0A / 22 / 23 | Fuel pressure / fuel rail pressure | Fuel pump & filter health |
| **0B** | **Intake manifold pressure (MAP)** | Engine "vacuum" at idle: low or unsteady means valve/ring/leak issues |
| **0C** | **Engine RPM** | Everything is indexed by RPM |
| 0D | Vehicle speed | Context, range estimates |
| 0E | Timing advance | Drops when ECU retards timing because of **knock** |
| 0F / 46 | Intake air temp / ambient temp | **Context for season and cold starts** |
| **10** | **MAF air flow** | Air filter clogging, sensor plausibility |
| 11 / 45 / 49 / 5A | Throttle / pedal position | Driver demand, context |
| 14–1B, 24–2B, 34–3B | O2 / wideband sensors | Combustion quality, catalyst health |
| 1F | Run time since start | Cold-start vs. warm phases |
| 21 / 31 | Distance with MIL on / since codes cleared | Fault history |
| **2F** | **Fuel level** | Range; **fuel leak = level dropping faster than fuel used** |
| 32 | EVAP vapour pressure | Fuel-vapour leak test (the pressure-decay idea) |
| 33 | Barometric pressure | Altitude context |
| 3C–3F | Catalyst temperature | Catalyst health, misfire damage |
| **42** | **Control module voltage** | Battery/alternator health, charging problems |
| 44 | Commanded equivalence ratio | Rich/lean commands |
| 5C | Engine oil temperature | Oil ageing, cooling (not all cars) |
| 5E | Fuel rate | Consumption → range; fuel-leak cross-check |

---

## 5. Readiness monitors (the ECU's own built-in health checks)

| Type | Monitors |
|---|---|
| **Continuous** (always running) | Misfire, Fuel system, Comprehensive components (sensor circuits in range) |
| **Non-continuous** (run under specific conditions) | Catalyst, Heated catalyst, **EVAP (leak test)**, Secondary air, O2 sensor, O2 heater, EGR/VVT |
| Diesel-specific | NMHC catalyst, NOx/SCR, Boost pressure, Exhaust gas sensor, **DPF (particulate filter)** |

**DTC format**, e.g. `P0301`:
- 1st char: **P**owertrain / **B**ody / **C**hassis / **U** network
- 2nd: 0 = generic, 1 = manufacturer
- 3rd: subsystem (3 = ignition/misfire, 1–2 = fuel & air, 4 = emissions, 5 = speed/idle/voltage, 7–9 = transmission)
- Last 2: specific fault

Common ones we care about: P0300–P0308 (misfire), P0171/P0174 (lean = vacuum leak), P0128 (thermostat), P0420 (catalyst), P0442/P0455/P0456 (EVAP leaks), P0016 (crank–cam correlation = timing chain), P0325 (knock sensor), P0562 (low system voltage), P0520–P0524 (oil pressure).

---

## 6. Limits of OBD-II, and why we add sensors

| Limit | Consequence | Our answer |
|---|---|---|
| **Slow:** request-response over an ELM327 gives roughly **5–20 readings per second in total**, shared across all PIDs | Fine for temperatures/trims, **useless for sound/vibration signatures** that need 10,000–48,000 samples/s | Microphone + accelerometer (phone or clip-on) |
| **Emission-focused only** | No standard PIDs for brakes, tyres (TPMS), ABS wheel speeds, oil pressure, battery current, airbag | Manufacturer-specific queries (UDS service 0x22) or passive CAN sniffing with DBC files (opendbc); otherwise add cheap sensors |
| Codes appear **only after** a fault crosses a hard threshold | Late warning | Our ML watches Mode 06 values and trends *before* codes appear |
| Coverage varies by car | Some PIDs missing | Auto-detect supported PIDs; models degrade gracefully |
| Security gateways on some newer cars | Restricted access beyond generic OBD | Stick to generic read-only services |
| Dongle left plugged in draws small current; can write to CAN | Battery drain / safety | Read-only software, sleep mode, recommend quality adapters |

---

## 7. Beyond generic OBD-II (where cars allow it)

- **UDS (ISO 14229), service 0x22 ReadDataByIdentifier:** manufacturer data like oil pressure, per-cylinder knock retard, transmission temperature, battery sensor (IBS) state of charge, TPMS values.
- **UDS service 0x19:** read **B/C/U codes** from ABS, airbag, body and TPMS modules, not just the engine.
- **Passive CAN listening:** decode broadcast messages (wheel speeds, steering angle, brake pressure, yaw) using community DBC files (**opendbc**). This is how comma.ai's openpilot reads cars.
