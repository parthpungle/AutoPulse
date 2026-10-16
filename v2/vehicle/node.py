"""AutoPulse vehicle node: this laptop is the car.

It drives a simulated car one second at a time (autopulse.livecar), streams what its sensors
read to any paired dashboard, announces itself on the local network, and takes breakdown
commands from the control panel (http://localhost:5173/vehicle.html).

    .venv\\Scripts\\python -m uvicorn vehicle.node:app --host 0.0.0.0 --port 8200

    ws  /ws/stream?code=1234   sensor stream for dashboards (pairing code required)
    GET /api/hello             who am I (used by dashboard discovery)
    GET /api/state             everything the control panel shows        (this laptop only)
    POST /api/control          car, unit, ignition, drive mode, ambient   (this laptop only)
    POST /api/inject, /api/repair                                         (this laptop only)
"""
import asyncio
import json
import os
import secrets
import socket
import threading
import time
from collections import deque
from contextlib import asynccontextmanager

from fastapi import FastAPI, HTTPException, Request, WebSocket, WebSocketDisconnect
from pydantic import BaseModel

from autopulse.generator import CAR_TYPES, ENGINE_FAULTS, FAULT_LABELS
from autopulse.livecar import MODES, LiveCar
from autopulse.telemetry import OBD_FAULTS
from autopulse.wire import BEACON_PORT, PROTOCOL, STREAM_PORT, encode_frame

CODE = os.environ.get("AUTOPULSE_CODE") or f"{secrets.randbelow(9000) + 1000}"
NAME = os.environ.get("AUTOPULSE_NAME") or socket.gethostname()
PORT = int(os.environ.get("AUTOPULSE_VEHICLE_PORT", STREAM_PORT))
LOCAL = {"127.0.0.1", "::1", "localhost"}

car = LiveCar(car_type=os.environ.get("AUTOPULSE_CAR", "sedan"), unit=8)
lock = threading.Lock()
clients = {}                        # websocket -> {"ip", "since"}
log = deque(maxlen=200)
stats = {"seq": 0, "bytes": 0, "rate_bps": 0.0, "started": time.time()}
latest = {"obd": None}


def lan_ip():
    """The address other laptops reach this one on (no packet is actually sent)."""
    s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
    try:
        s.connect(("10.255.255.255", 1))
        return s.getsockname()[0]
    except OSError:
        return "127.0.0.1"
    finally:
        s.close()


def say(msg, kind="info"):
    stamp = time.strftime("%H:%M:%S")
    log.append({"time": stamp, "kind": kind, "msg": msg})
    print(f"  {stamp}  {msg}", flush=True)


def vehicle_info():
    return {"name": NAME, "car_type": car.car_type, "label": car.label, "unit": car.unit}


# ------------------------------------------------------------------ the 1 Hz sensor loop
async def drive_loop():
    last_summary = 0.0
    while True:
        t0 = time.perf_counter()
        with lock:
            obd, vib = await asyncio.to_thread(car.step)
            info = vehicle_info()
        stats["seq"] += 1
        latest["obd"] = obd
        frame = json.dumps(encode_frame(stats["seq"], time.time(), info, obd, vib))
        stats["rate_bps"] = 0.8 * stats["rate_bps"] + 0.2 * len(frame) * len(clients)
        for ws in list(clients):
            try:
                await ws.send_text(frame)
                stats["bytes"] += len(frame)
            except Exception:                                           # noqa: BLE001 - dashboard went away
                drop(ws, "connection lost")
        if time.time() - last_summary >= 10 and obd["ignition"]:
            last_summary = time.time()
            say(f"tx #{stats['seq']:<5} {obd['speed_kph']:5.0f} km/h {obd['rpm']:5.0f} rpm  coolant {obd['coolant_c']:4.0f} C"
                f"  -> {len(clients)} dashboard(s), {stats['rate_bps'] / 1000:.0f} kB/s", "tx")
        await asyncio.sleep(max(0.0, 1.0 - (time.perf_counter() - t0)))


def drop(ws, why):
    c = clients.pop(ws, None)
    if c:
        say(f"Dashboard {c['ip']} disconnected ({why})", "link")


# ------------------------------------------------------------------ discovery beacon
def beacon_loop(stop):
    s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
    s.setsockopt(socket.SOL_SOCKET, socket.SO_BROADCAST, 1)
    while not stop.is_set():
        ip = lan_ip()
        msg = json.dumps({"app": "autopulse", "role": "vehicle", "protocol": PROTOCOL, "port": PORT,
                          **vehicle_info(), "ignition": car.ignition}).encode()
        targets = {"255.255.255.255"}
        if ip.count(".") == 3 and not ip.startswith("127."):
            targets.add(ip.rsplit(".", 1)[0] + ".255")          # subnet broadcast, for multi-adapter laptops
        for t in targets:
            try:
                s.sendto(msg, (t, BEACON_PORT))
            except OSError:
                pass
        stop.wait(2.0)


def banner():
    ip = lan_ip()
    line = "=" * 60
    print(f"\n{line}\n  AutoPulse VEHICLE is on the network\n"
          f"    Name          : {NAME}\n    Address       : {ip}:{PORT}\n    Pairing code  : {CODE}\n\n"
          f"  On the dashboard laptop: Vehicle -> pick '{NAME}' -> enter {CODE}\n"
          f"  Control panel (this laptop): http://localhost:5173/vehicle.html\n{line}\n", flush=True)


@asynccontextmanager
async def lifespan(_app):
    banner()
    say(f"{car.label}, unit {car.unit} ready. Engine off.")
    stop = threading.Event()
    threading.Thread(target=beacon_loop, args=(stop,), daemon=True).start()
    task = asyncio.create_task(drive_loop())
    yield
    stop.set()
    task.cancel()


app = FastAPI(title="AutoPulse vehicle node", version="1.0", lifespan=lifespan)


def local_only(request: Request):
    if request.client is None or request.client.host not in LOCAL:
        raise HTTPException(403, "The vehicle is controlled from its own laptop only")


# ------------------------------------------------------------------ dashboard side
@app.get("/")
def root():
    return {"app": "AutoPulse vehicle node", "control_panel": "http://localhost:5173/vehicle.html",
            "stream": "/ws/stream?code=<pairing code>"}


@app.get("/api/hello")
def hello():
    return {"app": "autopulse", "role": "vehicle", "protocol": PROTOCOL, "port": PORT, "ignition": car.ignition,
            **vehicle_info()}


@app.websocket("/ws/stream")
async def stream(ws: WebSocket, code: str = ""):
    await ws.accept()
    ip = ws.client.host if ws.client else "?"
    if code != CODE:
        say(f"Rejected {ip}: wrong pairing code", "warn")
        await ws.close(code=4401, reason="wrong pairing code")
        return
    clients[ws] = {"ip": ip, "since": time.time()}
    say(f"Dashboard {ip} paired", "link")
    await ws.send_text(json.dumps({"type": "hello", "protocol": PROTOCOL, "vehicle": vehicle_info()}))
    try:
        while True:                     # only pings come back: echo them so the dashboard can time the round trip
            msg = await ws.receive_text()
            if msg.startswith('{"type": "ping"'):
                await ws.send_text(msg.replace('"ping"', '"pong"', 1))
    except WebSocketDisconnect:
        drop(ws, "closed")
    except Exception:                   # noqa: BLE001
        drop(ws, "connection lost")


# ------------------------------------------------------------------ control panel side (localhost)
class Control(BaseModel):
    car_type: str | None = None
    unit: int | None = None
    ignition: bool | None = None
    mode: str | None = None
    ambient: float | None = None
    severity: float | None = None


class Fault(BaseModel):
    fault: str = "all"


@app.get("/api/state")
def state(request: Request):
    local_only(request)
    return {"name": NAME, "code": CODE, "ip": lan_ip(), "port": PORT, **vehicle_info(),
            "ignition": car.ignition, "mode": car.mode, "ambient": car.ambient, "severity": car.severity,
            "trip_s": car.trip_t, "truth": car.truth(), "obd": latest["obd"],
            "clients": [{"ip": c["ip"], "since_s": int(time.time() - c["since"])} for c in clients.values()],
            "stats": {"frames": stats["seq"], "kb_sent": round(stats["bytes"] / 1000), "kbps": round(stats["rate_bps"] / 1000, 1)},
            "log": list(log)[-80:],
            "options": {"cars": [{"id": k, "label": v["label"]} for k, v in CAR_TYPES.items()],
                        "modes": [{"id": k, "label": v["label"]} for k, v in MODES.items()],
                        "engine_faults": [{"id": f, "label": FAULT_LABELS[f]} for f in ENGINE_FAULTS],
                        "obd_faults": [{"id": k, "label": v} for k, v in OBD_FAULTS.items() if k != "none"]}}


@app.post("/api/control")
def control(c: Control, request: Request):
    local_only(request)
    with lock:
        if c.car_type is not None or c.unit is not None:
            ct, u = c.car_type or car.car_type, car.unit if c.unit is None else c.unit
            if (ct, u) != (car.car_type, car.unit):
                car.set_car(ct, u)
                say(f"Switched to {car.label}, unit {u}. Engine off.", "ctl")
        if c.mode is not None and c.mode in MODES and c.mode != car.mode:
            car.mode, car.seg_left = c.mode, 0
            say(f"Drive mode: {MODES[c.mode]['label']}", "ctl")
        if c.ambient is not None:
            car.ambient = float(c.ambient)
        if c.severity is not None:
            car.severity = float(min(max(c.severity, 0.2), 1.0))
        if c.ignition is not None and c.ignition != car.ignition:
            (car.start if c.ignition else car.stop)()
            say("Engine started" if c.ignition else "Engine stopped", "ctl")
    return {"ok": True}


@app.post("/api/inject")
def inject(f: Fault, request: Request):
    local_only(request)
    with lock:
        try:
            car.inject(f.fault)
        except ValueError as e:
            raise HTTPException(400, str(e)) from e
    name = FAULT_LABELS.get(f.fault) or OBD_FAULTS.get(f.fault)
    say(f"BREAKDOWN injected: {name}" if f.fault != "healthy" else "Engine sound back to healthy", "fault")
    return {"ok": True}


@app.post("/api/repair")
def repair(f: Fault, request: Request):
    local_only(request)
    with lock:
        car.repair(None if f.fault == "all" else f.fault)
    say("Workshop visit: every fault repaired" if f.fault == "all"
        else f"Repaired: {FAULT_LABELS.get(f.fault) or OBD_FAULTS.get(f.fault, f.fault)}", "fix")
    return {"ok": True}
