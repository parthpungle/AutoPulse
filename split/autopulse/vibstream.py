"""One WebSocket session = one simulated (or vehicle-fed) accelerometer run.

Used by both editions (backend/app.py and the split dashboard API). Framework-free: the transport
only needs `await ws.send_json(dict)` and `await ws.receive_json()` (FastAPI WebSocket qualifies).

client -> server  {"cmd": "start", "settings": {...}} | pause | resume | stop | reset
                  {"cmd": "update", "settings": {fault|severity|rpm|condition|speed}} | {"cmd": "channel", "channel": "accel_y"}
server -> client  {"type": "state", ...}   status, settings, elapsed, ground truth, assumptions
                  {"type": "batch", ...}   new samples (display-decimated), 4 Hz
                  {"type": "analysis", ...} rolling-window features / FFT / STFT / classification, 2 Hz
                  {"type": "error", "code", "message"}

State machine: idle -> running <-> paused -> stopped; reset -> idle from anywhere; start from idle/stopped.
Sample generation and DSP run in worker threads so the event loop is never blocked, and the ticker task is
cancelled on stop / reset / disconnect.
"""
import asyncio
import time

import numpy as np

from autopulse import vibration
from autopulse.vibsim import (ASSUMPTIONS, CHANNELS, LIVE_KEYS, RollingAnalyzer, Settings, SettingsError,
                              VibrationSimulator, truth, validate)

TICK_S = 0.25            # wall-clock interval between batches
ANALYZE_EVERY = 2        # analysis every 2 ticks (0.5 s)
BATCH_POINTS = 100       # display points per channel per batch


def _decimate(t, y, n):
    idx = vibration._peak_decimate(y, n)
    return t[idx], y[idx]


class Session:
    def __init__(self, ws, classifier=None, vehicle_queue=None):
        """classifier(native_window) -> classification dict. vehicle_queue (split dashboard only): asyncio.Queue of
        decoded 1 s vehicle windows; when given, start uses them instead of the simulator."""
        self.ws, self.classifier, self.vq = ws, classifier, vehicle_queue
        self.state = "idle"
        self.settings = Settings()
        self.channel = CHANNELS[0]
        self.sim = None
        self.an = None
        self.task = None
        self.ticks = 0
        self.source = "simulator"
        self.last_native = None
        self.last_classification = None

    # ------------------------------------------------------------------ messages
    async def send_state(self, **extra):
        elapsed = self.an.total / self.an.fs if self.an else 0.0
        await self.ws.send_json({"type": "state", "state": self.state, "simulated": self.source == "simulator",
                                 "source": self.source, "settings": self.settings.to_dict(), "elapsed_s": round(elapsed, 3),
                                 "samples": self.an.total if self.an else 0, "buffered_s": round(self.an.buffered / self.an.fs, 3) if self.an else 0,
                                 "truth": truth(self.settings) if self.source == "simulator" else None,
                                 "channel": self.channel, "assumptions": list(ASSUMPTIONS), **extra})

    async def error(self, code, message):
        await self.ws.send_json({"type": "error", "code": code, "message": message})

    # ------------------------------------------------------------------ commands
    async def handle(self, msg):
        cmd = msg.get("cmd")
        try:
            if cmd == "start":
                if self.state in ("running", "paused"):
                    return await self.error("bad_state", "A run is in progress; stop or reset it first.")
                await self.begin(msg.get("settings"), msg.get("source", "simulator"))
            elif cmd == "pause":
                if self.state != "running":
                    return await self.error("bad_state", "Nothing is running.")
                self.state = "paused"
            elif cmd == "resume":
                if self.state != "paused":
                    return await self.error("bad_state", "The run is not paused.")
                self.state = "running"
            elif cmd == "stop":
                if self.state not in ("running", "paused"):
                    return await self.error("bad_state", "Nothing is running.")
                await self.cancel()
                self.state = "stopped"
            elif cmd == "reset":
                await self.cancel()
                self.sim = self.an = None
                self.state, self.ticks = "idle", 0
                self.last_classification = None
            elif cmd == "update":
                new = validate({k: v for k, v in (msg.get("settings") or {}).items()}, self.settings)
                bad = [k for k in (msg.get("settings") or {}) if k not in LIVE_KEYS]
                if bad:
                    return await self.error("not_live", f"{', '.join(bad)} cannot change during a run; reset first.")
                self.settings = new
                if self.sim:
                    self.sim.update(new)
                if self.an:
                    self.an.rpm = new.rpm
            elif cmd == "channel":
                if msg.get("channel") not in (self.an.buf if self.an and self.an.buf else CHANNELS):
                    return await self.error("bad_channel", "Unknown channel.")
                self.channel = msg["channel"]
            else:
                return await self.error("bad_command", f"Unknown command '{cmd}'.")
        except SettingsError as e:
            return await self.error(e.code, e.message)
        await self.send_state()

    async def cancel(self):
        if self.task:
            self.task.cancel()
            try:
                await self.task
            except asyncio.CancelledError:
                pass
            self.task = None

    async def begin(self, settings, source):
        if source == "vehicle":
            if self.vq is None:
                raise SettingsError("no_vehicle", "This server has no vehicle link.")
            self.settings = validate(settings, Settings())
            self.source, self.sim = "vehicle", None
            while not self.vq.empty():
                self.vq.get_nowait()                                    # start from "now", not from stale windows
        else:
            self.settings = validate(settings, Settings())
            self.source = "simulator"
            self.sim = VibrationSimulator(self.settings)
        s = self.settings
        self.an = None if source == "vehicle" else RollingAnalyzer(s.fs, s.window_s, s.rpm, s.envelope)
        self.channel = CHANNELS[0] if source != "vehicle" else "vibration"
        self.ticks = 0
        self.last_native = self.last_classification = None
        self.state = "running"
        self.task = asyncio.create_task(self.loop())

    # ------------------------------------------------------------------ the run
    async def loop(self):
        nxt = time.perf_counter()
        while True:
            nxt += TICK_S
            if self.state == "running":
                try:
                    await (self.vehicle_tick() if self.source == "vehicle" else self.sim_tick())
                except (asyncio.CancelledError, RuntimeError):         # cancelled, or the socket closed under us
                    raise
                except Exception as e:  # noqa: BLE001 - report instead of dying silently
                    self.state = "stopped"
                    await self.error("stream_failed", f"{type(e).__name__}: {e}")
                    await self.send_state()
                    return
            await asyncio.sleep(max(0.0, nxt - time.perf_counter()))
            if nxt < time.perf_counter() - 2:                           # fell far behind: do not burst to catch up
                nxt = time.perf_counter()

    async def sim_tick(self):
        s = self.settings
        n = max(1, int(round(s.fs * TICK_S * s.speed)))
        i0, chans = await asyncio.to_thread(self.sim.read, n)
        self.an.push(i0, chans)
        self.ticks += 1
        await self.send_batch(i0, chans, s.fs)
        if self.ticks % ANALYZE_EVERY == 0 and self.an.ready():
            await self.send_analysis(self.sim.native)

    async def vehicle_tick(self):
        wins = []
        while not self.vq.empty():
            wins.append(self.vq.get_nowait())
        if not wins:
            return
        fs = wins[0]["fs"]
        if self.an is None or self.an.fs != fs:
            s = self.settings
            self.an = RollingAnalyzer(fs, s.window_s, wins[-1]["rpm"], False)
        x = np.concatenate([w["signal"] for w in wins]).astype(np.float64)
        i0 = self.an.total
        self.an.rpm = wins[-1]["rpm"]
        self.an.push(i0, {"vibration": x})
        self.ticks += 1
        await self.send_batch(i0, {"vibration": x}, fs)
        if self.an.ready():
            await self.send_analysis(wins[-1])

    async def send_batch(self, i0, chans, fs):
        out = {}
        for c, y in chans.items():
            t = (i0 + np.arange(len(y))) / fs
            td, yd = _decimate(t, y, BATCH_POINTS)
            out[c] = {"t": vibration._r(td, 5), "y": vibration._r(yd, 5)}
        await self.ws.send_json({"type": "batch", "t0": i0 / fs, "t1": (i0 + len(next(iter(chans.values())))) / fs,
                                 "n": len(next(iter(chans.values()))), "fs": fs, "channels": out})

    async def send_analysis(self, native):
        ch = self.channel if self.channel in self.an.buf else next(iter(self.an.buf))
        res = await asyncio.to_thread(self.an.analyze, ch)
        cls = {"status": "unavailable", "label": None, "confidence": None, "probabilities": None, "model": None,
               "reason": "No classifier configured for this stream."}
        if self.classifier and native is not None:
            cls = await asyncio.to_thread(self.classifier, native)
        self.last_classification = cls
        await self.ws.send_json({
            "type": "analysis", "elapsed_s": round(self.an.total / self.an.fs, 3), "window": res["window"],
            "detail_channel": ch, "channels": res["analysis_channels"], "features": res["features"],
            "spectrum": res["spectrum"].get(ch), "spectrogram": res["spectrogram"].get(ch),
            "orders": res.get("orders"), "envelope": res.get("envelope"), "settings": res["settings"],
            "warnings": res["warnings"], "classification": cls,
            "truth": truth(self.settings) if self.source == "simulator" else None})


async def run_session(ws, classifier=None, vehicle_queue=None):
    """Drive one client until it disconnects. The caller must have accepted the websocket."""
    sess = Session(ws, classifier, vehicle_queue)
    try:
        await sess.send_state()
        while True:
            msg = await ws.receive_json()
            if not isinstance(msg, dict):
                await sess.error("bad_command", "Messages must be JSON objects.")
                continue
            await sess.handle(msg)
    finally:
        await sess.cancel()
