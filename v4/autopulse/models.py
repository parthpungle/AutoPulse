"""Pattern recognition models named in the problem statement: SVM, Softmax regression, ANN, CNN."""
import numpy as np
from sklearn.linear_model import LogisticRegression
from sklearn.neural_network import MLPClassifier
from sklearn.pipeline import make_pipeline
from sklearn.preprocessing import StandardScaler
from sklearn.svm import SVC


def feature_models():
    """Classifiers on hand-crafted signature vectors."""
    return {
        "SVM (RBF)": make_pipeline(StandardScaler(), SVC(C=10, gamma="scale", probability=True)),
        "Softmax regression": make_pipeline(StandardScaler(), LogisticRegression(max_iter=3000, C=1.0)),
        "ANN (MLP + softmax)": make_pipeline(StandardScaler(), MLPClassifier(
            hidden_layer_sizes=(64, 32), max_iter=800, early_stopping=True, random_state=0)),
    }


try:  # the CNN is optional so the rest of the pipeline runs without PyTorch installed
    import torch
    from torch import nn
    HAS_TORCH = True
except ImportError:
    HAS_TORCH = False


def normalize_spec(S):
    return (S - S.mean()) / (S.std() + 1e-6)


def make_cnn(n_classes):
    """Small 2D CNN on log-STFT spectrograms (64 freq bins x T frames)."""
    return nn.Sequential(
        nn.Conv2d(1, 16, 3, padding=1), nn.BatchNorm2d(16), nn.ReLU(), nn.MaxPool2d(2),
        nn.Conv2d(16, 32, 3, padding=1), nn.BatchNorm2d(32), nn.ReLU(), nn.MaxPool2d(2),
        nn.Conv2d(32, 64, 3, padding=1), nn.BatchNorm2d(64), nn.ReLU(),
        nn.AdaptiveAvgPool2d(1), nn.Flatten(), nn.Dropout(0.2), nn.Linear(64, n_classes),
    )


def spec_augment(xb, gen, n_freq_masks=2, max_freq=8, n_time_masks=2, max_time_frac=0.10):
    """SpecAugment on a batch (B, 1, F, T) of normalised spectrograms: zero (= the mean) random frequency bands
    of up to max_freq bins and random time spans of up to max_time_frac of the frames."""
    xb = xb.clone()
    B, _, F, T = xb.shape
    for i in range(B):
        for _ in range(n_freq_masks):
            w = int(torch.randint(0, max_freq + 1, (1,), generator=gen))
            f0 = int(torch.randint(0, max(1, F - w), (1,), generator=gen))
            xb[i, :, f0:f0 + w, :] = 0
        for _ in range(n_time_masks):
            w = int(torch.randint(0, max(1, int(max_time_frac * T)) + 1, (1,), generator=gen))
            t0 = int(torch.randint(0, max(1, T - w), (1,), generator=gen))
            xb[i, :, :, t0:t0 + w] = 0
    return xb


def train_cnn(specs, y, n_classes, epochs=18, seed=0, init=None, lr=2e-3, augment=False, class_weighted=False,
              groups=None, patience=None, seeds=None):
    """init: a trained CNN to start from (fine-tuning, e.g. simulator-pretrained), usually with a lower lr.
    Optional, all off by default (train.py's behaviour is unchanged):
      augment         SpecAugment (2 frequency masks <= 8 bins, 2 time masks <= 10%)
      class_weighted  cross-entropy weighted by inverse class frequency
      groups+patience early stopping: hold out ~20% of the groups (e.g. recordings) as validation, train up to
                      `epochs`, stop after `patience` epochs without a better validation loss, keep the best weights
      seeds           train one model per seed and return the list (cnn_proba averages their probabilities)"""
    if seeds:
        return [train_cnn(specs, y, n_classes, epochs, s, init, lr, augment, class_weighted, groups, patience)
                for s in seeds]
    torch.manual_seed(seed)
    X = torch.tensor(np.stack([normalize_spec(s) for s in specs])[:, None], dtype=torch.float32)
    Y = torch.tensor(y, dtype=torch.long)
    Xv = Yv = None
    if groups is not None and patience:
        from sklearn.model_selection import StratifiedGroupKFold
        tr, va = next(StratifiedGroupKFold(5, shuffle=True, random_state=seed).split(np.zeros(len(y)), y, groups))
        X, Y, Xv, Yv = X[tr], Y[tr], X[va], Y[va]
    model = make_cnn(n_classes)
    if init is not None:
        model.load_state_dict(init.state_dict())
    opt = torch.optim.Adam(model.parameters(), lr=lr)
    weight = None
    if class_weighted:
        counts = np.bincount(Y.numpy(), minlength=n_classes).astype(float)
        weight = torch.tensor(len(Y) / (n_classes * np.maximum(counts, 1)), dtype=torch.float32)
    loss_fn = nn.CrossEntropyLoss(weight=weight)
    gen = torch.Generator().manual_seed(seed + 1) if augment else None
    best, best_state, since = np.inf, None, 0
    for _ in range(epochs):
        model.train()
        perm = torch.randperm(len(X))
        for i in range(0, len(X), 64):
            b = perm[i:i + 64]
            xb = spec_augment(X[b], gen) if augment else X[b]
            opt.zero_grad()
            loss_fn(model(xb), Y[b]).backward()
            opt.step()
        if Xv is not None:
            model.eval()
            with torch.no_grad():
                v = float(loss_fn(model(Xv), Yv))
            if v < best - 1e-4:
                best, since = v, 0
                best_state = {k: t.clone() for k, t in model.state_dict().items()}
            else:
                since += 1
                if since >= patience:
                    break
    if best_state is not None:
        model.load_state_dict(best_state)
    return model.eval()


def cnn_proba(model, specs):
    """Class probabilities; a list of CNNs (seed-averaging) gives the mean of their probabilities."""
    if isinstance(model, (list, tuple)):
        return np.mean([cnn_proba(m, specs) for m in model], axis=0)
    X = torch.tensor(np.stack([normalize_spec(s) for s in specs])[:, None], dtype=torch.float32)
    with torch.no_grad():
        return torch.softmax(model(X), dim=1).numpy()
