// Split dashboard: Insights -> Vibration analysis, with three sources (see vibModes.js):
//   Paired vehicle   follows the vehicle laptop; the fault is chosen on vehicle.html and never sent to the dashboard
//   Recorded CSV     upload and analyse a recording
//   Live simulation  the dashboard's own simulated accelerometer, controlled here; no vehicle or file needed
// Each live mode is keyed, so switching unmounts the previous view: its WebSocket closes and the server
// cancels that run before the next one connects.
import { useState } from 'react';
import { Tabs } from '../components/ui.jsx';
import CsvAnalysis from './VibrationAnalysis.jsx';
import VibrationLive from './VibrationLive.jsx';
import { DEFAULT_MODE, VIBRATION_MODES, modeById } from '../vibModes.js';

export default function VibrationTab() {
  const [mode, setMode] = useState(DEFAULT_MODE);
  const m = modeById(mode);
  return (
    <div className="stack">
      <Tabs items={VIBRATION_MODES.map((x) => [x.id, x.label])} value={m.id} onChange={setMode} />
      {m.view === 'live' && <VibrationLive key={m.id} source={m.source} />}
      {m.view === 'csv' && <CsvAnalysis />}
    </div>
  );
}
