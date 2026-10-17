// Dev only: record the live frames for a repeatable demo. Save, put the file in public/replays/, then
// open /dashboard?page=signatures&replay=<file name without .json>.
import { useState } from 'react';
import { Circle, Square } from 'lucide-react';
import { recorder } from '../../live.jsx';

export default function Recorder({ history, vehicle }) {
  const [on, setOn] = useState(recorder.on);
  const start = () => { recorder.start(history); setOn(true); };
  const stop = () => {
    const data = recorder.stop();
    setOn(false);
    const name = `${vehicle?.car_type ?? 'car'}-${new Date().toISOString().slice(0, 16).replace(/[:T]/g, '-')}`;
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([JSON.stringify(data)], { type: 'application/json' }));
    a.download = `${name}.json`;
    a.click();
    URL.revokeObjectURL(a.href);
  };
  return on
    ? <button className="btn" onClick={stop} title="Save the recording as JSON"><Square size={13} />Stop and save · {recorder.count} s</button>
    : <button className="btn ghost" onClick={start} title="Dev only: record frames for a replay"><Circle size={13} />Record demo</button>;
}
