// Insights -> Vibration analysis: live simulation first, recorded CSV second.
import { useState } from 'react';
import { Tabs } from '../components/ui.jsx';
import CsvAnalysis from './VibrationAnalysis.jsx';
import VibrationLive from './VibrationLive.jsx';

export default function VibrationTab() {
  const [mode, setMode] = useState('live');
  return (
    <div className="stack">
      <Tabs items={[['live', 'Live simulation'], ['csv', 'Recorded CSV']]} value={mode} onChange={setMode} />
      {mode === 'live' ? <VibrationLive /> : <CsvAnalysis />}
    </div>
  );
}
