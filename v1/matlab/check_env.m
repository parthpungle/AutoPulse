% Print MATLAB version, which products this licence covers, and which are actually installed.
fprintf('MATLAB %s\n', version);
products = {'Simulink', 'Signal_Toolbox', 'Statistics_Toolbox', 'Powertrain_Blockset', ...
            'AUTOSAR_Blockset', 'Neural_Network_Toolbox'};
for k = 1:numel(products)
    fprintf('%-24s licensed: %d\n', products{k}, license('test', products{k}));
end
v = ver;
fprintf('Installed: %s\n', strjoin({v.Name}, ', '));
fprintf('Simulink usable (new_system on path): %d\n', exist('new_system', 'file') > 0);
fprintf('Signal Processing usable (hilbert on path): %d\n', exist('hilbert', 'file') > 0);
