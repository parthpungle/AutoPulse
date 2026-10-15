// Split dashboard: Insights -> Vibration analysis. The paired vehicle's stream, or a recorded CSV.
// There is no dashboard-side simulator here: what the engine is doing (car, fault, severity, driving) is chosen
// on the vehicle laptop (vehicle.html), and this tab analyses what it streams without being told.
import { useState } from 'react';
import { Tabs } from '../components/ui.jsx';
import CsvAnalysis from './VibrationAnalysis.jsx';
import VibrationLive from './VibrationLive.jsx';

export default function VibrationTab() {
  const [mode, setMode] = useState('vehicle');
  return (
    <div className="stack">
      <Tabs items={[['vehicle', 'Paired vehicle'], ['csv', 'Recorded CSV']]} value={mode} onChange={setMode} />
      {mode === 'vehicle' && <VibrationLive key="veh" source="vehicle" />}
      {mode === 'csv' && <CsvAnalysis />}
    </div>
  );
}
