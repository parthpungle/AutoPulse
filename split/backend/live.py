"""Dashboard side of the split setup: pair with a vehicle, read its sensor stream, diagnose.

Every frame the vehicle sends goes through the same pipeline as the single-laptop app:
vibration -> 28 signature features + spectrogram -> SVM / Softmax / ANN / CNN vote ->
adaptive per-car baseline, and the OBD row -> hard-limit safety rules. The result is pushed
to every open dashboard tab over /api/ws/live.
"""
import asyncio
import json
import socket
import threading
import time
import urllib.request
from collections import deque
from pathlib import Path

import numpy as np
import pandas as pd
from scipy.signal import welch

from autopulse import fusion, real_audio
from autopulse.baseline import AdaptiveBaseline
from autopulse.generator import ENGINE_FAULTS, FAULT_LABELS, TRAIN_RPM_RANGE
from autopulse.models import cnn_proba
from autopulse.realdata import estimate_rpm
from autopulse.rules import CRITICAL, INFO, WARNING, Alert, evaluate
from autopulse.signatures import ORDERS, envelope_spectrum, features, order_amplitudes, spectrum, stft_image
from autopulse.wire import BEACON_PORT, STREAM_PORT, decode_vibration

MODELS_DIR = Path(__file__).resolve().parents[1] / "models"
HISTORY = 900          # seconds of telemetry kept for the charts (15 min)
SMOOTH = 5             # engine verdict = mean of the last 5 one-second windows
UNSURE = "unsure"     # the models disagree: below the ensemble confidence threshold, so no verdict either way
RANK = {"ok": 0, INFO: 1, UNSURE: 1, WARNING: 2, CRITICAL: 3}
ZONES = ("engine", "battery", "cooling", "fuel", "tyre_fl", "tyre_fr", "tyre_rl", "tyre_rr")
TYRES = [("tyre_fl", "front-left"), ("tyre_fr", "front-right"), ("tyre_rl", "rear-left"), ("tyre_rr", "rear-right")]

ENGINE_ADVICE = {
    "misfire": (CRITICAL, "Engine misfire",
                "One cylinder is not firing reliably: the crank slows on its stroke and the half-order rises.",
                ["Ease off: avoid hard acceleration and heavy load",
                 "If the check-engine light flashes, stop: unburnt fuel overheats the catalytic converter",
                 "Have spark plugs, coils and injectors checked"], "car mechanic"),
    "knock": (CRITICAL, "Engine knock (detonation)",
              "Sharp 5.5-8 kHz ringing just after firings: fuel is detonating instead of burning.",
              ["Ease off the throttle and change up a gear", "Fill the recommended octane next time",
               "Persistent knock damages pistons: get it checked"], "car mechanic"),
    "valve_tick": (WARNING, "Valve train wear (tappet tick)",
                   "A click once per engine cycle in the 4-7 kHz band: tappet or lifter wear.",
                   ["Safe to drive for now", "Check the oil level: low oil makes tappets tick",
                    "Book a valve clearance check"], ""),
    "bearing": (WARNING, "Accessory bearing fault",
                "Impacts repeating at a bearing-defect rate on the belt-driven accessories.",
                ["Listen for a growl that rises with engine speed",
                 "Have alternator, idler and water-pump bearings checked: a seized bearing can throw the belt"],
                "car mechanic"),
    "belt_squeal": (WARNING, "Belt slipping",
                    "A narrow 2.5-3.5 kHz tone: the serpentine belt is slipping on a pulley.",
                    ["Check belt tension and wear", "If the belt breaks you lose charging and cooling"],
                    "car mechanic"),
    "imbalance": (WARNING, "Imbalance or worn engine mount",
                  "Strong vibration at crank speed (1x order).",
                  ["Have the engine mounts and pulleys checked", "Avoid long high-rpm runs until then"],
                  "car mechanic"),
}


def lan_ips():
    ips = {"127.0.0.1"}
    try:
        ips |= set(socket.gethostbyname_ex(socket.gethostname())[2])
    except OSError:
        pass
    s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
    try:
        s.connect(("10.255.255.255", 1))
        ips.add(s.getsockname()[0])
    except OSError:
        pass
    finally:
        s.close()
    return ips


def r(v, n=2):
    return None if v is None or not np.isfinite(v) else round(float(v), n)


def context_key(rpm, coolant):
    """The baseline learns 'normal' separately per engine state: cold/warm x speed band."""
    band = "idle" if rpm < 1000 else "low" if rpm < 1800 else "mid" if rpm < 2600 else "high"
    return f"{'cold' if coolant < 60 else 'warm'}_{band}"


class LiveHub:
    def __init__(self, models):
        self.models = models                     # () -> (feature models, cnn or None, (prior mean, prior std))
        self.loop = None
        self.ui = set()
        self.task = None
        self.link = {"state": "unpaired", "host": None, "port": None, "vehicle": None, "error": None,
                     "since": None, "frames": 0, "latency_ms": None}
        self.discovered = {}                     # (ip, port) -> beacon + last_seen
        self.latest = None
        self.reset()

    # ------------------------------------------------------------------ state
    def reset(self):
        self.history = deque(maxlen=HISTORY)
        self.rule_rows = deque(maxlen=150)
        self.probs = deque(maxlen=SMOOTH)
        self.snr = deque(maxlen=SMOOTH)            # estimated signal-to-noise of the last windows (dB)
        self.streak = 0
        self.baseline = None                     # built on the first engine frame (models load in the background)
        self.car_key = None
        self.source = "sim"                      # engine sound: "sim" (synthetic) or "replay" (a real recording)

    def _baseline(self):
        if self.baseline is None:
            _, _, (mean, std) = self.models()
            self.baseline = AdaptiveBaseline(mean, std, threshold=3.5, persist=3, gate=2.8)
        return self.baseline

    def serviced(self):
        if self.baseline is not None:
            self.baseline.mark_serviced()
        self.probs.clear()
        self.streak = 0

    # ------------------------------------------------------------------ discovery
    def start_discovery(self):
        def listen():
            s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
            s.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
            try:
                s.bind(("", BEACON_PORT))
            except OSError:
                return                                           # port busy: manual address entry still works
            while True:
                try:
                    data, (ip, _) = s.recvfrom(4096)
                    b = json.loads(data)
                    if b.get("app") == "autopulse" and b.get("role") == "vehicle":
                        self.discovered[(ip, int(b.get("port", STREAM_PORT)))] = {**b, "ip": ip, "seen": time.time()}
                except (OSError, ValueError):
                    continue
        threading.Thread(target=listen, daemon=True).start()

    def discover(self):
        now, mine = time.time(), lan_ips()
        found = []
        try:                                                     # a vehicle node on this same laptop ("Both" role)
            with urllib.request.urlopen(f"http://127.0.0.1:{STREAM_PORT}/api/hello", timeout=0.4) as resp:
                b = json.loads(resp.read())
                found.append({**b, "ip": "127.0.0.1", "local": True})
        except (OSError, ValueError):
            pass
        for (ip, port), b in list(self.discovered.items()):
            if now - b["seen"] > 7:
                continue
            if found and ip in mine and port == STREAM_PORT:     # the same local node, heard by broadcast
                continue
            found.append({k: v for k, v in b.items() if k != "seen"} | {"local": ip in mine})
        return found

    # ------------------------------------------------------------------ link to the vehicle
    def set_link(self, **kw):
        self.link.update(kw)
        self.push({"type": "link", "link": self.link})

    async def pair(self, host, port, code):
        await self.unpair(quiet=True)
        self.reset()
        self.latest = None
        self.set_link(state="connecting", host=host, port=port, error=None, vehicle=None, frames=0, since=None)
        self.task = asyncio.create_task(self._run(host, port, code))
        for _ in range(50):                                      # wait up to 5 s for a verdict to show the user
            if self.link["state"] in ("live", "error"):
                break
            await asyncio.sleep(0.1)
        return self.link

    async def unpair(self, quiet=False):
        if self.task:
            self.task.cancel()
            try:
                await self.task
            except (asyncio.CancelledError, Exception):         # noqa: BLE001
                pass
            self.task = None
        if not quiet:
            self.set_link(state="unpaired", host=None, port=None, vehicle=None, error=None)

    async def _run(self, host, port, code):
        from websockets.asyncio.client import connect
        from websockets.exceptions import ConnectionClosed, InvalidHandshake
        backoff = 1.0
        while True:
            try:
                async with connect(f"ws://{host}:{port}/ws/stream?code={code}", max_size=8_000_000,
                                   open_timeout=4, ping_interval=10) as ws:
                    pinger = asyncio.create_task(self._ping(ws))
                    try:
                        async for raw in ws:
                            msg = json.loads(raw)
                            if msg.get("type") == "pong":
                                self.link["latency_ms"] = round((time.time() - msg["t"]) * 500)  # half the round trip
                            elif msg.get("type") == "hello":
                                backoff = 1.0
                                self.set_link(state="live", vehicle=msg["vehicle"], error=None, since=time.time())
                            elif msg.get("type") == "frame":
                                out = await asyncio.to_thread(self.process, msg)
                                self.link["frames"] += 1
                                if self.link["state"] != "live" or self.link["vehicle"] != msg["vehicle"]:
                                    self.set_link(state="live", vehicle=msg["vehicle"], error=None)
                                self.push(out)
                    finally:
                        pinger.cancel()
                self.set_link(state="lost", error="The vehicle stopped streaming")
            except asyncio.CancelledError:
                raise
            except ConnectionClosed as e:
                if e.rcvd is not None and e.rcvd.code == 4401:
                    self.set_link(state="error", error="Wrong pairing code")
                    return
                self.set_link(state="lost", error="The vehicle closed the connection")
            except (OSError, InvalidHandshake, TimeoutError, ValueError) as e:
                self.set_link(state="lost" if self.link["since"] else "connecting",
                              error=f"Cannot reach {host}:{port} ({type(e).__name__})")
            await asyncio.sleep(backoff)
            backoff = min(backoff * 1.6, 5.0)

    @staticmethod
    async def _ping(ws):
        """Time the link with our own clock only (the two laptops' clocks need not agree)."""
        try:
            while True:
                await ws.send(json.dumps({"type": "ping", "t": time.time()}))
                await asyncio.sleep(3)
        except Exception:                                       # noqa: BLE001 - socket closed; the reader handles it
            pass

    # ------------------------------------------------------------------ UI sockets
    def push(self, msg):
        if self.loop is None:
            return
        text = json.dumps(msg)
        for ws in list(self.ui):
            asyncio.run_coroutine_threadsafe(self._send(ws, text), self.loop)

    async def _send(self, ws, text):
        try:
            await ws.send_text(text)
        except Exception:                                       # noqa: BLE001
            self.ui.discard(ws)

    def hello(self):
        return {"type": "hello", "link": self.link, "history": list(self.history), "latest": self.latest}

    # ------------------------------------------------------------------ the pipeline, once per second
    def process(self, msg):
        v, obd = msg["vehicle"], msg["obd"]
        key = (v["car_type"], v["unit"])
        if key != self.car_key:                                  # a different car: forget the old one's normal
            self.reset()
            self.car_key = key
        if self.rule_rows and obd["t"] < self.rule_rows[-1]["t"]:
            self.rule_rows.clear()                               # engine restarted: a new trip
        self.rule_rows.append(obd)

        engine, sig = self.engine(msg["vib"], obd)
        df = pd.DataFrame(list(self.rule_rows))
        alerts = evaluate(df) if len(df) >= 5 else []
        if engine.get("advice"):
            sev, title, text, actions, near = engine["advice"]
            alerts.insert(0, Alert(sev, title, f"{text} Model confidence {engine['confidence']:.0%}.", actions, near))
        alerts.sort(key=lambda a: -RANK[a.severity])
        systems = self.systems(obd, engine, alerts)
        zones = {z: "ok" for z in ZONES}
        for s in systems:
            for z in s["zones"]:
                if RANK[s["status"]] > RANK[zones[z]]:
                    zones[z] = INFO if s["status"] == UNSURE else s["status"]
        penalty = {CRITICAL: 35, WARNING: 12, INFO: 4, UNSURE: 4, "ok": 0}
        score = max(0, 100 - sum(penalty[s["status"]] for s in systems))
        verdict = "Good to go" if score >= 85 else "Drive, but book a service" if score >= 60 else "Stop safely"

        row = {k: r(obd[k]) for k in ("speed_kph", "rpm", "coolant_c", "oil_pressure_bar", "battery_v", "fuel_level_pct",
                                      "tyre_fl_psi", "tyre_fr_psi", "tyre_rl_psi", "tyre_rr_psi", "ltft_pct",
                                      "engine_load", "throttle_pct")}
        row.update({"clock": obd["clock"], "t": obd["t"], "ignition": obd["ignition"], "score": score,
                    "anomaly": r(engine.get("anomaly")), "healthy_p": r(engine.get("healthy_p"), 3)})
        self.history.append(row)
        self.latest = {"type": "frame", "seq": msg["seq"], "vehicle": v, "row": row, "engine": {
            k: val for k, val in engine.items() if k != "advice"}, "systems": systems, "zones": zones, "score": score,
            "verdict": verdict, "alerts": [{"severity": a.severity, "title": a.title, "message": a.message,
                                            "actions": a.actions, "maps_url": a.maps_url} for a in alerts],
            "sig": sig, "link": self.link}
        return self.latest

    def engine(self, vib, obd):
        if vib is None:
            self.probs.clear()
            self.snr.clear()
            return {"state": "off", "status": "ok", "label": "Engine off"}, None
        w = decode_vibration(vib)
        source = w.get("source", "sim")
        if source != self.source:                                # simulated <-> real recording: different models
            self.probs.clear()
            self.snr.clear()
            self.streak, self.source = 0, source
        if source == "replay":
            return self.engine_real(w, obd)
        x, fs, rpm = w["signal"], w["fs"], w["rpm"]
        fS, tS, S = stft_image(x, fs)
        fz = fusion.load_fusion() if w.get("mic") is not None else None
        if fz is not None:
            # multivariable: mic + accelerometer + OBD context -> the fused models; each modality's own model says
            # how strongly it alone supports the fused verdict (modality_contrib)
            v = fusion.fused_features(w["mic"], x, fs, fusion_obd(obd, rpm), w["crank_speed"])
            f = v[fusion.MODALITIES["accel"]]                     # the accelerometer part feeds the baseline as before
            votes = {name: m.predict_proba(v[None])[0] for name, m in fz["models"].items()}
        else:
            feat, cnn, _ = self.models()
            f = features(x, fs, rpm, w["crank_speed"])
            votes = {name: m.predict_proba(f[None])[0] for name, m in feat.items()}
            if cnn is not None:
                votes["CNN"] = cnn_proba(cnn, [S])[0]
        score, anomaly = self._baseline().observe(f, context_key(rpm, obd["coolant_c"]))
        engine = self.verdict(votes, ENGINE_FAULTS, rpm, obd, score, anomaly, tau=sim_threshold())
        engine.update(source="simulated", clip=None, models="fusion (mic + accel + OBD)" if fz else "accelerometer only")
        self.snr.append(snr_db(x, fs))
        engine["checks"] = {"snr_db": r(float(np.median(self.snr)), 1), "rpm": r(rpm, 0),
                            "rpm_in_training_range": TRAIN_RPM_RANGE[0] <= rpm <= TRAIN_RPM_RANGE[1]}
        if engine["status"] == UNSURE:
            engine["why_unsure"] = why_unsure(engine, rpm, float(np.median(self.snr)))
        sig = build_sig(x, fs, rpm, w["crank_speed"], (fS, tS, S))
        if fz is not None:
            k = ENGINE_FAULTS.index(engine["fault"]) if engine["fault"] in ENGINE_FAULTS else int(np.argmax(engine["ensemble"]))
            engine["modality_contrib"] = {"class": FAULT_LABELS[ENGINE_FAULTS[k]],
                                          **{m: r(p, 3) for m, p in fusion.modality_contrib(v, fz["per_modality"], k).items()}}
            sig["mic"] = build_sig(w["mic"], fs, rpm, w["crank_speed"])
        return engine, sig

    def engine_real(self, w, obd):
        """A real recording replayed by the vehicle: the real-audio models classify it. The adaptive baseline is
        skipped: its population prior comes from the simulator, so real sound would always look abnormal to it."""
        x, fs = w["signal"], w["fs"]
        rpm = estimate_rpm(x, fs)                                # from the sound itself; the OBD rpm is simulated
        fS, tS, S = stft_image(x, fs)
        models = real_audio.load_real_models()
        if models is None:
            self.probs.clear()
            self.snr.clear()
            engine = {"state": "running", "status": INFO, "label": "Real recording · real-audio models not trained",
                      "fault": "healthy", "confidence": 0.0, "healthy_p": 0.0, "anomaly": None, "threshold": None,
                      "learned": 0, "context": context_key(rpm, obd["coolant_c"]), "classes": [], "ensemble": [],
                      "votes": {}, "advice": None, "source": "real recording", "clip": w.get("clip")}
            return engine, build_sig(x, fs, rpm, None, (fS, tS, S))
        f = features(x, fs, rpm)
        votes = {SHORT[n]: (cnn_proba(m, [S])[0] if n == real_audio.CNN_NAME else m.predict_proba(f[None])[0])
                 for n, m in models.items()}
        engine = self.verdict(votes, real_audio.CLASSES, rpm, obd, None, tau=real_audio.threshold() or 0.5)
        engine.update(source="real recording", clip=w.get("clip"))
        if engine["status"] == UNSURE:
            engine["why_unsure"] = why_unsure(engine, None, None)
        return engine, build_sig(x, fs, rpm, None, (fS, tS, S))

    def verdict(self, votes, classes, rpm, obd, score, anomaly=False, tau=0.5):
        """Smoothed ensemble -> status, label and advice. A fault must hold for 2 frames at >= tau; below tau the
        models are unsure, which is its own status (not "Healthy")."""
        ens = np.mean(list(votes.values()), axis=0)
        self.probs.append(ens)
        smooth = np.mean(self.probs, axis=0)
        k = int(smooth.argmax())
        fault = classes[k]
        sure = k != 0 and smooth[k] >= tau and len(self.probs) >= 3
        self.streak = self.streak + 1 if sure else 0
        advice = ENGINE_ADVICE[fault] if self.streak >= 2 else None
        unsure = not advice and smooth[k] < tau
        if advice:
            status, label = advice[0], FAULT_LABELS[fault]
        elif unsure:
            status, label = UNSURE, "Unsure · the models disagree"
        elif anomaly:
            status, label = INFO, "Sounds different from this car's normal"
        else:
            status, label = "ok", "Healthy"
        base = self._baseline()
        learned = sum(s["n"] for s in base.state.values())
        return {"state": "running", "status": status, "label": label,
                "fault": fault if advice else UNSURE if unsure else "healthy", "unsure_below": tau,
                "confidence": float(smooth[k]), "healthy_p": float(smooth[0]),
                "anomaly": None if score is None else float(score), "threshold": base.threshold, "learned": learned,
                "context": context_key(rpm, obd["coolant_c"]), "classes": [FAULT_LABELS[c] for c in classes],
                "ensemble": [r(p, 4) for p in smooth], "votes": {m: [r(p, 4) for p in pv] for m, pv in votes.items()},
                "advice": advice}


    @staticmethod
    def systems(obd, engine, alerts):
        on = obd["ignition"]
        titles = " | ".join(a.title.lower() for a in alerts)
        sev_of = lambda word: max((RANK[a.severity] for a in alerts if word in a.title.lower()), default=0)  # noqa: E731
        back = {v: k for k, v in RANK.items()}
        out = []

        def add(id_, name, zones, status, detail):
            out.append({"id": id_, "name": name, "zones": zones, "status": status, "detail": detail})

        eng = engine
        if eng.get("fault") == "misfire":
            add("ecu", "ECU & fault codes", ["engine"], WARNING, "P0300 · misfire detected")
        elif any(a.severity == CRITICAL for a in alerts):
            add("ecu", "ECU & fault codes", ["engine"], INFO, "Fault codes stored for the workshop")
        else:
            add("ecu", "ECU & fault codes", ["engine"], "ok", "No stored or pending codes")

        bv = obd["battery_v"]
        b = sev_of("battery") or sev_of("belt likely broken")
        add("battery", "Battery & charging", ["battery"], back[b] if b else "ok",
            f"Not charging · {bv:.1f} V" if b else f"Charging · {bv:.1f} V" if on else f"Resting · {bv:.1f} V")

        if eng["state"] == "off":
            add("engine", "Engine sound & vibration", ["engine"], "ok", "Engine off")
        else:
            add("engine", "Engine sound & vibration", ["engine"], eng["status"],
                f"{eng['label']} · {eng['confidence']:.0%}" if eng["status"] != "ok" else
                f"Normal · {eng['healthy_p']:.0%} healthy, deviation {eng['anomaly']:.1f}" if eng["anomaly"] is not None
                else f"Normal · {eng['healthy_p']:.0%} healthy · {eng.get('source', '')}")

        c = max(sev_of("overheat"), sev_of("running hot"), sev_of("belt likely broken"), sev_of("temperature"))
        add("cooling", "Cooling system", ["cooling"], back[c] if c else "ok", f"Coolant {obd['coolant_c']:.0f} °C"
            + (" · warming up" if on and obd["coolant_c"] < 75 and not c else ""))

        o = sev_of("oil pressure")
        add("oil", "Lubrication", ["engine"], back[o] if o else "ok",
            f"Oil {obd['oil_pressure_bar']:.1f} bar at {obd['rpm']:.0f} rpm" if on else "Engine off")

        fl = max(sev_of("fuel leak"), sev_of("lean"), sev_of("low fuel"))
        add("fuel", "Fuel & intake", ["fuel"], back[fl] if fl else "ok",
            ("Fuel level falling without being burned" if "fuel leak" in titles else
             f"Lean at idle · trim +{obd['ltft_pct']:.0f}%" if "lean" in titles else
             f"Fuel {obd['fuel_level_pct']:.0f}% · trims {obd['ltft_pct']:+.0f}%"))

        worst, tz, detail = 0, [], "All four " + "/".join(f"{obd[z + '_psi']:.0f}" for z, _ in TYRES) + " psi"
        for z, name in TYRES:
            s = sev_of(name + " tyre")
            if s:
                tz.append(z)
                if s >= worst:
                    worst, detail = s, f"{name.capitalize()} {obd[z + '_psi']:.0f} psi"
        add("tyres", "Tyres", tz, back[worst] if worst else "ok", detail)
        add("brakes", "Brakes", [], "ok", "Pads ~68% · fluid OK")
        return out


def fusion_obd(obd, rpm):
    """The vehicle's OBD row in the fusion model's terms (autopulse.fusion.OBD_NAMES)."""
    return {"rpm": rpm, "coolant_c": obd["coolant_c"], "load_pct": obd["engine_load"], "throttle_pct": obd["throttle_pct"],
            "stft_std": obd.get("stft_std", 2.0), "ltft_pct": obd["ltft_pct"]}


SNR_LOW_DB = 3.0   # median frame-energy SNR of the last 5 windows. Simulator test cars: noise x1 rarely below it,
                   # x5 about half the time (median 3.0 dB), x10 nearly always (median 1.6 dB)


def snr_db(x, fs, frame_s=0.005):
    """Rough signal-to-noise: mean frame energy over the quietest 10% of 5 ms frames. Engine impulses rise well
    above the floor between them; broadband noise fills the gaps and pulls this toward 0 dB."""
    n = int(frame_s * fs)
    m = len(x) // n
    e = (np.asarray(x[:m * n], dtype=float).reshape(m, n) ** 2).mean(1)
    return float(10 * np.log10(e.mean() / (np.percentile(e, 10) + 1e-12)))


def why_unsure(engine, rpm, snr):
    """Plain-language reasons for an unsure verdict, from simple checks (rpm, SNR, how split the models are)."""
    why = []
    in_range = rpm is None or TRAIN_RPM_RANGE[0] <= rpm <= TRAIN_RPM_RANGE[1]
    if not in_range:
        why.append(f"rpm {rpm:.0f} outside the training range {TRAIN_RPM_RANGE[0]}-{TRAIN_RPM_RANGE[1]}")
    # the SNR estimate was calibrated inside the training rpm range; at high rpm firings overlap and it reads low
    if in_range and snr is not None and snr < SNR_LOW_DB:
        why.append(f"low signal-to-noise (~{snr:.1f} dB)")
    ens = engine.get("ensemble") or []
    if ens:
        order = np.argsort(ens)[::-1]
        top, second = engine["classes"][order[0]].split(" (")[0], engine["classes"][order[1]].split(" (")[0]
        why.append(f"fault signature weak: models split between {top} {ens[order[0]]:.0%} and {second} "
                   f"{ens[order[1]]:.0%} (a verdict needs {engine['unsure_below']:.0%})")
    return "; ".join(why)


SIM_UNSURE_BELOW = 0.5   # simulator models: the 0.5 the fault rule always used, unless train.py stores another


def sim_threshold():
    """Confidence threshold for the simulator models: models/metrics.json "abstain_threshold" if present, else 0.5."""
    try:
        return float(json.loads((MODELS_DIR / "metrics.json").read_text()).get("abstain_threshold", SIM_UNSURE_BELOW))
    except (OSError, ValueError):
        return SIM_UNSURE_BELOW


SHORT = {"SVM (RBF)": "SVM", "Softmax regression": "Softmax", "ANN (MLP + softmax)": "ANN", "CNN (spectrogram)": "CNN"}


def build_sig(x, fs, rpm, crank_speed=None, stft=None):
    """The Signatures page's views of one window: waveform, spectrum, spectrogram, envelope, orders, crank speed.
    Shared by the live stream (LiveHub.engine) and uploaded clips (/api/classify-audio)."""
    fS, tS, S = stft if stft is not None else stft_image(x, fs)
    fw, P = welch(x, fs, nperseg=1024)
    keep = fw <= 10000
    n = int(0.2 * fs)
    step = max(1, n // 800)
    fe, E = envelope_spectrum(x, fs)
    sel = fe < 400
    fa, X = spectrum(x, fs)
    cs = np.asarray(crank_speed if crank_speed is not None else [], dtype=float)
    return {"rpm": r(rpm, 0),
            "time": {"t_ms": [r(v, 2) for v in np.arange(0, n, step) / fs * 1000], "y": [r(v, 3) for v in x[:n:step]]},
            "spectrum": {"f": [r(v, 1) for v in fw[keep]], "db": [r(v, 2) for v in 10 * np.log10(P[keep] + 1e-12)]},
            "marks": {"0.5x (misfire / cam)": rpm / 120, "1x crank": rpm / 60, "2x firing (I4)": rpm / 30},
            "spectrogram": {"f": [r(v, 0) for v in fS], "t": [r(v, 3) for v in tS], "z": np.round(S, 1).tolist()},
            "envelope": {"f": [r(v, 2) for v in fe[sel]], "y": [r(v, 4) for v in E[sel] / (E[sel].max() + 1e-12)],
                         "orders": [o * rpm / 60 for o in (0.5, 1, 1.5, 2)]},
            "orders": {"labels": [f"{o}×" for o in ORDERS], "amp": [r(v, 5) for v in order_amplitudes(fa, X, rpm)]},
            "crank": {"dev": [r(v, 2) for v in cs - np.median(cs)] if len(cs) else []}}
