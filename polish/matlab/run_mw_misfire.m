% Run MathWorks' "Detect Misfires Using On-Board Diagnostics" example (Simulink + Powertrain Blockset
% + AUTOSAR Blockset) headlessly, and save its logged signals for AutoPulse.
%   matlab -batch "cd matlab; run_mw_misfire"
% Note: the model's StopFcn reads a workspace variable called `out`, so this script never uses that name.
here = fileparts(mfilename('fullpath'));
dest = fullfile(here, 'mw_misfire');
resultsDir = fullfile(here, 'out');
if ~exist(resultsDir, 'dir'), mkdir(resultsDir); end
mdl = 'autoblkSICoreOBDMisfire';

if isempty(dir(fullfile(dest, '**', [mdl '.slx'])))
    try
        evalc('openExample(''autoblks_autosarblockset/UseOBDtoDetectMisfireExample'', ''workDir'', dest)');
    catch err
        fprintf('openExample: %s\n', strtok(err.message, newline));
    end
end
f = dir(fullfile(dest, '**', [mdl '.slx']));
if isempty(f), error('Example model %s not found under %s', mdl, dest); end
addpath(genpath(f(1).folder));
cd(f(1).folder);

load_system(mdl);
fprintf('StopTime: %s, logging name: %s\n', get_param(mdl, 'StopTime'), get_param(mdl, 'SignalLoggingName'));
tic;
simOut = sim(mdl, 'ReturnWorkspaceOutputs', 'on');
fprintf('simulated in %.0f s\n', toc);

S = struct();
listing = {};
for w = simOut.who'
    v = simOut.get(w{1});
    fprintf('output variable: %s (%s)\n', w{1}, class(v));
    if isa(v, 'Simulink.SimulationData.Dataset')
        for i = 1:v.numElements
            el = v{i};
            nm = matlab.lang.makeValidName([w{1} '_' el.Name]);
            try
                ts = el.Values;
                if isa(ts, 'timeseries')
                    y = squeeze(ts.Data);
                    S.(nm) = struct('t', ts.Time, 'y', double(y));
                    listing{end + 1} = sprintf('%s [%s] min %.3g max %.3g', nm, mat2str(size(y)), ...
                                               min(double(y(:))), max(double(y(:)))); %#ok<SAGROW>
                end
            catch
            end
        end
    end
end
% this model returns its signals as a struct (sdiout); describe it and keep it whole
if any(strcmp(simOut.who, 'sdiout'))
    sdiout = simOut.get('sdiout');
    describe(sdiout, 'sdiout', 0);
    save(fullfile(resultsDir, 'mw_misfire_sdiout.mat'), 'sdiout');
end
fprintf('logged signals (%d):\n', numel(listing));
fprintf('  %s\n', listing{:});
save(fullfile(resultsDir, 'mw_misfire_logs.mat'), 'S');

function describe(v, name, depth)
pad = repmat('  ', 1, depth);
if isstruct(v)
    fn = fieldnames(v);
    fprintf('%s%s: struct %s, fields: %s\n', pad, name, mat2str(size(v)), strjoin(fn', ', '));
    if depth < 4
        for i = 1:numel(fn)
            describe(v(1).(fn{i}), fn{i}, depth + 1);
        end
    end
elseif isa(v, 'timeseries')
    fprintf('%s%s: timeseries %s, %d samples\n', pad, name, mat2str(size(squeeze(v.Data))), numel(v.Time));
elseif isa(v, 'Simulink.SimulationData.Dataset')
    fprintf('%s%s: Dataset with %d elements\n', pad, name, v.numElements);
    for i = 1:min(v.numElements, 40)
        fprintf('%s  [%d] %s\n', pad, i, v{i}.Name);
    end
else
    fprintf('%s%s: %s %s\n', pad, name, class(v), mat2str(size(v)));
end
end
bdclose all
