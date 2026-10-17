# AutoPulse test · v3 with a clearer visual hierarchy

> **Design experiment.** A copy of [v3](../v3/) with v1's hierarchy brought back: a "Your car" eyebrow and a 40 px car name, a 76 px health score, sentence-case section titles, and a calm green for checked-and-fine (ticks on every healthy system, the score, the verdict). Alarm colours and shapes keep their ISA meaning; the layout is unchanged. v3 itself is untouched.

**Two laptops, one car.** One laptop *is* the car: its sensors stream out and you break things on purpose. The other is the dashboard: it pairs over Wi-Fi and diagnoses everything live, from the sensor data alone.

AutoPulse extracts signatures from engine vibration and OBD-II telemetry, recognises faults with **SVM, Softmax regression, ANN and CNN** models, learns what is normal for each car, and tells the driver what to do. Built for the Honeywell problem statement *Automobile engine data: signature extraction and pattern recognition*.

```text
  VEHICLE laptop                                        DASHBOARD laptop
  ─────────────────────────────                         ─────────────────────────────
  Control panel (:5173/vehicle.html)                    Dashboard (:5173)
    car · ignition · drive mode · breakdowns              Overview · Health check · Live drive
          │                                               Signatures · Insights · Evidence
          ▼                                                         ▲
  Vehicle node (:8200)  ── ws://…:8200/ws/stream ──▶  Dashboard API (:8000)
    simulated car, 1 frame/s:                           signatures → 4 models vote
    OBD-II row + 1 s of 24 kHz vibration                adaptive baseline · safety rules
    + crank speed per firing                            ──▶ /api/ws/live to the screen
          │
          └── UDP beacon :8201 ("I'm here") ──────────▶ discovery list
```

> Self-contained: everything v3 needs lives in this folder. v3 is [v2](../v2/) plus the team's branches: Krish's light theme and Signature lab, Sparsh's live microphone, Parth's real-audio models, fusion, robustness tests, Evidence page and printable report. The single-laptop round-1 project is [v1](../v1/).

---

## How to run

| Laptop | Action |
|--------|--------|
| **The car** | Double-click [`run.bat`](run.bat) → choose **1 Vehicle** |
| **The screen** | Double-click [`run.bat`](run.bat) → choose **2 Dashboard** → **Vehicle link** → pick the car → enter its code |
| **One laptop (demo)** | Double-click [`run.bat`](run.bat) → choose **3 Both** (already paired) |

The launcher installs only what that role needs, and only when it changed: the vehicle skips PyTorch and the models entirely. It then starts the right services and opens:

### → http://localhost:5173/vehicle.html (car) · http://localhost:5173 (dashboard)

The vehicle window prints its **address** and a 4-digit **pairing code**. Both laptops must be on the same network. The first time, Windows asks whether Python may use the network: allow it on **private** networks. **Ctrl+C** stops everything.

<details>
<summary><strong>Manual run</strong> (developers)</summary>

```bash
python -m venv .venv
.venv\Scripts\python -m pip install -r requirements.txt --extra-index-url https://download.pytorch.org/whl/cpu
cd frontend && npm install && cd ..

# Vehicle laptop
set AUTOPULSE_CODE=1234
.venv\Scripts\python -m uvicorn vehicle.node:app --host 0.0.0.0 --port 8200
npm --prefix frontend run dev            # then open http://localhost:5173/vehicle.html

# Dashboard laptop
.venv\Scripts\python -m uvicorn backend.app:app --port 8000
npm --prefix frontend run dev            # then open http://localhost:5173 and pair
```

Vehicle-only installs can use the smaller `requirements-vehicle.txt` (no PyTorch).

</details>

---

## Documentation hub

| Document | Use it for |
|----------|------------|
| **[docs/SETUP.md](docs/SETUP.md)** | Requirements, the three roles, pairing two laptops, ports, troubleshooting |
| **[docs/ARCHITECTURE.md](docs/ARCHITECTURE.md)** | What goes over the wire, the per-second pipeline, modules, design choices |
| **[docs/WALKTHROUGH.md](docs/WALKTHROUGH.md)** | Every step of the project (data, models, MATLAB, baseline, app) and how we use it |
| [docs/OBD2_EXPLAINED.md](docs/OBD2_EXPLAINED.md) | OBD-II primer: the port, services, PIDs, monitors, limits |
| [PROJECT_PLAN.md](PROJECT_PLAN.md) | Research and plan: failure → sensor map, datasets, F1 and Tesla, roadmap |
| [report/AutoPulse-Concept-Report.pdf](report/AutoPulse-Concept-Report.pdf) | Round 1 concept report (22 pages) |

---

## What you get

| Capability | Detail |
|------------|--------|
| **A car you can break** | Five car types × ten units, driven live (parked, city, highway). 6 engine faults by sound and 9 vehicle faults over OBD-II, switched on and off while it drives |
| **Real network split** | The vehicle streams one frame per second over a WebSocket: 19 OBD-II values, 1 s of 24 kHz block vibration (int16), crank speed at every firing. About 65 kB/s |
| **Discovery and pairing** | UDP beacon on the LAN, 4-digit pairing code, auto-reconnect, latency shown. Breakdown controls only accept requests from the vehicle laptop itself |
| **Blind diagnosis** | The vehicle never sends what was injected. The dashboard works it out: signatures → SVM, Softmax, ANN, CNN vote (5 s smoothing) → adaptive per-car baseline; OBD-II → hard safety limits |
| **Live dashboard** | Health score, see-through wireframe car with glowing fault zones, rolling telemetry, the engine's spectrum, spectrogram, envelope, orders and crank speed every second |
| **Control-room cockpit** | ISA-101 design after TorqueTwin: grey while healthy, colour only for alarms with a priority shape, normal-band gauges and trends, acknowledgeable alarm banner. The car stays in the middle on a radar ring (NavPort) with sensors left, recognition right and the live signature below |
| **Ask AutoPulse** | Ctrl/⌘ K in the status bar. One-sentence answers from the live data ("Why is the score low?", "Is the battery charging?", "What is knock?"), and the app jumps to the screen that shows the answer and spotlights it. Deterministic intents plus a small search over these docs: no language model, nothing made up, works offline |
| **Signature lab** | **Live engine:** the verdict once, two detectors against their own thresholds, a 720° engine-cycle dial, fault-specific evidence, why / where / what next, a scrubbable 3-minute timeline. **Engine audio:** a real engine through models trained on real recordings only, as a clip (upload, record 10 s, or a sample) or the live microphone, analysed every second; voice, music, fans and silence are withheld instead of labelled |
| **Health report** | Printer icon: one printable sheet (or PDF) with the score, engine vote, subsystem scan, every telemetry channel against its normal band, safety events, wear and what to do |
| **Light and dark** | Sun / moon icon in the status bar; light is tuned for projectors (contrast 4.5:1 and up); remembered per browser |
| **Car dropdown** | Pick the car from a menu; its wireframe preview appears only while the menu is open |
| **Technical-illustration cars** | Real car models drawn like a CAD X-ray: a bold outline recomputed from every view, thin panel gaps and surface flow, interior and mechanicals faint through the body |

### Measured on the live pipeline

| Check | Result |
|-------|--------|
| False engine alarms, healthy driving (3 car types × city and highway, 30 min total) | **0** warnings; one 1-second "sounds different" note on each highway run |
| Engine faults (misfire, knock, valve, bearing, belt, imbalance) | All flagged **3 s** after injection, the right fault named |
| Puncture · alternator · coolant leak · oil pressure · fuel leak | Flagged after 4 s · 37 s · 34 s · 75 s · 73 s |
| Processing per frame on the dashboard | ~20 ms (all four models + baseline + rules) |

---

## Results that carry over

Same models and data as the single-laptop app. Real-data rows are the numbers that count.

| Test | Data | Result |
|------|------|--------|
| Fault classification from engine sound | 321 **real** recordings, held out by recording | **90.3%** (SVM); 91.0% per recording |
| Bearing faults | **Real** CWRU vibration, unseen motor load | 100% (known easy benchmark) |
| Adaptive baseline on real driving | 129 **real** carOBD trips | False alarms on **14%** of healthy trips vs 31% fixed; 91% of vacuum leaks caught |
| Misfire on an independent simulator | **MATLAB** crankshaft dynamics, 84 runs | **100%** detected, cylinder named **100%** |
| Misfire on **MathWorks' Simulink engine** | Powertrain Blockset example, run blind | **11 / 11** detected, 2 false alarms in 71 strokes |
| DSP cross-check | All **28** features recomputed in MATLAB | Agree to 6 × 10⁻¹⁴ |

---

## Demo script (about 5 minutes)

1. **Vehicle laptop:** pick *SUV* from the dropdown (the preview spins while the menu is open). **Start engine**, choose *City*.
2. **Dashboard laptop:** **Vehicle link** → the SUV appears under *On this network* → enter the code. The pill turns green: *Live*.
3. **Vehicle:** inject **Misfire**. **Dashboard:** within ~3 s the engine glows red, *Signatures* shows the crank dips and the models' votes, Live drive explains what to do.
4. **Vehicle:** inject **Coolant leak**, switch to *Highway*. **Dashboard → Live drive → Coolant:** the line climbs through the warning ("AC off, heater max") to the critical limit.
5. **Vehicle:** **Tyre puncture**. Caught in seconds from the rate of loss, before the tyre is flat.
6. **Vehicle:** **Repair all**. **Dashboard → Signatures → Mark serviced**: the score recovers.
7. **Insights → Evidence:** the adaptive baseline story, then the real-data, MATLAB and Simulink numbers.

---

## Repository map

| Path | What it is |
|------|------------|
| `run.bat` | Role-aware launcher: 1 Vehicle · 2 Dashboard · 3 Both |
| `vehicle/node.py` | Vehicle node: drives the car, streams sensors, beacon, pairing, breakdown API |
| `autopulse/livecar.py` | The car, one second at a time, with faults injected live |
| `autopulse/wire.py` | The wire format (encode on the vehicle, decode on the dashboard) |
| `backend/live.py` | Dashboard side: discovery, pairing, the per-second diagnosis pipeline |
| `backend/app.py` | Dashboard API: pairing endpoints, `/api/ws/live`, Insights and Evidence data |
| `frontend/` | React (Vite): `index.html` dashboard, `vehicle.html` control panel, three.js wireframe cars |
| `blender/convert_models.py` | Turns the downloaded car models into line-art cars with named health zones |
| `blender/build_cars.py` | Shared helpers, engine bay / radiator / battery / fuel parts; the earlier procedural cars |
| `autopulse/` | Generator, signatures, models, adaptive baseline, safety rules, OBD drive simulator, real-data loaders |
| `train.py` · `evaluate_real.py` | Train on simulated engines · train and test on real recordings |
| `matlab/` · `scripts/` | MATLAB / Simulink cross-checks, dataset download, developer checks |
| `models/` | Trained models and every results file |
| `report/` | Concept report source and PDF |
| `app.py` | Original Streamlit dashboard (fallback) |

---

## Credits

Car models (CC BY 4.0, converted to line art by `blender/convert_models.py`; download the originals into `blender/source/` to rebuild):

| Car | Model | Author |
|-----|-------|--------|
| Sedan | [Generic Sedan Car](https://sketchfab.com/3d-models/58c33766470d46e7b2aed542650494e5) | MMC Works |
| SUV | [MMC Generic Small SUV Car](https://sketchfab.com/3d-models/5db696c6ed5d4bdc87905c1040fa072a) | MMC Works |
| Coupe | [Generic Sport Coupé Car](https://sketchfab.com/3d-models/820a13c4831c41959ce75e6c2014e882) | MMC Works |
| Pickup | [Lightbody Lifted '85](https://sketchfab.com/3d-models/67beae18c3d24be68f9c8f0ec382d8e3) | Daniel Zhabotinsky |
| Hatchback | [Generic passenger car pack](https://sketchfab.com/3d-models/20f9af9b8a404d5cb022ac6fe87f21f5) | Comrade1280 |

Licensed under [Creative Commons Attribution 4.0](https://creativecommons.org/licenses/by/4.0/). Changes: re-oriented and scaled, textures removed, parts reclassified, line art extracted, radiator / battery / fuel system (and engine where absent) added.

---

## Data

Public datasets are downloaded by `scripts/download_data.py` into `data/raw/` and are not committed. Thanks to the authors of carOBD, the CWRU Bearing Data Center, and the Hugging Face engine-audio and engine-condition datasets.
