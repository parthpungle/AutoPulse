function signature_check(outDir)
%SIGNATURE_CHECK  Independent base-MATLAB re-implementation of AutoPulse's signature features.
%
%   Reads real engine-audio windows exported by Python (scripts/matlab_crosscheck.py export),
%   recomputes 23 of the 28 features from first principles (no toolboxes), and writes them to
%   out/matlab_features.mat. Python then compares them feature by feature with its own values.
%   The 5 filter-based features (Hilbert envelope, knock band) need Signal Processing Toolbox
%   and are checked once it is installed.

if nargin < 1, outDir = fullfile(fileparts(mfilename('fullpath')), 'out'); end
S = load(fullfile(outDir, 'audio_windows.mat'));
X = S.X; fs = S.fs; rpm = S.rpm(:);
bands = [20 200; 200 500; 500 1000; 1000 2000; 2000 3000; 3000 4000; 4000 5000; 5000 6000; 6000 7500; 7500 10000];
orders = [0.5 1 1.5 2 3 4];
F = zeros(size(X, 1), 5 + size(bands, 1) + numel(orders) + 2);
for i = 1:size(X, 1)
    x = X(i, :);
    n = numel(x);
    rmsv = sqrt(mean(x .^ 2)) + 1e-9;
    mu = mean(x); sd = sqrt(mean((x - mu) .^ 2));
    kurt = mean((x - mu) .^ 4) / sd ^ 4 - 3;            % excess kurtosis (Fisher), as scipy.stats
    skw = mean((x - mu) .^ 3) / sd ^ 3;
    zcr = mean(abs(diff(sign(x)))) / 2;

    w = 0.5 - 0.5 * cos(2 * pi * (0:n - 1) / (n - 1));  % symmetric Hann window, as numpy.hanning
    Xf = abs(fft(x .* w));
    Xf = Xf(1:floor(n / 2) + 1) * 2 / sum(w);           % single-sided amplitude spectrum
    f = (0:floor(n / 2)) * fs / n;
    P = Xf .^ 2;
    total = sum(P) + 1e-9;
    bandE = zeros(1, size(bands, 1));
    for b = 1:size(bands, 1)
        bandE(b) = log10(sum(P(f >= bands(b, 1) & f < bands(b, 2))) / total + 1e-9);
    end
    frev = rpm(i) / 60;
    ordA = zeros(1, numel(orders));
    for o = 1:numel(orders)
        [~, k] = min(abs(f - orders(o) * frev));
        ordA(o) = log10(max(Xf(max(k - 1, 1):min(k + 1, end))) / rmsv + 1e-9);
    end
    centroid = sum(f .* P) / total / 1000;
    flat = exp(mean(log(P(2:end) + 1e-9))) / (mean(P(2:end)) + 1e-9);
    F(i, :) = [log10(rmsv), max(abs(x)) / rmsv, kurt, skw, zcr, bandE, ordA, centroid, flat];
end
save(fullfile(outDir, 'matlab_features.mat'), 'F');
fprintf('signature_check: %d windows x %d features -> %s\n', size(F, 1), size(F, 2), fullfile(outDir, 'matlab_features.mat'));
end
