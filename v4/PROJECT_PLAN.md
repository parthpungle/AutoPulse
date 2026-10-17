# AutoPulse — Multi-Sensor Signature Analytics for Predictive Vehicle Health

**Start here:** [README](README.md) · [Setup](docs/SETUP.md) · [Architecture](docs/ARCHITECTURE.md) · [Walkthrough](docs/WALKTHROUGH.md)

> **Original title (Honeywell):** *Operation with multivariable data – Automobile engine data: Signature extraction and Pattern recognition*
>
> **Proposed name:** **AutoPulse** (other options: *EngineSense*, *VitalDrive*, *CarDoc AI*, *SigNet Auto*)
> **Tagline:** *Your car's heartbeat, read by 15+ sensors, decoded by DSP + ML, explained on one screen.*

---

## 0. TL;DR

- **What the problem statement actually asks for** (in priority order):
  1. **Signature extraction (the DSP part).** Take raw sensor streams (sound, vibration, current, OBD telemetry), pull out time-domain, frequency-domain (FFT) and time-frequency (STFT) "fingerprints". This is the core of the title, and most teams underdo it.
  2. **Pattern recognition (the ML part).** Three separate jobs:
     - **Normal baseline:** learn what a healthy engine looks like (anomaly detection, trained on healthy data only).
     - **Component wear:** spot slow degradation trends and estimate remaining useful life (RUL).
     - **Real-time fault ID:** classify the fault right now (misfire, knock, valve train wear, and so on) with **CNN / SVM / ANN + Softmax**.
  3. **Dashboard:** multivariable sensor data, its time and frequency signatures, and the recognized patterns, all in one UI.
- **Data comes from simulation and public datasets.** You don't build hardware. The "affordable sensor suite" is a design argument (a bill of materials plus reasons) that backs up the software.
- **Your "pressure sensor instead of a gas sensor" idea is correct and already used in industry.** OBD-II EVAP leak detection does exactly this with pressure/vacuum decay. Section 4 lists 15 more tricks like it ("virtual sensing").
- **The baseline adapts (section 1A).** AutoPulse learns *this* car's normal per context (cold start vs. warm, season, load). It treats slow ageing as **wear** (shown like phone battery health) and only flags sudden or abnormally fast changes as **anomalies**.
- **Hard limits never adapt (section 1B).** Puncture, oil pressure, overheating, charging failure and fuel leaks trigger fixed rules with **what to do now** (AC off, heater on, time left, nearest shop).
- **Reuse, don't customise (section 3).** Tier 0 is the car's OBD-II port, Tier 1 is the driver's phone, Tier 2 is a cheap clip-on kit. OBD-II details are in [docs/OBD2_EXPLAINED.md](docs/OBD2_EXPLAINED.md).
- **Data:** generated + public + a little of our own (section 7.0). **Python first; Simulink optional** (section 13A).

---

## 1. What the problem statement asks vs. your understanding

| Your understanding | Verdict | Notes |
|---|---|---|
| "10+ sensors onboard, detect failures, show smartly on a dashboard" | ✅ Right direction | The PS names 3 data families: **acoustic (mic)**, **vibration (accelerometer)**, **ECU/OBD-II/CAN telemetry** (RPM, coolant temp, throttle, fuel trims). Going past 10 is fine as long as those 3 stay the core. |
| "Like Tesla startup checks" | ⚠️ Partly | Tesla is an **EV with no IC engine**, so there are no knock, misfire or valve sounds. Copy Tesla's **UX** (pre-drive health check, alerts with severity and action, remote diagnostics), not its sensors. The PS is **IC-engine-centric**. |
| "Whole-car health: brakes, tyres, battery, everything" | ⚠️ Scope creep (but OK as stretch) | Graders will check **engine signatures + ML**. Do the engine deeply first. Add tyres/brakes/battery as **Tier-2 modules**, mostly through cheap virtual sensing. |
| "Hardware limitation not an issue, but affordable" | ✅ with a twist | **Resources Needed** = Simulink/MATLAB or synthetic/open data. You won't wire sensors, you'll **simulate** them. Affordability shows up as a BOM table and a "uses sensors the car already has" argument. |
| "List F1 sensors" | ✅ Useful for inspiration | F1 carries ~150–300 sensors. What to borrow: **sensor fusion, plausibility checks, component-life tracking, telemetry dashboards**. Not the hardware. |
| (missing) | ❗ You didn't mention | **FFT/STFT signature extraction** is a required skill and half the title. **Softmax regression** (= multinomial logistic regression) is named explicitly, so use it as a baseline and output layer. **Wear prediction** is a separate ML task from fault classification. |

---

## 1A. Core idea: an adaptive health model that learns *this* car's normal

A fixed "healthy" baseline is wrong for real cars. Engines age, a winter cold start sounds different from a summer idle, and every car of the same model is slightly different. Like phone battery health, some decline is **normal and expected**. AutoPulse therefore learns what is normal **for this car, in this context, at this age**, and alerts only on behaviour that doesn't fit.

### Three layers of "normal"

| Layer | Learned from | Purpose |
|---|---|---|
| **1. Population prior** | Public datasets + our synthetic data (all engines of this type) | Works on day 1. Catches faults that were **already there when installed**, which a car-specific baseline would wrongly learn as "normal". |
| **2. Car-specific baseline** | First ~10 drives / ~2 weeks of *this* car (calibration period), then updated continuously | Personal fingerprint: this engine's idle sound, vibration, warm-up curve, trims |
| **3. Context-conditional normal** | Same data, split by context | "Normal" depends on conditions; it isn't one number |

**Context vector** (what normal depends on): ambient temperature, coolant temperature (cold start vs. warm), RPM band, engine load, AC on/off, gear, altitude (baro), fuel level, time since start, road roughness (IMU).

So a cold start at 8 °C is compared with **past cold starts at similar temperatures**, not with last week's warm idle. Seasons are handled naturally because ambient temperature is part of the context.

### Wear vs. anomaly: two different things

| | **Wear (expected ageing)** | **Anomaly (something broke)** |
|---|---|---|
| Shape | Slow, smooth, one-directional drift | Sudden step change, or drift **faster than the expected wear rate** |
| Example | Battery cranking voltage dips 0.05 V more each month | Cranking dip jumps 0.6 V overnight |
| Detection | Trend fit (health index vs. time/km), compared with the population's normal ageing rate | Change-point detection (CUSUM, Page-Hinkley, Bayesian online change-point), anomaly score vs. context baseline |
| Shown as | **Health % bars**, like phone battery health ("Battery 82% · est. replace in ~7 months") | **Alert card** with severity, likely cause and action |

### How the baseline updates safely (so it doesn't learn faults as normal)

1. **Update only on healthy windows.** Data with a high anomaly score is never added to the baseline.
2. **Slow learning rate** (exponentially-weighted statistics / periodic retraining). Normal changes over weeks; a fault changes in minutes to days.
3. **Freeze while an anomaly is open.** Re-learning resumes only after the user marks it fixed or the signal recovers.
4. **Rate cap.** If the baseline is drifting faster than the population's normal ageing rate, that drift is itself flagged as wear-out.
5. **Anchored to the population prior.** The car baseline can't drift arbitrarily far from what any healthy engine of this type does.
6. **Hard limits never adapt** (section 1B). An oil-pressure floor stays fixed no matter what.
7. **Reset events.** After a service (oil change, new battery, new tyres) the user taps "serviced" and that component's baseline is re-learned.

### Models for this

- **Per-context anomaly detection:** autoencoder / Gaussian model on signature features (or CNN embeddings). The score is the distance from this car's baseline in the matching context bin.
- **Classifier** (CNN / SVM / ANN + Softmax, as the PS requires) names the fault once an anomaly fires.
- **Health index + RUL** per component: degradation curve fit or LSTM.
- **Where it runs:** simple statistics (EWMA, z-scores, small models) on the phone/edge, with heavier periodic retraining offline.

---

## 1B. Hard limits & driver guidance: rules that never adapt

Some conditions are dangerous no matter what the car's "normal" is. A **rule engine** sits above the ML. It doesn't learn, it doesn't wait for confidence, and it tells the driver **what to do right now**, using the phone's GPS for location help (nearest fuel / tyre shop / mechanic via OpenStreetMap or Google Places).

| Condition | Detected by | Severity | What AutoPulse tells the driver |
|---|---|---|---|
| **Tyre puncture / rapid pressure loss** | TPMS drop rate, or sudden wheel-speed mismatch (indirect TPMS) | 🔴 Critical | "Rapid pressure loss front-left. Slow down, hazards on, pull over safely." Shows **nearest tyre/puncture shop** with distance and a call button |
| Slow tyre leak | Pressure trend over days | 🟠 Warning | "Front-left losing ~2 psi/day. Top up; nearest air pump 1.2 km" |
| **Low oil pressure** | Oil pressure vs. RPM | 🔴 Critical | "**Stop the engine now.** Driving on can destroy the engine within minutes." No range shown, because it isn't safe |
| **Overheating / coolant leak** | Coolant temp level + rate of rise | 🟠→🔴 | "Turn **AC off**, set **heater to max hot, fan full** (moves engine heat into the cabin), drive gently." Shows **estimated time before critical temperature** from the current rise rate, plus the nearest mechanic. Over the red line: "Pull over, engine off, don't open the radiator cap while hot" |
| **Alternator / charging failure** | Battery voltage < ~13 V while running | 🟠 Warning | "Battery not charging. About **X min** of driving left on battery. Switch off AC blower, rear defogger, seat heaters, infotainment; don't stop the engine; nearest workshop Y km." X = remaining battery capacity ÷ estimated electrical load |
| **Serpentine belt likely broken** | Voltage falling **and** coolant temp rising together (both are belt-driven on many engines) | 🔴 Critical | "Multiple belt-driven systems failing. Pull over." A good example of multi-sensor reasoning |
| **Liquid fuel leak** | Fuel level dropping faster than integrated fuel rate (PID 2F vs 5E) | 🔴 Critical | "Possible fuel leak. Stop, engine off, don't restart, move away from the car" |
| Small EVAP leak | EVAP pressure-decay result / P0442/P0456 | 🟡 Info | "Check the fuel cap is tight" |
| **Severe misfire** (catalyst damage risk) | Misfire rate high (Mode 06 / crank speed) | 🟠 Warning | "Reduce speed and load, avoid highway, go to a mechanic. Continued driving can damage the catalytic converter" |
| **Brake effectiveness drop / brake fluid low** | Decel vs. brake pressure; fluid level switch | 🔴 Critical | "Braking weaker than normal. Increase following distance, drive to service immediately" |
| **CO in cabin** | Cabin CO sensor | 🔴 Critical | "Open windows now, pull over, switch engine off" |
| **Low fuel** | Fuel level ÷ recent consumption | 🟡 Info → 🟠 | "Range ~35 km. Nearest fuel stations: …" |
| Heavy knock | Knock band energy / timing retard | 🟠 Warning | "Reduce load; check fuel grade" |

**Range/time estimates are shown as ranges with a margin** (e.g. "~15–25 min"), never as a single promise, because they are extrapolations.

---

## 2. What can go wrong in a normal (IC-engine) car: failure → sensor map

Legend: 🟢 = sensor already in almost every modern car (read through OBD-II/CAN, ~₹0 extra) · 🟡 = cheap add-on · 🔴 = expensive / optional

### 2.1 Engine (core scope, matches the PS)

| Failure | Where | Symptom / physics | Sensor(s) | Signature to extract | ML |
|---|---|---|---|---|---|
| **Misfire** (plug, coil, injector) | Cylinder | Missing combustion impulse → crankshaft slows for one firing event | 🟢 Crank position (60-2 tooth wheel), 🟡 block accelerometer, 🟡 mic | Crank angular-acceleration dips per cylinder; **0.5 engine-order** peak in order spectrum (4-stroke, single-cylinder misfire); lumpy exhaust note | 1D-CNN on crank speed / 2D-CNN on spectrogram; SVM on order features |
| **Knock / detonation** | Combustion chamber | Pressure wave resonates in the cylinder at ~5–20 kHz (≈6–7 kHz for an 86 mm bore, Draper's formula) shortly after TDC | 🟢 Knock sensor (piezo), 🟡 mic, 🟡 accelerometer | Band energy at the knock resonance in a **crank-angle window** after TDC; STFT bursts | CNN on STFT; threshold + SVM |
| **Valve train wear / tappet tick** | Cylinder head | Excess lash → metallic impact once per cam revolution | 🟡 Mic, 🟡 head accelerometer | Impulses at **cam order (0.5×)** with a high-frequency ring (2–10 kHz); high kurtosis; envelope spectrum | CNN (mel-spectrogram), anomaly AE |
| **Timing chain/belt stretch** | Front of engine | Cam lags the crank | 🟢 Cam + crank position | **Cam–crank phase drift** over weeks | Trend / RUL regression |
| **Vacuum / intake leak** | Intake manifold | Unmetered air → ECU adds fuel | 🟢 MAF/MAP, 🟢 O2, 🟢 fuel trims (STFT/LTFT) | LTFT strongly positive at idle, normalising under load | Rules + gradient boosting / SVM |
| **Clogged air filter** | Airbox | Restriction at high flow | 🟢 MAF vs. RPM/load model | MAF lower than expected at high RPM (residual) | Regression residual → anomaly |
| **Injector clog / leak** | Fuel rail | Lean/rich on one cylinder | 🟢 Fuel trims, 🟢 crank speed, 🟢 fuel rail pressure | Per-cylinder roughness + trim drift | Classifier |
| **Fuel pump wear / filter clog** | Fuel tank/line | Can't hold rail pressure | 🟢 Fuel rail pressure, 🟡 pump current | Pressure drop under load; current ripple from the pump commutator | Anomaly + RUL |
| **Thermostat stuck open/closed** | Cooling | Slow warm-up / overheating | 🟢 Coolant temp (ECT) | **Warm-up curve shape** (time to 85 °C vs. ambient & load) | Curve-fit residual |
| **Water pump / coolant leak** | Cooling | Rising temp, falling level | 🟢 ECT, 🟡 coolant level / pressure | ECT vs. load model residual; pressure decay when cold | Anomaly |
| **Low oil pressure / pump or bearing wear** | Lubrication | Oil pressure drops vs. RPM & oil temp | 🟢/🟡 Oil pressure sensor | Pressure-vs-RPM-vs-temp surface drifting down | RUL (EngineAD-style) |
| **Oil degradation** | Sump | Viscosity/dielectric change | 🔴 Oil quality sensor *or* 🟢 virtual "oil-life" model (revs × temp × cold starts) | Degradation index | Regression |
| **Engine mount failure / imbalance** | Mounts | More cabin vibration at 1× / 2× order | 🟡 Accelerometer (body side), 🟢 IMU | 1× / 2× order amplitude ratio body/engine | SVM |
| **Belt squeal / tensioner / pulley bearing** | Accessory drive | Slip → narrowband squeal; bearing → defect frequencies | 🟡 Mic, 🟡 accelerometer | 2–5 kHz tonal squeal on cold start; envelope spectrum peaks | CNN |
| **Catalytic converter failure** | Exhaust | Downstream O2 copies upstream | 🟢 Upstream + downstream O2 | Switching-ratio / cross-correlation of the two O2 signals | Rule + classifier |
| **Exhaust leak** | Manifold/pipe | Ticking at firing frequency, false lean O2 | 🟡 Mic, 🟢 O2 | Firing-order impulses + O2 bias | CNN |
| **Turbo wear** (if turbo) | Turbo | Whistle/whine, boost shortfall | 🟢 Boost (MAP), 🟡 mic | Boost-vs-demand residual; high-frequency tonal at shaft speed | Anomaly |

### 2.2 Electrical (Tier 2, cheap and high value)

| Failure | Sensor | Smart signature |
|---|---|---|
| **12 V battery ageing** | 🟢 Battery voltage (OBD PID), 🟡 current sensor / IBS | Cranking voltage dip depth & recovery; resting voltage; internal resistance = ΔV/ΔI during cranking |
| **Starter motor wear** | 🟡 Battery current (Hall / shunt) | Cranking current peak and duration |
| **Low compression in one cylinder** | 🟡 Battery current during cranking | **"Relative compression test":** current ripple has one hump per compression stroke, so a weak cylinder shows a smaller hump (real technique used with PicoScope) |
| **Alternator diode / regulator failure** | 🟢 Battery voltage sampled fast (≥10 kHz) | AC ripple pattern on the DC bus: a failed diode changes the ripple shape & frequency |
| **Parasitic drain** | 🟡 Current sensor | Key-off current > ~50 mA after sleep |

### 2.3 Chassis (Tier 2)

| Failure | Sensor | Smart signature |
|---|---|---|
| **Low tyre pressure** | 🟢 ABS wheel-speed sensors (indirect TPMS) or 🟡 direct TPMS | Under-inflated tyre → smaller rolling radius → spins faster |
| **Tyre wear** | 🟢 Wheel speed + GPS speed | Rolling-radius drift over months |
| **Wheel bearing wear** | 🟢 Wheel speed, 🟡 hub accelerometer / mic | Hum rising with speed; bearing defect frequencies (BPFO/BPFI) in envelope spectrum |
| **Brake pad wear** | 🟢/🟡 Pad wear sensor; 🟢 brake pressure + IMU decel | Deceleration per unit brake pressure falling = fading / glazed pads |
| **Damper (shock) wear** | 🟢 IMU (ESC/airbag module), 🟡 hub accelerometers | Body bounce decay after bumps (damping ratio estimate) |
| **Wheel misalignment** | 🟢 Steering angle + yaw rate | Steering offset needed to drive straight |

### 2.4 Safety / cabin

| Failure | Sensor | Note |
|---|---|---|
| **Fuel vapour leak** | 🟢 **EVAP pressure sensor** | Seal the system, pressurise or pull a vacuum, watch decay. OBD-II already must detect 0.020" leaks. **Your idea.** |
| **Exhaust gas (CO) entering cabin** | 🟡 CO sensor | Keep this one as a real sensor: it protects people, and you can't infer it from pressure. |

---

## 3. The proposed sensor suite: reuse first, add only what's missing

**Principle:** no custom F1-style sensors. ~70% of the sensing already exists in the car (read through OBD-II, see [docs/OBD2_EXPLAINED.md](docs/OBD2_EXPLAINED.md)). The rest comes from **off-the-shelf parts people already own or can buy anywhere**, starting with the driver's **smartphone**.

### 3.1 Sensor tiers (report-ready)

| Tier | What | Cost to user | Sensors | What it unlocks |
|---|---|---|---|---|
| **Tier 0: the car itself** | OBD-II port + ₹400–1,500 ELM327 dongle | ~₹1k | Crank/RPM, coolant temp, MAP, MAF, throttle, O2, fuel trims, fuel level, fuel rate, EVAP pressure, battery voltage, intake/ambient temp, timing advance, DTCs, Mode 06 self-tests | Engine/emission health, thermostat, vacuum leaks, misfire counts, charging, range, fuel-leak cross-check |
| **Tier 1: the driver's phone** | Phone in the dash mount + AutoPulse app | ₹0 | **Microphone** (cabin-side engine sound), **accelerometer + gyro** (vibration, ride, braking decel), **GPS** (speed, location, nearest help), **camera** (optional: tyre-tread photo check, dashboard warning-light recognition) | Sound signatures, vibration vs. RPM, wheel imbalance, braking effectiveness, location guidance |
| **Tier 2: clip-on kit** (optional, all off-the-shelf) | Fitted in ~15 min, no wiring into car electronics | ~₹4–10k | **Engine-bay MEMS mic** (INMP441), **magnetic-mount accelerometer** on the engine block (ADXL345/ADXL1002), **BLE battery monitor** clip (common ~₹1.5k product) or Hall current sensor, **BLE valve-cap TPMS** (~₹2.5–4k set), **cabin CO sensor**, ESP32-S3 hub | Clean high-frequency engine sound/vibration (knock, tappet, bearings), cranking analysis & relative compression, exact tyre pressures, CO safety |
| **Tier 3: advanced** (fleet / premium) | Workshop-grade | ₹10k+ | Oil-quality sensor, UDS/CAN decoding for ABS wheel speeds & brake pressure, IR temperature sensors | Oil ageing, chassis health without extra sensors |

**Why this is affordable:** Tier 0 + Tier 1 already cover most failure modes for about the price of the dongle. Tier 2 sharpens the signatures. Nothing is custom-made, so it works on almost any post-2010 car.

### 3.2 Scans (the "startup check", plus continuous checks)

| Scan | When | Duration | What it checks | Data used |
|---|---|---|---|---|
| **1. Key-on pre-check** | Ignition on, before crank | ~3 s | Stored/pending/permanent DTCs, readiness monitors, resting battery voltage (state of charge), fuel level, tyre pressures | OBD 01/03/07/0A, TPMS |
| **2. Crank scan** | During cranking | ~1–2 s | Cranking voltage dip & recovery (battery health), crank duration (starter), **relative compression per cylinder** from current/voltage ripple | Battery monitor / fast voltage |
| **3. Cold-start idle scan** | First ~60 s | 60 s | Idle RPM stability, cold-start sound signature vs. this car's past cold starts at similar temperature (tappet tick that should fade, belt squeal), vibration | Mic, accelerometer, RPM, ambient temp |
| **4. Warm-up scan** | First ~5–10 min | passive | Coolant warm-up curve (thermostat), O2 sensor coming online | ECT, O2 |
| **5. Warm idle scan** | At traffic lights, when warm | passive | Fuel trims, manifold vacuum steadiness, O2 switching, idle sound/vibration fingerprint | MAP, trims, O2, mic, accel |
| **6. Driving scans** | Continuously while driving | passive | Misfire (crank + Mode 06), knock, power vs. load, braking effectiveness, wheel-speed / tyre checks, vibration vs. speed (wheel balance), charging voltage | All |
| **7. Shutdown scan** | Engine off | ~30 s + sleep | Charging voltage just before shutdown, key-off battery drain after the car sleeps, EVAP test results | Voltage, OBD |
| **8. Guided "rev test"** (on demand) | User-triggered, parked | ~45 s | App guides: "hold 1,500 rpm… now 2,500 rpm…" for a clean, repeatable sound/vibration recording at fixed RPM, like a mechanic listening | Mic, accel, RPM |
| **9. Weekly health report** | Background | — | Wear trends, health % per component, Mode 06 values drifting toward limits | History |

The **startup screen** shows scans 1–3 as a Tesla-style animation: car silhouette, each subsystem ticks green / amber / red, then the overall health score.

### 3.3 Full sensor reference

| # | Sensor | Already in car? | Sample rate needed | Detects | Approx. add-on cost |
|---|---|---|---|---|---|
| 1 | Crankshaft position (Hall/VR, 60-2) | 🟢 | per tooth (~6 kHz at 6000 rpm) | Misfire, RPM, rough running | ₹0 (needs fast CAN/ECU access; OBD gives misfire counters) |
| 2 | Camshaft position | 🟢 | per tooth | Timing chain stretch, cam phasing | ₹0 |
| 3 | Knock sensor (piezo) | 🟢 | 20–50 kHz (ECU-internal) | Detonation | ₹0 (via ECU knock retard PID) |
| 4 | MAF / MAP | 🟢 | 10–100 Hz | Intake leaks, clogged filter, load | ₹0 |
| 5 | Upstream + downstream O2 & fuel trims | 🟢 | 10 Hz | Vacuum leak, injectors, catalyst | ₹0 |
| 6 | Coolant temperature | 🟢 | 1 Hz | Thermostat, overheating | ₹0 |
| 7 | Throttle / pedal position | 🟢 | 10–50 Hz | Context (load), drive behaviour | ₹0 |
| 8 | Oil pressure (+ oil temp) | 🟢/🟡 | 1–10 Hz | Pump & bearing wear | ₹0–1,500 |
| 9 | Fuel rail pressure | 🟢 | 10–100 Hz | Pump/filter/regulator | ₹0 |
| 10 | EVAP pressure | 🟢 | 1 Hz (during test) | Fuel vapour leaks | ₹0 |
| 11 | Battery voltage (fast) + current (Hall, e.g. ACS758 / shunt + INA226) | 🟡 | 10 kHz | Battery SOH, starter, alternator, relative compression | ~₹800–1,500 |
| 12 | ABS wheel-speed ×4 | 🟢 | 100 Hz+ | Indirect TPMS, tyre wear, bearings | ₹0 |
| 13 | IMU (ESC/airbag module) | 🟢 | 100 Hz | Dampers, alignment, context | ₹0 |
| 14 | **Engine-bay MEMS microphone** (e.g. INMP441 I²S) | 🟡 | 16–48 kHz | Knock, tappet, belt, exhaust leak, bearings | ~₹300–600 |
| 15 | **Block-mounted accelerometer** (ADXL1002/ADXL1005 high-bandwidth, or ADXL345 low-cost) | 🟡 | 10–50 kHz | Misfire, mounts, imbalance, bearings, valve train | ~₹500–4,000 |
| 16 | Direct TPMS (optional) | 🟢 in many cars | 1 Hz | Exact tyre pressure/temp | ~₹3,000–6,000 set |
| 17 | Cabin CO sensor | 🟡 | 1 Hz | Exhaust ingress safety | ~₹300–800 |
| 18 | Edge computer (ESP32-S3 for audio/vibe + Raspberry Pi / phone) + ELM327 / CAN interface | 🟡 | — | Runs DSP + ML on-device | ~₹1,500–6,000 |

**Approximate total add-on BOM: ₹5,000–15,000** (aftermarket kit) vs. F1's ~300 sensors. *(Prices are rough Indian retail ballparks, for the report's argument only.)*

---

## 4. Smart "virtual sensing" ideas (your pressure-sensor insight, generalised)

The idea is to infer a fault from physics using sensors you already have, instead of adding a dedicated sensor that can fail itself.

1. **EVAP pressure decay instead of a fuel-vapour gas sensor.** Seal, pressurise, time the decay. Leak size ∝ decay rate.
2. **Wheel speed instead of tyre pressure sensors (indirect TPMS).** Compare the 4 wheel speeds and learn per-tyre rolling radius.
3. **Cranking current instead of a compression gauge.** One current hump per compression stroke, so a weak hump means a weak cylinder.
4. **Battery-voltage ripple instead of an alternator tester.** Rectifier ripple shape reveals a dead diode.
5. **Crank speed instead of in-cylinder pressure sensors.** Per-cylinder angular acceleration gives misfire and cylinder imbalance (this is how OBD-II does misfire detection).
6. **Cam–crank phase instead of opening the timing cover.** Drift means chain stretch.
7. **Fuel trims instead of a smoke test.** Positive LTFT at idle that normalises at load points to a vacuum leak. Positive everywhere points to MAF/fuel delivery.
8. **Coolant warm-up curve instead of a thermostat test.** Fit a first-order model; a slow time constant means stuck open.
9. **Downstream-vs-upstream O2 correlation instead of a catalyst efficiency meter.**
10. **Brake pressure vs. IMU deceleration instead of pad thickness sensors** (brake effectiveness index).
11. **Oil pressure-vs-RPM-vs-temp surface instead of an oil-pump flow meter.** A slow downward drift means pump or bearing wear.
12. **Rolling radius vs. GPS instead of tread-depth sensors.**
13. **Analytical redundancy instead of duplicate sensors.** Predict MAF from MAP + RPM + TPS (speed-density model). If measured MAF disagrees, flag *the sensor itself* as faulty. This answers "what if the sensor fails?": the system checks its own sensors (F1 does the same with plausibility checks).
14. **Mic + accelerometer + RPM fusion through order tracking.** Resample audio/vibration by **crank angle** instead of time, so signatures stay sharp while RPM changes. This is the key DSP trick for engines.
15. **Body IMU bounce-decay instead of damper test rigs.**

---

## 5. What F1 cars carry, and what we borrow

An F1 car has roughly **150–300 sensors** (varies by team/track) and streams on the order of **~1 million data points per second** to the pit through a standard FIA ECU (supplied by McLaren Applied since 2008) and radio telemetry (real-time + burst downloads in the pit lane). The data flow from car to pit is **one-way** under current rules.

| Area | Sensor | How it works | What it measures |
|---|---|---|---|
| **Power unit** | Crank/cam speed (Hall / differential Hall) | Magnetic field change as teeth pass | RPM, position, misfire, torsional vibration |
| | Pressure transducers (oil, fuel, water, boost, hydraulics) | Piezoresistive/strain diaphragm, 0–5 V compensated output | Every fluid circuit's health |
| | Thermocouples (K-type) & PRTs | Seebeck voltage / resistance change | Exhaust gas temp, turbo, oil, water, brakes |
| | Knock / vibration accelerometers | Piezo | Detonation, mechanical health |
| | Turbo speed sensor | Eddy-current / magnetic pickup on compressor blades | Turbo RPM (>100k rpm) |
| | **FIA fuel-flow meter** | Ultrasonic time-of-flight | Instantaneous fuel flow (regulated limit) |
| | ERS: cell voltages, currents, temperatures, MGU-K speed/torque | Hall current sensors, thermistors | Hybrid system health |
| **Driveline** | **Driveshaft torque sensors** (FIA) | Strain gauges + wireless telemetry from rotating shaft | Torque delivered |
| | Gearbox position, oil temp/pressure | Potentiometers / Hall | Shift quality, wear |
| **Chassis** | Suspension displacement | Linear potentiometers / LVDTs on dampers | Suspension travel, platform |
| | **Laser ride-height** | Time-of-flight laser | Ground clearance at 100s of Hz (critical for ground-effect aero) |
| | Strain gauges on pushrods, wishbones, wings | Wheatstone bridge | Loads, aero loads |
| | IMU / accelerometers / gyros, GPS | MEMS | g-forces, yaw, position |
| **Tyres & brakes** | **TPMS** (FIA standard) | Rim-mounted pressure + temp, wireless | Tyre pressure & gas temp |
| | IR tyre surface/carcass sensors, IR thermal cameras | Thermopile arrays pointed at tread | Multi-zone tyre temperature (inner/middle/outer) |
| | Brake disc IR / thermocouples, brake pressure | IR / piezoresistive | Brake temps, balance |
| **Aero** | Pitot tubes, Kiel probe rakes, pressure taps | Differential pressure | Airspeed, flow field (testing) |
| **Driver** | Throttle/brake position & pressure, steering angle/torque | Potentiometers / pressure sensors | Inputs |
| | Biometrics (some teams), **FIA accident data recorder** + in-ear accelerometers, high-speed camera | MEMS high-g accelerometers | Crash forces, safety |

**What AutoPulse borrows from F1:**
1. **Plausibility & sensor-fusion checks** → section 4 #13.
2. **Component life budgets** (F1 limits PU parts per season and tracks life per component) → our **wear meters / RUL bars**.
3. **Telemetry tooling** (McLaren ATLAS-style overlays: compare this lap vs. a reference lap) → our dashboard overlays **today's signature vs. the healthy baseline**.
4. **Thermal and physical models as virtual sensors.**

---

## 6. What Tesla (and other OEMs) do

| Who | Feature | Takeaway for AutoPulse |
|---|---|---|
| **Tesla** | Continuous on-board self-diagnosis; app "self-diagnosis" scan when booking service (2022); remote diagnostics & reports of the car pre-ordering parts for service (2019); OTA software fixes; battery health test in Service Mode | **Pre-drive health check screen**, plain-language alerts, "book service" action, remote report |
| **GM OnStar Proactive Alerts** | Predicts battery, starter and fuel-pump failures from vehicle data before they fail | Exactly our "predict component wear" task, on ordinary IC cars |
| **BMW Condition Based Service / Mercedes ASSYST** | Service intervals computed from actual wear (oil life, brake pads) instead of fixed km | Wear meters per component |
| **Preteckt** (startup) + **EngineAD** dataset | ML on commercial-vehicle engine telemetry to catch early engine trouble | Validates the approach; their dataset is usable |
| **Third-party (Amber, ABRITES)** | Remote inspections, DTC reads | Shows market demand |

**Note:** the "Tesla startup check" you have in mind is mostly a **UX pattern**: a car render, each subsystem lights up green as it is checked, then a summary. We can build exactly that in the dashboard.

---

## 7. Datasets

### 7.0 Data strategy: use both (generated + public), plus a little of our own

Neither source is enough alone:

| | Public real data | Our generated data |
|---|---|---|
| **Strengths** | Real noise and real faults; credibility with judges; honest test set | Every fault on demand, perfectly labelled; **synchronised** sound + vibration + OBD from the same "car"; **months of ageing + seasons** (essential for the adaptive baseline, and no public dataset has it) |
| **Weaknesses** | Scattered across different machines/cars; no dataset has all modalities together; few faults; no long-term per-car history | Model may learn simulator quirks instead of real physics |

**Plan:**
1. **Calibrate** the generator with real data: match noise levels, spectra and value ranges to CWRU / MAFAULDA / engine-sound / EngineAD / carOBD statistics.
2. **Pre-train** models on large synthetic data.
3. **Fine-tune and test on real data**, and report results on **real test sets separately** ("trained on synthetic, tested on real"). This is the number that matters.
4. **Prove the adaptive baseline** with synthetic multi-month, multi-season data, because only there do we know the ground truth of what was ageing and what broke.
5. **Bonus, which makes the project stand out:** record **our own** healthy-car data. An ELM327 dongle (~₹500) + phone mic on family/friends' cars over a few weeks, logged with Car Scanner/Torque CSV export or our own python-OBD logger. Even 3–5 cars gives real per-car baselines, cold vs. warm starts and the guided rev test.

### 7.1 Engine / vehicle acoustic
| Dataset | What | Use | Link |
|---|---|---|---|
| HF engine-sound (healthy/faulty: misfire, tappet, belt) | Phone recordings, 5–10 s WAV | Real engine audio fault classes (small; check licence) | https://huggingface.co/datasets/RashmiKarunarathne/MyDataSet |
| OtoMobile | 65 recordings, 12 failing-component classes, expert labels (restricted, request access) | Real car fault sounds | https://zenodo.org/record/3382945 · paper https://arxiv.org/abs/1911.02073 |
| MIMII / DCASE 2020 Task 2 | Industrial machine normal/anomalous sounds + baseline | **Anomaly detection method & baseline code** | https://zenodo.org/record/3678170 |
| ToyADMOS2 | Toy-car / machine anomalous sounds | Unsupervised baseline method | https://github.com/nttcslab/ToyADMOS2-dataset |
| car-sound-dataset (PyPI) | 17k generic car sound events | Pretraining / background noise augmentation | https://pypi.org/project/car-sound-dataset |

### 7.2 Vibration (bearings & rotating machinery; transfer to engine accessories)
| Dataset | What | Link |
|---|---|---|
| **CWRU Bearing** | Vibration, normal / inner / outer / ball faults, 12 & 48 kHz | https://engineering.case.edu/bearingdatacenter |
| **Paderborn (KAt)** | **Vibration + motor current**, 32 bearing states, CC BY-NC | https://mb.uni-paderborn.de/en/kat/research/bearing-datacenter/data-sets-and-download |
| **MAFAULDA** | 8 channels @ 50 kHz: 6 vibration + **microphone** + tacho; imbalance, misalignment, bearing faults | https://www02.smt.ufrj.br/~offshore/mfs/page_01.html |
| IMS / NASA bearing (run-to-failure) | Degradation to failure, good for **wear/RUL** | NASA PCoE repository: https://www.nasa.gov/intelligent-systems-division/discovery-and-systems-health/pcoe/pcoe-data-set-repository/ |
| awesome-bearing-dataset | Curated list of many more | https://github.com/VictorBauler/awesome-bearing-dataset |

### 7.3 Engine / OBD-II / CAN telemetry
| Dataset | What | Link |
|---|---|---|
| **EngineAD** (McGill + Preteckt, 2026) | 25 commercial vehicles, 6 months, 13 engine signals @ ~1 s, expert anomaly labels | https://arxiv.org/abs/2603.25955 · data DOI 10.5683/SP3/TX13P1 |
| Engine-health "engine condition" dataset (Kaggle mirror) | 19.5k rows: RPM, lube oil pressure/temp, fuel pressure, coolant pressure/temp, good/bad label (labels may be rule-based) | https://huggingface.co/datasets/dhani10/engine-condition-dataset |
| carOBD | 27 PIDs @ 1 Hz, Toyota Etios | https://github.com/eron93br/carOBD |
| KIT Automotive OBD-II dataset | 10 OBD signals (RPM, speed, ECT, TPS…) CC BY 4.0 | DOI 10.35097/1130 |
| Driving pattern (Ocslab/HCRL, KIA / Hyundai) | 51 OBD features, 10 drivers | https://ieee-dataport.org/open-access/car-mine-driver-pattern-dataset-extracted-can-bus |
| Vehicle Energy Dataset (VED) | 383 cars, 1 year, OBD + GPS | https://github.com/gsoh/VED |
| CANdid (USENIX VehicleSec '25) | Raw CAN from 10 vehicles, labelled actions | https://www.usenix.org/conference/vehiclesec25/presentation/howson |
| ReCAN (PoliMi) | Raw + decoded CAN from 5 vehicles | Mendeley DOI 10.17632/76knkx3fzv |
| IoT Vehicle Telemetry | Driving + engine OBD diagnostics CSV | https://ieee-dataport.org/documents/iot-vehicle-telemetry |

### 7.4 Simulation sources
| Source | What it gives |
|---|---|
| **MATLAB Powertrain Blockset: "Detect Misfires Using On-Board Diagnostics"** | SI engine model with **misfire fault injection**, 58-tooth crank sensor model, P0300/P0303 DTC logic. Directly matches the PS's "Simulink engine simulation" resource. https://www.mathworks.com/help/autoblks/ug/use-obd-to-detect-misfire.html |
| Powertrain Blockset drive cycles (WLTP, FTP-75, etc.) | Realistic RPM/speed/load traces |
| IEEE DataPort *Diesel engine faults features dataset* | Simulated cylinder pressure + crankshaft torsional vibration under faults https://ieee-dataport.org/documents/diesel-engine-faults-features-dataset |
| **BeamNG.tech + BeamNGpy** | Soft-body car sim: electrics (RPM, temps, fuel, wheel speed), damage sensor, powertrain sensor up to 2000 Hz. Good for chassis/drive-cycle telemetry. https://documentation.beamng.com/beamng_tech/sensors/ |
| NASA C-MAPSS (turbofan RUL) & NASA battery datasets | Standard **wear / RUL** benchmarks to prove the method |

### 7.5 Our own synthetic generator (recommended: this is what makes the project yours)
No public dataset has synchronised **audio + vibration + OBD** for the same faulty car, so we build a **physics-inspired generator in Python**:

- **Engine kinematics core:** RPM trace from a drive cycle → crank angle θ(t) → firing events every 720°/N_cyl.
- **Vibration/audio synthesis per event:**
  - Healthy combustion = damped impulse train at firing frequency (f_fire = RPM/60 × N_cyl/2) + harmonics + noise.
  - **Misfire** = drop the impulse of cylinder *k* (randomly or periodically) → 0.5-order component appears + crank speed dip.
  - **Knock** = damped sinusoid at f_knock ≈ 1.84·c/(π·bore) (~6–7 kHz) a few degrees after TDC, random intensity.
  - **Tappet tick** = sharp impulse once per cam revolution, ringing at 3–8 kHz.
  - **Bearing defect** = impulses at BPFO/BPFI (from bearing geometry), amplitude-modulated.
  - **Belt squeal** = narrowband 2–5 kHz tone during cold start / acceleration.
  - **Imbalance / mount** = boosted 1× / 2× order sinusoids.
  - Add road/wind noise, mic coloration, random gain, so the ML has to generalise.
- **OBD telemetry synthesis:** ECT first-order warm-up ODE, fuel trims, MAF from a speed-density model, oil pressure = f(RPM, oil temp), battery voltage/current during cranking (one hump per compression stroke).
- **Degradation injection over "months":** thermostat stuck, vacuum leak growing, oil pressure slowly falling, battery internal resistance rising, so **wear prediction** has trends to learn.
- **Stream it as a fake car:** feed telemetry through **ELM327-emulator** so the dashboard talks to it like a real OBD dongle (switching to a real car later is plug-and-play).
- **Validation:** check synthetic spectra against the real recordings (HF/OtoMobile/MAFAULDA) and fine-tune models on real data (sim-to-real transfer).

---

## 8. Open-source tools & repos

| Purpose | Tool |
|---|---|
| OBD-II reading | **python-OBD** https://github.com/brendan-w/python-OBD |
| Fake OBD car for dev | **ELM327-emulator** https://github.com/Ircama/ELM327-emulator |
| CAN bus | **python-can**, **cantools** (DBC decode), **opendbc** (comma.ai DBC library) https://github.com/commaai/opendbc, **SavvyCAN** (GUI) |
| Other vehicle-monitoring projects | OVMS (Open Vehicle Monitoring System), AndrOBD |
| DSP | **scipy.signal** (FFT, STFT, filters, Hilbert envelope), **librosa** (mel-spectrogram, MFCC), **PyWavelets**, numpy |
| Feature extraction | **tsfresh**, **sktime** |
| ML | **scikit-learn** (SVM, softmax/LogReg, IsolationForest, OC-SVM), **PyTorch** / **Keras** (CNN, ANN, autoencoder, LSTM), **PyOD** (anomaly detection) |
| Reference ML code | CWRU 1D-CNN https://github.com/XiongMeijing/CWRU-1 · DCASE Task 2 baseline (autoencoder anomaly) · sound-based engine fault demo https://github.com/itzmishra/test |
| F1 data (demo/inspiration) | **FastF1** https://github.com/theOehrly/Fast-F1 · **OpenF1 API** https://openf1.org |
| Dashboard | **Plotly Dash** or **Streamlit** (fast), or **React + FastAPI + WebSockets** (Tesla-grade UX); **InfluxDB + Grafana** for time-series |
| Edge | ESP32-S3 (I²S mic + SPI accelerometer), TFLite Micro / ONNX Runtime |

---

## 9. System architecture

```
 ┌──────────── DATA SOURCES ────────────┐
 │ Synthetic generator │ Simulink model │ Public datasets │ (later) real car via ELM327/CAN
 └──────────┬───────────────────────────┘
            ▼
 ┌──────── INGEST & SYNC ────────┐   python-OBD / python-can / WAV / CSV
 │ time-align, resample, buffer  │   ring buffers per sensor, 1–2 s windows
 └──────────┬────────────────────┘
            ▼
 ┌──────── SIGNATURE EXTRACTION (DSP) ────────────────────────────┐
 │ Time:  RMS, peak, crest factor, kurtosis, skew, zero-crossings │
 │ Freq:  FFT band energies, dominant peaks, spectral centroid    │
 │ Order: crank-angle resampling → order spectrum (0.5×,1×,2×…)   │
 │ T-F:   STFT / log-mel spectrogram, MFCC, wavelet scalogram     │
 │ Env:   Hilbert envelope spectrum (bearings, tappets)           │
 │ OBD:   residuals vs. physics models, trims, warm-up τ          │
 └──────────┬─────────────────────────────────────────────────────┘
            ▼
 ┌──────── PATTERN RECOGNITION (ML) ──────────────────────────────┐
 │ 1. Baseline / anomaly: Autoencoder, Isolation Forest, OC-SVM   │
 │ 2. Fault classifier:   2D-CNN (spectrograms), 1D-CNN (raw),    │
 │                        SVM + ANN on features, Softmax baseline │
 │ 3. Wear / RUL:         health index trend + LSTM/GRU/exp. fit  │
 │ 4. Fusion:             per-sensor probs + rules → subsystem    │
 │                        health score (0–100) + confidence       │
 └──────────┬─────────────────────────────────────────────────────┘
            ▼
 ┌──────── DASHBOARD ────────┐
 │ see section 10            │
 └───────────────────────────┘
```

---

## 10. Dashboard design ("Tesla-style" but for an IC car)

1. **Startup health check (hero screen):** top-down car render. Subsystems (engine, cooling, fuel, electrical, tyres, brakes, exhaust) light up one by one: checking → ✅ / ⚠️ / ❌. Ends with an overall **Health Score** and a one-line verdict.
2. **Live telemetry:** RPM, speed, coolant, throttle, fuel trims, oil pressure, battery V. Gauges plus sparklines.
3. **Signature lab (core of the PS):**
   - Raw waveform (time domain) for mic / accelerometer / current
   - FFT spectrum with **auto-annotated peaks** (firing freq, 0.5× order, knock band, BPFO…)
   - Live **STFT spectrogram** waterfall
   - Order spectrum (vs. engine order instead of Hz)
   - **Overlay vs. healthy baseline**, F1-ATLAS style
4. **Fault feed:** cards like *"Cylinder 3 misfire, 94% confidence, detected from crank speed + vibration. Likely: spark plug/coil. Action: service within 200 km."* Includes model attribution (which sensor/feature drove the decision).
5. **Wear & maintenance:** per-component health % bars like phone battery health, with RUL (battery, oil, brake pads, tyres, timing chain). Shows "normal ageing" vs. "ageing faster than expected".
5b. **Emergency mode (section 1B):** full-screen critical alert with plain instructions (e.g. AC off / heater max), time-or-distance-left estimate as a range, and a map of the nearest fuel station / tyre shop / mechanic with a call button.
5c. **"What's normal for my car":** shows the learned baseline per context (cold start vs. warm idle, summer vs. winter), with a "serviced" button to re-learn a component after repair.
6. **History & trends:** health score over weeks, fault timeline.
7. **Model view (for judges):** confusion matrices, CNN vs. SVM vs. ANN vs. Softmax comparison, ROC curves.

---

## 11. ML plan in detail

| Task | Input | Models (PS-mandated in **bold**) | Metric |
|---|---|---|---|
| Fault classification: audio | log-mel spectrogram (2 s) | **CNN**, **SVM** on MFCC stats, **ANN + Softmax** | Macro-F1, confusion matrix |
| Fault classification: vibration | raw window / envelope spectrum / order spectrum | **1D-CNN**, **SVM** | Macro-F1 |
| Fault classification: OBD | feature vector (trims, residuals, τ) | **ANN**, **Softmax regression**, gradient boosting | Macro-F1 |
| Normal baseline | features from healthy data only | Autoencoder, Isolation Forest, One-Class SVM | AUROC, false alarm rate |
| Wear / RUL | health-index time series | Exponential degradation fit, LSTM/GRU | RMSE of RUL |
| Fusion | per-modality probabilities | Weighted late fusion / small meta-classifier | Accuracy vs. single-sensor |

**Rules to avoid fooling yourselves:**
- Split train/test **by recording / vehicle / session, never by overlapping windows**. Many CWRU papers report ~99% only because of window leakage.
- Test across RPM ranges and noise levels you didn't train on.
- Report the per-class confusion matrix, not just accuracy.

**Fault classes (v1):** Healthy · Misfire (cyl 1–4) · Knock · Valve/tappet wear · Bearing fault · Belt squeal · Imbalance/mount · Vacuum leak · Thermostat fault · Low oil pressure · Weak battery / low compression (cranking).

---

## 12. Phased roadmap

| Phase | Weeks* | Deliverable |
|---|---|---|
| **0. Setup & study** | 1 | Repo, environment, read MathWorks misfire example, download CWRU / MAFAULDA / HF audio / engine-health / EngineAD |
| **1. Synthetic generator v1** | 2 | Python engine signal generator (audio + vibration + crank speed + OBD) with 6+ injectable faults; ELM327-emulator stream |
| **2. Signature extraction** | 2 | DSP library: time/FFT/STFT/order/envelope features; plots validating each fault's signature |
| **3. ML models** | 2–3 | SVM, Softmax, ANN, 1D/2D CNN classifiers; anomaly baseline; RUL on degradation data; comparison report |
| **4. Dashboard** | 2–3 | Startup check, live telemetry, signature lab, fault feed, wear meters |
| **5. Real-data validation** | 1 | Fine-tune/test on real recordings (HF audio, MAFAULDA, EngineAD); optional real car via ELM327 + phone mic |
| **6. Polish & report** | 1 | BOM/affordability analysis, demo video, documentation |

\*Adjust to your actual deadline.

**Suggested team split (if 3–4 people):** (A) data generator + Simulink, (B) DSP signatures, (C) ML models, (D) dashboard. Everyone agrees on the data schema (section 13) in week 1.

---

## 13. Data schema (agree on this early)

```text
telemetry (1–100 Hz):  timestamp, rpm, speed_kph, throttle_pct, coolant_c, oil_pressure_bar, oil_temp_c,
                       maf_gps, map_kpa, stft_pct, ltft_pct, o2_up_v, o2_down_v, fuel_rail_bar,
                       batt_v, batt_a, evap_kpa, wheel_fl/fr/rl/rr_kph, accel_xyz, gyro_z, label, fault_severity
highrate (10–48 kHz):  session_id, sensor {mic|accel_x|accel_y|accel_z|batt_v_fast|batt_a_fast}, fs, start_ts, samples[]
crank (per tooth):     session_id, tooth_idx, timestamp_us
labels:                session_id, t_start, t_end, fault_class, cylinder, severity(0–1)
```

---

## 13A. MATLAB & Simulink: what they are and whether we need them

- **MATLAB** (by MathWorks) is a paid programming language and environment for numerical maths: matrices, signal processing, plotting. Engineers use it a lot, much like Python + NumPy + SciPy.
- **Simulink** runs on top of MATLAB. It's a **drag-and-drop block-diagram simulator**: you wire blocks (engine, sensor, controller) and it simulates them over time. The car industry uses it for "model-based design" of engine controllers.
- **Powertrain Blockset** is an add-on with ready-made engine and vehicle models, including the **misfire fault-injection example** the PS hints at.
- **Licence:** paid. Many Indian colleges have a **campus-wide licence** (check with your college). There is also **MATLAB Online** and a 30-day trial. **GNU Octave** (free) runs plain MATLAB scripts but **not Simulink**.

**Decision for AutoPulse:**
- **Main pipeline in Python** (free, runs anywhere, everything in this plan is doable in it).
- **Simulink is optional.** If a college licence with Powertrain Blockset is available, run the MathWorks misfire example once to export an "official" engine-simulation dataset, as a cross-check for our Python generator. This ticks the PS's "Simulink/MATLAB" resource box without depending on it.

---

## 14. Open questions for you / your mentor

1. What's the deadline and team size? (This sets the phase lengths.)
2. Does your college have a **MATLAB + Simulink + Powertrain Blockset** licence? If yes, use the misfire example as an "official" data source (section 13A); if not, the Python generator covers it.
3. Is a **real-car demo** (ELM327 dongle + phone mic) wanted, or is simulation enough?
4. Should the dashboard be **web (Dash/React)** or a **desktop app**?
5. Petrol only, or diesel too? (This changes knock/misfire physics.)

---

## 15. Sources

- Misfire/knock/audio research: [Sensors 2022 – misfire via acoustic characterization](https://doi.org/10.3390/s22207736), [The AI Mechanic (arXiv 2205.09667)](https://arxiv.org/pdf/2205.09667), [OtoMechanic (arXiv 1911.02073)](https://arxiv.org/pdf/1911.02073), [ToyADMOS](https://ar5iv.arxiv.org/html/1908.03299)
- MathWorks: [Detect Misfires Using OBD](https://www.mathworks.com/help/autoblks/ug/use-obd-to-detect-misfire.html), [ICE ignition control blog](https://blogs.mathworks.com/simulink/2018/11/07/internal-combustion-engine-ignition-control-example-part-1/)
- Datasets: [EngineAD](https://arxiv.org/pdf/2603.25955), [McGill iSMART datasets](https://ismart.ece.mcgill.ca//datasets), [Diesel engine faults (IEEE DataPort)](https://ieee-dataport.org/documents/diesel-engine-faults-features-dataset), [Paderborn](https://mb.uni-paderborn.de/en/kat/research/bearing-datacenter/data-sets-and-download), [CWRU-1 repo](https://github.com/XiongMeijing/CWRU-1), [carOBD](https://github.com/eron93br/carOBD), [VED](https://arxiv.org/pdf/1905.02081), [CANdid](https://www.usenix.org/conference/vehiclesec25/presentation/howson), [can-train-and-test](https://arxiv.org/pdf/2308.04972), [IoT Vehicle Telemetry](https://ieee-dataport.org/documents/iot-vehicle-telemetry), [KIT OBD-II](https://service.tib.eu/ldmservice/vdataset/rdr-doi-10-35097-1130), [Engine condition (HF)](https://huggingface.co/datasets/dhani10/engine-condition-dataset), [DCASE 2020 T2](https://zenodo.org/record/3678170)
- F1: [Jalopnik – F1 telemetry explained](https://jalopnik.com/formula-one-telemetry-explained-1845819678/), [F1 telemetry (dronedesk)](https://blog.dronedesk.io/f-1-telemetry-data/), [formula1-dictionary telemetry](https://www.formula1-dictionary.net/f1-telemetry/), [McLaren FIA sensor supplier](https://www.crash.net/f1/news/239045/1/mclaren-picked-as-engine-sensor-provider-by-fia), [IR tyre sensors](https://www.tirereview.com/?p=52553), [Unique F1 sensors](https://formulabharat.com/a-few-of-the-unique-sensors-used-in-formula-1/), [Autosport – testing sensors explained](https://www.autosport.com/f1/news/112669/formula-1-testing-sensors-explained)
- Tesla / OEM: [Tesla autonomous diagnosis (The Drive)](https://www.thedrive.com/tech/27826/tesla-vehicles-can-now-diagnose-problems-and-order-replacement-parts-autonomously), [Amber remote diagnostics (TechCrunch)](https://techcrunch.com/2024/09/10/ev-warranty-startup-amber-launches-a-remote-diagnostic-service-for-teslas), [Preteckt](https://wellfound.com/company/preteckt)
- Virtual sensing: [EVAP testing (FenderBender)](https://www.fenderbender.com/running-a-shop/operations/article/33022615/evap-testing-working-behind-the-scenes), [Indirect vs direct TPMS (Bridgestone)](https://bridgestone.com.sg/en/tyre-clinic/drivers-essential/tyre-pressure-monitoring-system-how-tpms-works)
- Simulation: [BeamNG.tech sensors](https://documentation.beamng.com/beamng_tech/sensors/), [opendbc](https://github.com/commaai/opendbc), [FastF1](https://pypi.org/project/fastf1/3.1.2)
