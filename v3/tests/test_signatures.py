import numpy as np
import pytest

from autopulse.signatures import FEATURE_NAMES, features, stft_image

FS = 24000
T = np.arange(FS) / FS


@pytest.mark.parametrize("name,x", [
    ("silence", np.zeros(FS)),
    ("sine", np.sin(2 * np.pi * 440 * T)),
    ("noise", np.random.default_rng(0).normal(size=FS)),
])
def test_features_length_and_finite(name, x):
    f = features(x.astype(np.float32), FS, 1500.0)
    assert len(f) == len(FEATURE_NAMES)
    assert np.isfinite(f).all(), name


def test_stft_image_shape():
    f, t, S = stft_image(np.random.default_rng(1).normal(size=FS), FS)
    assert S.shape[0] == 64 and S.shape[1] == len(t) and np.isfinite(S).all()
