# Architecture

How the split edition works: what each laptop runs, what goes over the wire, what the dashboard does with every frame, and why it is built this way.

**Run it:** [../README.md](../README.md#how-to-run) · **Set it up:** [SETUP.md](SETUP.md) · [docs index](README.md)

---

## The two laptops

```text
┌──────────────────────── VEHICLE laptop ────────────────────────┐   ┌─────────────────────── DASHBOARD laptop ───────────────────────┐
│                                                                 │   │                                                                 │
│  Browser  /vehicle.html                                         │   │  Browser  /                                                     │
│    CarSelect · ignition · drive mode · breakdown buttons        │   │    Overview · Health check · Live drive · Signatures · …        │
│        │  /vapi/*  (Vite proxy, localhost only)                 │   │        ▲  /api/ws/live  (JSON, 1 msg/s)                         │
│        ▼                                                        │   │        │                                                        │
│  vehicle/node.py  (uvicorn, 0.0.0.0:8200)                       │   │  backend/app.py + backend/live.py  (uvicorn, 127.0.0.1:8000)    │
│    LiveCar.step() every 1 s ──► encode_frame() ──────────────────────────► websocket client  →  LiveHub.process()                │
│    beacon thread  ── UDP broadcast :8201 every 2 s ──────────────────────► discovery listener                                     │
│                                                                 │   │                                                                 │
└─────────────────────────────────────────────────────────────────┘   └─────────────────────────────────────────────────────────────────┘
```

| Process | File | Listens on | Role |
|---------|------|------------|------|
| Vehicle node | `vehicle/node.py` | `0.0.0.0:8200` (tcp) | Drives the car, streams frames, beacons, takes breakdown commands |
| Dashboard API | `backend/app.py` | `127.0.0.1:8000`, `0.0.0.0:8201` (udp) | Pairs, diagnoses each frame, pushes results to the screen; serves Insights / Evidence |
| UI | `frontend/` (Vite) | `localhost:5173` | `index.html` = dashboard, `vehicle.html` = control panel; proxies `/api` → 8000 and `/vapi` → 8200 |

---

## The wire

One JSON message per second on `ws://<vehicle>:8200/ws/stream?code=<pairing code>` ([`autopulse/wire.py`](../autopulse/wire.py)):

```text
{ "type": "frame", "protocol": 1, "seq": 412, "sent": 1760612345.12,
  "vehicle": { "name": "LAPTOP-7", "car_type": "suv", "label": "SUV · 2.0 L", "unit": 8 },
  "obd":     { "t": 300, "ignition": true, "speed_kph": 48.2, "rpm": 1710, "coolant_c": 90.1,
               "oil_pressure_bar": 2.9, "battery_v": 14.2, "ltft_pct": 0.3, "fuel_level_pct": 41.6,
               "tyre_fl_psi": 34.1, …  19 values },
  "vib":     { "fs": 24000, "rpm": 1710, "scale": 3.1e-05,
               "pcm": "<base64 of 24 000 int16 samples>",
               "crank": [1712.4, 1698.0, …] } }        ← null while the engine is off
```

| Stream | Real-car equivalent | Rate | Size |
|--------|---------------------|------|------|
| `obd` | OBD-II Service 01 PIDs + TPMS over an ELM327 / CAN adapter | 1 Hz | ~0.5 kB |
| `vib.pcm` | Accelerometer or contact mic on the engine block | 24 kHz, 16-bit | 64 kB (base64) |
| `vib.crank` | Crank position sensor: speed at every firing | ~25–130 / s | < 1 kB |

About **65 kB/s per dashboard**, fine on any Wi-Fi. The first message after connecting is `{"type": "hello", "vehicle": …}`. A wrong code closes the socket with code **4401**, which the dashboard shows as *Wrong pairing code* and stops retrying.

**What is never sent:** which faults were injected. `LiveCar.truth()` exists only for the vehicle's own control panel. The dashboard diagnoses from sensor data alone, so the demo is an honest blind test.

### Discovery beacon

Every 2 s the vehicle broadcasts `{"app": "autopulse", "role": "vehicle", "name", "car_type", "unit", "port", "ignition"}` to `255.255.255.255:8201` and its subnet broadcast address. The dashboard lists anything heard in the last 7 s, plus a direct probe of `127.0.0.1:8200/api/hello` for the *Both* role. No code is broadcast: you still need the one shown on the vehicle laptop.

---

## The vehicle: `LiveCar`

[`autopulse/livecar.py`](../autopulse/livecar.py) is the stepwise version of the drive simulator. Each `step()` is one second:

```text
driver model (Parked / City / Highway segments, ≤ +3 / −6 km/h per s)
  → gear → rpm (cold engines idle at 1100) → throttle → load
  → coolant (warm-up τ ≈ 70 s; leak / broken belt push towards 135 °C)
  → oil pressure (rpm × viscosity; low-oil fault decays to 15 %)
  → battery (14.2 V charging; alternator / belt fault: battery drains)
  → tyres (warm-up +2 psi; puncture −0.25 psi/s, slow leak −0.03 psi/s)
  → fuel trims (vacuum leak: +14 % at idle) → fuel level (leak: +0.012 %/s)
  → synth_window(engine fault, rpm, coolant) → 1 s of block vibration + crank speeds
```

Faults act from the second they are injected (`since(fault)`), and *Repair* removes them, including resetting a flat tyre. The engine sound comes from the same physics-based generator the models were trained on, at whatever rpm the car is doing at that moment.

---

## The dashboard: one frame, end to end

[`backend/live.py`](../backend/live.py) → `LiveHub.process()`, about **20 ms** per frame:

```text
frame
 ├─ vib → decode int16 → 28 signature features ─┬─► SVM · Softmax · ANN  ─┐
 │                     → 64-bin STFT image ─────┼─► CNN                   ├─► mean = ensemble
 │                                              │                         │   → average of last 5 s
 │                                              │                         │   → fault if ≥ 50 % for 2 frames
 │                                              └─► AdaptiveBaseline.observe(context = cold|warm × idle|low|mid|high rpm)
 │                                                    deviation score, learns only from healthy-looking seconds
 ├─ obd → last 150 s → rules.evaluate()  (hard limits that never adapt + guidance + maps link)
 ├─ engine verdict → alert with guidance (misfire, knock = critical; others = warning)
 ├─ 8 subsystem checks → zones on the car → health score (100 − 35 per critical − 12 per warning − 4 per note)
 └─ signature views for the screen: spectrum, waveform, spectrogram, envelope, orders, crank deviation
      → JSON → every open dashboard tab (/api/ws/live)
```

| Decision | Why |
|----------|-----|
| **Average the last 5 one-second windows** before naming a fault | A single second can be ambiguous; five agree. Detection still lands within ~3 s |
| **Baseline keyed by engine state** (cold/warm × rpm band) | "Normal" at 800 rpm cold is not normal at 2,500 rpm warm. Each state learns its own fingerprint |
| **Baseline freezes once something looks wrong** | So a developing fault is never learned as the new normal. *Mark serviced* clears it |
| **New car = fresh baseline** | A different car or unit has a different normal; history and learning restart |
| **Rules run on raw OBD values, separately from ML** | Safety limits (oil pressure, overheating, puncture) must never drift or wait for a model |

### What the screen receives

`/api/ws/live` sends `hello` (link state, last 15 min of rows, latest frame) on connect, then one `frame` per second with: `row` (for charts), `engine` (verdict, ensemble, per-model votes, deviation, threshold), `systems`, `zones`, `score`, `verdict`, `alerts`, `sig` (signature views), and `link` (state, frames, latency). Link changes (`connecting`, `live`, `lost`, `error`, `unpaired`) are pushed as `link` messages.

---

## Endpoints

| Where | Method · path | Purpose |
|-------|---------------|---------|
| Vehicle | `WS /ws/stream?code=` | Sensor stream (code required) |
| Vehicle | `GET /api/hello` | Identity for discovery |
| Vehicle | `GET /api/state` | Everything the control panel shows · **localhost only** |
| Vehicle | `POST /api/control` | `car_type`, `unit`, `ignition`, `mode`, `ambient`, `severity` · **localhost only** |
| Vehicle | `POST /api/inject` · `/api/repair` | `{"fault": "misfire"}`, `{"fault": "all"}` · **localhost only** |
| Dashboard | `GET /api/discover` | Vehicles heard on the network + link state |
| Dashboard | `POST /api/pair` · `/api/unpair` | `{"host", "port", "code"}` |
| Dashboard | `POST /api/serviced` | Reset the learned baseline |
| Dashboard | `WS /api/ws/live` | Diagnosed frames for the UI |
| Dashboard | `GET /api/baseline` · `/api/wear` · `/api/results` · `/api/meta` | Insights and Evidence data |

---

## Wireframe cars

The five cars are real models (CC BY 4.0, credited in the [README](../README.md#credits)) converted by [`blender/convert_models.py`](../blender/convert_models.py):

```text
download (blender/source/, not committed)
  → bake transforms and modifiers, drop rig widgets and hidden variants
  → square up the footprint (principal axis) → front to +X, ground to z = 0
  → split multi-material parts → classify by object / material name:
       body · glass · front / rear lights · interior · underbody · wheels · engine
  → line art: panel boundaries + creases > 38° (wire_body), every quad edge (wire_flow),
       interior and mechanical feature edges, rim and brake edges per wheel
  → add radiator, battery, fuel system (and an engine if the model has none) from the
       measured wheel positions and bonnet height, all named zone_*
  → frontend/public/models/<car>.glb
```

| Group | Lines | Drawn as |
|-------|-------|----------|
| outline (computed in the browser) | Silhouette of the body and each tyre for the current view | Bold 2.2 px + soft glow |
| `wire_body` | Panel gaps (open panel edges) and sharp creases | Thin |
| `wire_flow` | Every quad edge of the body panels | 0.8 px at 12 %, near side only |
| `wire_glass` | Window outlines | Thin blue |
| `interior_lines` · `detail_lines` | Seats, dashboard, steering wheel · chassis, springs, exhaust, wipers | Crisp through glass, faint through the body |
| `tyre_*` | Tyre mesh (for its outline) plus rim, spoke and caliper edges | Like parts; glow when that tyre is at fault |
| `zone_*` | The model's engine, plus radiator, fan, hoses, battery, fuel tank and lines | Muted green when healthy; pulsing colour when not |

`frontend/src/components/Car3D.jsx` renders them like a CAD X-ray, with three view-dependent effects:

| Effect | How |
|--------|-----|
| **View-dependent outline** | Edges where a face turned towards the camera meets one turned away, found every frame from precomputed adjacency (welded geometry, ~1 ms). Open panel edges are skipped, so panel gaps stay thin |
| **Hidden-line transparency** | The body shell writes depth only (no colour). Every line set is then drawn twice: a crisp pass where it is in front of the shell and a faint pass (`depthFunc = GreaterDepth`) where the shell hides it. Glass does not hide anything, so the interior reads clearly through the windows |
| **Depth fade** | Linear fog applied to line alpha, re-centred on the car every frame: the near side leads, the far side recedes |
| **Fresnel skin** | The shell is almost invisible face-on and glows softly at grazing angles, so it reads as a volume |

Lines use `LineSegments2` for real pixel widths, which plain WebGL lines lack. Rebuild: `blender -b --factory-startup --disable-autoexec -P blender/convert_models.py -- blender/out_real`, then copy `blender/out_real/*.glb` to `frontend/public/models/`.
