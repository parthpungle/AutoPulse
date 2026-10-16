import numpy as np

from autopulse import fusion
from autopulse.generator import make_car, synth_window
from autopulse.signatures import FEATURE_NAMES as SIG


def test_fused_features_shape_and_names():
    w = synth_window("belt_squeal", rpm=2000, car=make_car(2), rng=np.random.default_rng(0))
    v = fusion.fused_features(w["mic"], w["accel"], w["fs"], w["obd"], w["crank_speed"])
    assert v.shape == (len(fusion.FEATURE_NAMES),) == (2 * len(SIG) + len(fusion.OBD_NAMES),)
    assert np.isfinite(v).all()
    assert len(set(fusion.FEATURE_NAMES)) == len(fusion.FEATURE_NAMES)
    assert fusion.FEATURE_NAMES[0].startswith("mic_") and fusion.FEATURE_NAMES[len(SIG)].startswith("acc_")
    assert all(n.startswith("obd_") for n in fusion.FEATURE_NAMES[2 * len(SIG):])


def test_modality_slices_cover_the_vector():
    n = len(fusion.FEATURE_NAMES)
    covered = sorted(i for s in fusion.MODALITIES.values() for i in range(*s.indices(n)))
    assert covered == list(range(n))


def test_late_fusion_weighted_mean():
    p = {"mic": np.array([[0.8, 0.2]]), "accel": np.array([[0.2, 0.8]]), "obd": np.array([[0.5, 0.5]])}
    out = fusion.late_fusion(p, {"mic": 1, "accel": 1, "obd": 0})
    assert np.allclose(out, [[0.5, 0.5]])
