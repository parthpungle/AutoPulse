// Split dashboard: the sources the Insights -> Vibration analysis tab can show. Plain data, tested without a browser.
//   vehicle  the paired vehicle laptop's 24 kHz windows; what is injected is chosen on vehicle.html, never sent here
//   csv      an uploaded recording, analysed once
//   sim      the dashboard API's own SIMULATED 3-axis accelerometer, with its controls (autopulse/vibsim.py)
export const VIBRATION_MODES = [
  { id: 'vehicle', label: 'Paired vehicle', view: 'live', source: 'vehicle' },
  { id: 'csv', label: 'Recorded CSV', view: 'csv', source: null },
  { id: 'sim', label: 'Live simulation', view: 'live', source: 'simulator' },
];

export const DEFAULT_MODE = 'vehicle';

export const modeById = (id) => VIBRATION_MODES.find((m) => m.id === id) || VIBRATION_MODES[0];
