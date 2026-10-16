"""What the vehicle puts on the network, and how the dashboard reads it back.

One JSON message per second over a WebSocket (ws://<vehicle>:8200/ws/stream?code=<pairing code>):

    {"type": "frame", "seq": 412, "sent": 1760612345.12,
     "vehicle": {"name": "LAPTOP-7", "car_type": "sedan", "label": "Sedan · 1.5 L petrol", "unit": 8},
     "obd": {"t": 300, "speed_kph": 48.2, "rpm": 1710.0, "coolant_c": 90.1, ...},       # 1 Hz OBD-II row
     "vib": {"fs": 24000, "rpm": 1710.0, "scale": 3.1e-05, "pcm": "<base64 int16>",    # 1 s of block vibration
             "crank": [1712.4, 1698.0, ...],                                           # rpm at every firing
             "mic": {"scale": 1.2e-05, "pcm": "<base64 int16>"},                       # 1 s of engine sound
             "source": "sim", "clip": null}}             # "replay" = a real recording, clip = its name

vib.pcm is the block accelerometer; vib.mic (simulated engines only) the microphone at the same rate, both
int16 with their own scale (~64 kB each per second as base64). The models run on the dashboard, so both go out.

vib is null while the engine is off. A replayed real recording has no crank sensor (crank is empty) and its rpm
field is the simulated OBD rpm, not the recording's. The vehicle never sends which faults were injected:
the dashboard has to work that out from the sensor data alone.
"""
import base64

import numpy as np

PROTOCOL = 1
STREAM_PORT = 8200
BEACON_PORT = 8201


def encode_frame(seq, sent, vehicle, obd, vib):
    v = None
    if vib is not None:
        v = {"fs": int(vib["fs"]), "rpm": float(vib["rpm"]), **_pcm(vib["signal"]),
             "crank": [round(float(c), 2) for c in vib["crank_speed"]],
             "source": vib.get("source", "sim"), "clip": vib.get("clip")}
        if vib.get("mic") is not None:
            v["mic"] = _pcm(vib["mic"])
    obd = {k: (round(val, 3) if isinstance(val, float) else val) for k, val in obd.items()}
    return {"type": "frame", "protocol": PROTOCOL, "seq": seq, "sent": sent, "vehicle": vehicle, "obd": obd, "vib": v}


def _pcm(x):
    x = np.asarray(x, dtype=np.float32)
    scale = float(np.abs(x).max() / 32767) or 1e-9
    return {"scale": scale, "pcm": base64.b64encode(np.round(x / scale).astype("<i2").tobytes()).decode("ascii")}


def _unpcm(d):
    return np.frombuffer(base64.b64decode(d["pcm"]), dtype="<i2").astype(np.float32) * d["scale"]


def decode_vibration(v):
    """Back to the float signals the signature extractor expects (mic is None when not sent)."""
    return {"signal": _unpcm(v), "mic": _unpcm(v["mic"]) if v.get("mic") else None, "fs": v["fs"], "rpm": v["rpm"],
            "crank_speed": np.asarray(v["crank"], dtype=float), "source": v.get("source", "sim"), "clip": v.get("clip")}
