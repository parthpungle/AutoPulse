function crank_sim(outDir)
%CRANK_SIM  4-cylinder engine crankshaft dynamics with misfire injection (base MATLAB, ode45).
%
%   An independent physics simulator for AutoPulse: it solves
%       J * dw/dt = sum_k T_gas,k(theta) - T_load(w)
%   for a 4-stroke 4-cylinder engine (firing order 1-3-4-2), and writes the crank speed
%   seen by a 60-2 tooth wheel, averaged per firing event, to out/crank_runs.csv.
%   Python (scripts/matlab_crosscheck.py) then tests our misfire detection on this data.
%
%   Gas torque per cylinder: compression pulls the crank back before TDC, expansion pushes it after.
%   Combustion adds a larger push after TDC. A misfire removes the combustion part only, so the
%   cylinder's net torque falls to ~0 and the crank slows for that firing event.

if nargin < 1, outDir = fullfile(fileparts(mfilename('fullpath')), 'out'); end
if ~exist(outDir, 'dir'), mkdir(outDir); end

J = 0.18;                 % crank + flywheel + clutch inertia [kg m^2]
order = [1 3 4 2];        % firing order
tdc = [0 180 360 540];    % TDC of each firing slot within 720 deg
Tcomp = 28;               % compression/expansion torque amplitude [N m]
Tcomb = 95;               % combustion torque amplitude at full load [N m]

rpms = [800 1500 2500 3500];
cases = {0, 1.0; 1, 1.0; 2, 1.0; 3, 1.0; 4, 1.0; 2, 0.5; 3, 0.5};   % {misfire cylinder (0 = none), severity}
rows = {};
run = 0;
for r = rpms
    for c = 1:size(cases, 1)
        for rep = 1:3
            run = run + 1;
            mcyl = cases{c, 1};
            sev = cases{c, 2};
            rng(1000 * run);
            w0 = r * pi / 30;
            load = 0.5 + r / 7000;                       % part load rising with speed
            Tc = Tcomb * load * (1 + 0.04 * randn(1, 4)); % small cylinder-to-cylinder spread
            % load torque chosen so the healthy engine holds the target speed on average
            meanGas = sum(Tc) * gasMean();
            c1 = 0.25 * meanGas / w0;                    % speed-dependent part (friction, aero)
            c0 = meanGas - c1 * w0;
            gas = @(th) gasTorque(th, Tc, Tcomp, mcyl, sev, order, tdc);
            f = @(t, y) [y(2); (gas(y(1)) - (c0 + c1 * y(2))) / J];
            T = 2.0;                                     % seconds of simulated running
            opts = odeset('RelTol', 1e-7, 'AbsTol', 1e-9, 'MaxStep', 2e-4);
            [t, y] = ode45(f, [0 T], [rand * 4 * pi; w0], opts);
            % 60-2 tooth wheel: one speed sample every 6 deg, then average per 180 deg firing interval
            % intervals run from one TDC to the next (absolute crank angle), so each one is a
            % single cylinder's power stroke
            thDeg = rad2deg(y(:, 1));
            edges = ceil(thDeg(1) / 180) * 180 : 180 : floor(thDeg(end) / 180) * 180;
            wEdge = interp1(thDeg, y(:, 2), edges) * 30 / pi;   % instantaneous speed at each TDC [rpm]
            for k = 2:numel(edges) - 1                   % skip the first interval (start-up transient)
                sel = thDeg >= edges(k) & thDeg < edges(k + 1);
                if nnz(sel) < 5, continue; end
                dur = t(find(sel, 1, 'last')) - t(find(sel, 1, 'first'));
                spanDeg = thDeg(find(sel, 1, 'last')) - thDeg(find(sel, 1, 'first'));
                meanRpm = spanDeg / 360 / dur * 60;
                slot = mod(round(edges(k) / 180), 4) + 1;   % TDC at 0/180/360/540 deg -> firing slot 1..4
                rows(end + 1, :) = {run, r, mcyl, sev, k - 1, order(slot), meanRpm, ...
                                    wEdge(k), wEdge(k + 1)}; %#ok<AGROW>
            end
        end
    end
end
tbl = cell2table(rows, 'VariableNames', {'run', 'rpm_target', 'misfire_cyl', 'severity', ...
                                         'firing_idx', 'cylinder', 'speed_rpm', 'start_rpm', 'end_rpm'});
writetable(tbl, fullfile(outDir, 'crank_runs.csv'));
fprintf('crank_sim: %d runs, %d firing events -> %s\n', run, height(tbl), fullfile(outDir, 'crank_runs.csv'));
end

function m = gasMean()
% mean over 720 deg of one cylinder's unit combustion pulse (compression/expansion cancel out)
phi = linspace(-360, 360, 7201);
m = mean(combPulse(phi)) ;
end

function p = combPulse(phi)
% combustion torque shape: peaks ~25 deg after TDC, gone by ~120 deg
p = max(sind(min(max(phi, 0), 180) * 1.5), 0) .* exp(-max(phi, 0) / 60);
end

function T = gasTorque(th, Tc, Tcomp, mcyl, sev, order, tdc)
deg = mod(rad2deg(th), 720);
T = 0;
for s = 1:4
    phi = mod(deg - tdc(s) + 360, 720) - 360;            % crank angle relative to this cylinder's TDC
    cyl = order(s);
    % compression (before TDC, negative) and expansion of the trapped charge (after TDC, positive)
    T = T + Tcomp * sind(2 * phi) .* (abs(phi) < 90);
    k = 1;
    if cyl == mcyl, k = 1 - sev; end
    T = T + k * Tc(cyl) * combPulse(phi);
end
end
