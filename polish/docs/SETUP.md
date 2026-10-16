# Setup & run instructions

One-click launch on Windows, the three roles, pairing two laptops, manual fallback and troubleshooting.

**Product overview & how to run (start here):** [../README.md](../README.md) · [docs index](README.md)

---

## Requirements

| Tool | Version | Needed on | Notes |
|------|---------|-----------|-------|
| Windows | 10 / 11 | Both laptops | `run.bat` is Windows-only; see [Manual run](#manual-run) elsewhere |
| Python | **3.11** (3.10–3.12 work) | Both | Tick *Add python.exe to PATH* when installing |
| Node.js | 18+ LTS | Both | Both screens are one Vite/React app |
| Network | same Wi-Fi or LAN | Both | Phone hotspot works. Guest / campus Wi-Fi may block laptops from seeing each other: see [Troubleshooting](#troubleshooting) |
| Disk | ~150 MB (vehicle) · ~1.5 GB (dashboard) | | The dashboard installs PyTorch (CPU) for the CNN |

---

## One-click (recommended)

1. Open the `split` folder.
2. Double-click **`run.bat`**.
3. Pick a role:

   ```text
     Which laptop is this?
       [1] Vehicle    the car: sensors transmit, you inject breakdowns
       [2] Dashboard  the screen: pairs with a vehicle, shows live health
       [3] Both       run everything on this laptop (demo / testing)
   ```

4. Wait for the checks and installs. The first run is the longest; later runs skip anything unchanged.
5. The browser opens on its own. Leave the console window open: it is the live log.
6. **Ctrl+C** in the console stops every service (answer `Y` to *Terminate batch job*).

Skip the prompt by passing the role: `run.bat 1`, `run.bat dashboard`, `run.bat both`.

### What each role starts

| Role | Starts | Ports | Opens | Installs |
|------|--------|-------|-------|----------|
| **1 Vehicle** | Vehicle node (foreground, live console) + UI | 8200 tcp, 8201 udp (out), 5173 | `/vehicle.html` | `requirements-vehicle.txt`: no models, no PyTorch |
| **2 Dashboard** | Dashboard API (background) + UI (foreground) | 8000, 8201 udp (in), 5173 | `/` | `requirements.txt` incl. PyTorch CPU; trains models if missing |
| **3 Both** | All of the above, auto-paired over `127.0.0.1` | all | both pages | `requirements.txt` |

Only port **8200** has to be reachable from the other laptop. The UI (5173) and the dashboard API (8000) stay local to each laptop.

---

## Pairing two laptops

```text
  1. Vehicle laptop    run.bat → 1      prints   Address 192.168.1.23:8200 · Pairing code 4821
  2. Dashboard laptop  run.bat → 2      opens    http://localhost:5173  → Vehicle link drawer
  3. Dashboard         pick the car under "On this network"  (or type 192.168.1.23)
  4. Dashboard         enter 4821 → Pair → pill turns green: "Live · SUV"
```

- The address and code are also at the top of the vehicle's control panel.
- The code changes every time the vehicle starts. The dashboard reconnects on its own after short drops, but needs the new code after a vehicle restart.
- Several dashboards can pair with one vehicle at the same time, e.g. a judge's laptop as a second screen.
- Breakdown controls only answer requests from the vehicle laptop itself. Another machine on the network can watch the stream (with the code) but cannot drive or break the car.

### Firewall

The first time each laptop runs, Windows Defender Firewall asks whether **Python** may communicate on networks:

| Laptop | Why | Answer |
|--------|-----|--------|
| Vehicle | dashboards connect *in* on port 8200 | **Allow** on private networks |
| Dashboard | receives the discovery beacon on UDP 8201 | **Allow** (or skip it and type the vehicle's address by hand) |

If the prompt was dismissed: *Windows Security → Firewall & network protection → Allow an app through firewall → python.exe → Private*.

---

## Using it

### Vehicle laptop (`/vehicle.html`)

| Area | What it does |
|------|--------------|
| **Car dropdown + unit** | Five car types, ten physical units each. Hover an option to see its wireframe; changing car stops the engine and the dashboard starts learning the new car from scratch |
| **Ignition · driving · temperature** | Start/stop, *Parked* / *City* / *Highway* driver, outside temperature (cold engines idle high and rattle) |
| **Sensors transmitting** | What is going out right now: OBD-II values, tyre pressures, the three streams, kB/s |
| **Simulate a breakdown** | Engine conditions (heard by the vibration sensor) with severity, and vehicle faults (read over OBD-II) that start acting the moment you inject them. *Repair all* = a workshop visit |
| **Console** | Pairing, injections and a transmit summary every 10 s |

The wireframe on this page shows what is **really** broken. Only this laptop knows; the dashboard has to find it.

### Dashboard laptop (`/`)

| Screen | Shows |
|--------|-------|
| **Overview** | The paired car, health score, glowing fault zones, top alert, six live gauges with 2-minute trends |
| **Health check** | Animated scan of eight subsystems, then they stay live; click one to see which sensors and method decide it |
| **Live drive** | Rolling telemetry (2 / 5 / 15 min) against the hard limits, alerts with what to do now and a maps link |
| **Signatures** | The latest second of engine vibration in six views, every model's vote, and the deviation from this car's own normal. *Mark serviced* resets the learned normal |
| **Insights · Evidence** | The 8-month adaptive-baseline study, wear, and the real-data / MATLAB / Simulink results (no vehicle needed) |

---

## Manual run

```bash
python -m venv .venv
.venv\Scripts\python -m pip install -r requirements.txt --extra-index-url https://download.pytorch.org/whl/cpu
npm --prefix frontend install
```

| Process | Command |
|---------|---------|
| Vehicle node | `.venv\Scripts\python -m uvicorn vehicle.node:app --host 0.0.0.0 --port 8200` |
| Dashboard API | `.venv\Scripts\python -m uvicorn backend.app:app --port 8000` |
| UI (either laptop) | `npm --prefix frontend run dev` |

### Environment variables

| Variable | Read by | Default | Meaning |
|----------|---------|---------|---------|
| `AUTOPULSE_CODE` | vehicle node | random 4 digits | Pairing code |
| `AUTOPULSE_NAME` | vehicle node | computer name | Name shown in discovery |
| `AUTOPULSE_CAR` | vehicle node | `sedan` | Car at start-up |
| `AUTOPULSE_VEHICLE_PORT` | vehicle node | `8200` | Stream port |
| `AUTOPULSE_AUTOPAIR` | dashboard API | none | `host:port:code` to pair at start-up (role 3 sets it) |

On macOS / Linux, use `.venv/bin/python` and `export VAR=value`; everything else is the same.

---

## Troubleshooting

| Symptom | Fix |
|---------|-----|
| Nothing under *On this network* | Some networks block broadcast. Type the vehicle's address from its console. Check both laptops are on the same network (not one on Ethernet and one on guest Wi-Fi) |
| *Cannot reach 192.168.x.x:8200* | Firewall on the vehicle laptop (see [Firewall](#firewall)). From the dashboard laptop, `curl http://<vehicle-ip>:8200/api/hello` should answer |
| *Wrong pairing code* | The code changes on every vehicle start: use the one in its console now |
| Pill says *No data from the vehicle* | The vehicle node stopped or the network dropped. The dashboard keeps retrying; restart the vehicle and pair again if its code changed |
| *Something is already listening on port …* | An earlier AutoPulse window is still open, or the original app (`..\run.bat`) is running. Close it, then re-run |
| Campus Wi-Fi isolates clients | Use a phone hotspot for both laptops |
| Dashboard engine says *Engine off* | Press **Start engine** on the vehicle laptop |
| `npm` or `python` not found | Install them (see [Requirements](#requirements)) and open a new console |
| First run very slow on the dashboard | PyTorch CPU (~200 MB) is downloading. Later runs skip it |
