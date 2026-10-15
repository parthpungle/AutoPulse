% Export the MathWorks misfire example's logged signals (sdiout timeseries) to a plain CSV
% for Python: time, crank angle, engine speed, cylinder-3 misfire flag, indicated torque.
% Decimated from 500 kHz to 50 kHz (still ~0.2 deg of crank per sample at 1,500 rpm).
here = fileparts(mfilename('fullpath'));
L = load(fullfile(here, 'out', 'mw_misfire_sdiout.mat'));
s = L.sdiout;
t = s.EngineSpeed.Time;
step = 10;
idx = 1:step:numel(t);
tt = t(idx);
res = @(ts) interp1(ts.Time, double(squeeze(ts.Data)), tt, 'previous', 'extrap');
T = table(tt, res(s.CrankAngle), res(s.EngineSpeed), res(s.MisfireEventCyl3), res(s.IndicatedTorque), ...
          'VariableNames', {'t', 'crank_angle', 'engine_speed', 'misfire_cyl3', 'indicated_torque'});
writetable(T, fullfile(here, 'out', 'mw_misfire_signals.csv'));
fprintf('exported %d samples; crank angle %.1f..%.1f; speed %.1f..%.1f; misfire flag max %g\n', height(T), ...
        min(T.crank_angle), max(T.crank_angle), min(T.engine_speed), max(T.engine_speed), max(T.misfire_cyl3));
