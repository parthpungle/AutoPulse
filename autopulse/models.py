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


def train_cnn(specs, y, n_classes, epochs=18, seed=0):
    torch.manual_seed(seed)
    X = torch.tensor(np.stack([normalize_spec(s) for s in specs])[:, None], dtype=torch.float32)
    Y = torch.tensor(y, dtype=torch.long)
    model = make_cnn(n_classes)
    opt = torch.optim.Adam(model.parameters(), lr=2e-3)
    loss_fn = nn.CrossEntropyLoss()
    for _ in range(epochs):
        model.train()
        perm = torch.randperm(len(X))
        for i in range(0, len(X), 64):
            b = perm[i:i + 64]
            opt.zero_grad()
            loss_fn(model(X[b]), Y[b]).backward()
            opt.step()
    return model.eval()


def cnn_proba(model, specs):
    X = torch.tensor(np.stack([normalize_spec(s) for s in specs])[:, None], dtype=torch.float32)
    with torch.no_grad():
        return torch.softmax(model(X), dim=1).numpy()
