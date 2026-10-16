"""What the vehicle puts on the network, and how the dashboard reads it back.

One JSON message per second over a WebSocket (ws://<vehicle>:8200/ws/stream?code=<pairing code>):

    {"type": "frame", "seq": 412, "sent": 1760612345.12,
     "vehicle": {"name": "LAPTOP-7", "car_type": "sedan", "label": "Sedan · 1.5 L petrol", "unit": 8},
     "obd": {"t": 300, "speed_kph": 48.2, "rpm": 1710.0, "coolant_c": 90.1, ...},       # 1 Hz OBD-II row
     "vib": {"fs": 24000, "rpm": 1710.0, "scale": 3.1e-05, "pcm": "<base64 int16>",    # 1 s of block vibration
             "crank": [1712.4, 1698.0, ...]}}                                          # rpm at every firing

vib is null while the engine is off. The vehicle never sends which faults were injected:
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
        x = np.asarray(vib["signal"], dtype=np.float32)
        scale = float(np.abs(x).max() / 32767) or 1e-9
        pcm = np.round(x / scale).astype("<i2").tobytes()
        v = {"fs": int(vib["fs"]), "rpm": float(vib["rpm"]), "scale": scale,
             "pcm": base64.b64encode(pcm).decode("ascii"),
             "crank": [round(float(c), 2) for c in vib["crank_speed"]]}
    obd = {k: (round(val, 3) if isinstance(val, float) else val) for k, val in obd.items()}
    return {"type": "frame", "protocol": PROTOCOL, "seq": seq, "sent": sent, "vehicle": vehicle, "obd": obd, "vib": v}


def decode_vibration(v):
    """Back to the float signal the signature extractor expects."""
    x = np.frombuffer(base64.b64decode(v["pcm"]), dtype="<i2").astype(np.float32) * v["scale"]
    return {"signal": x, "fs": v["fs"], "rpm": v["rpm"], "crank_speed": np.asarray(v["crank"], dtype=float)}
