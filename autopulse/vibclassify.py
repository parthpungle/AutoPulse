"""Classifier hook for simulated / vehicle vibration streams: the existing AutoPulse ensemble, unchanged."""
import numpy as np

from autopulse.generator import ENGINE_FAULTS, FAULT_LABELS
from autopulse.models import cnn_proba
from autopulse.signatures import features, stft_image


def make_classifier(models):
    """models() -> (feature models dict, cnn or None, prior), as in backend.app. Returns classify(native_window) -> dict.

    The window must be a native 24 kHz simulator window {signal, fs, rpm, crank_speed}: the domain the models were trained on.
    """
    def classify(w):
        try:
            feat, cnn, _ = models()
            x = features(w["signal"], w["fs"], w["rpm"], w["crank_speed"])
            votes = {name: m.predict_proba(x[None])[0] for name, m in feat.items()}
            if cnn is not None:
                votes["CNN"] = cnn_proba(cnn, [stft_image(w["signal"], w["fs"])[2]])[0]
            ens = np.mean(list(votes.values()), axis=0)
        except Exception as e:  # noqa: BLE001 - a failing model must not stop the DSP stream
            return {"status": "error", "label": None, "confidence": None, "probabilities": None, "model": None,
                    "reason": f"Classifier failed: {type(e).__name__}: {e}"}
        k = int(ens.argmax())
        return {"status": "available", "label": FAULT_LABELS[ENGINE_FAULTS[k]], "confidence": float(ens[k]),
                "probabilities": {FAULT_LABELS[c]: float(p) for c, p in zip(ENGINE_FAULTS, ens)},
                "model": {"name": "AutoPulse ensemble (" + " + ".join(votes) + ")",
                          "classes": [FAULT_LABELS[c] for c in ENGINE_FAULTS],
                          "domain": "Simulated engine-block vibration, 24 kHz, 1 s windows, known RPM.",
                          "limitations": "Trained and tested on simulator output only; not validated on real engines. "
                                         "Classifies the native 24 kHz source signal, not the resampled X/Y/Z channels."},
                "reason": None}
    return classify
