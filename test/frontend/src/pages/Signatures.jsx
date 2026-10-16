import { useCallback, useMemo, useState } from 'react';
import { Power } from 'lucide-react';
import LineChart from '../components/charts/LineChart.jsx';
import Heatmap from '../components/charts/Heatmap.jsx';
import { VBars } from '../components/charts/Bars.jsx';
import { Tabs } from '../components/ui.jsx';
import { series, useLive } from '../live.jsx';
import { labStore, useLabStore } from './lab/labStore.js';
import { contextWords } from './lab/derive.js';
import Verdict from './lab/Verdict.jsx';
import Detectors from './lab/Detectors.jsx';
import ModelDrawer from './lab/ModelDrawer.jsx';
import './lab/lab.css';

const VIEWS = [
  ['time', 'Waveform'], ['spectrum', 'Spectrum'], ['spectrogram', 'Spectrogram'],
  ['envelope', 'Envelope'], ['orders', 'Orders'], ['crank', 'Crank speed'],
];
const WHY = {
  time: 'One impulse per firing. Knock adds a sharp ring after each one; valve wear adds a click once per cycle.',
  spectrum: 'Where the energy sits. Knock lifts the 5.5–8 kHz band; belt squeal is a narrow tone at 2.5–3.5 kHz.',
  spectrogram: 'How the spectrum changes inside one second. This image is what the CNN looks at.',
  envelope: 'How often impacts repeat. A bearing defect shows as a peak at its defect frequency.',
  orders: 'Energy at multiples of crank speed. 0.5× rises with misfire, 1× with imbalance; 2× is normal firing.',
  crank: 'Speed change on every firing. A misfiring cylinder stops pushing, so the crank slows on its turn.',
};

export default function Signatures() {
  const { latest, history, serviced } = useLive();
  const frames = useLabStore((s) => s.frames);
  const [view, setView] = useState('spectrum');
  const [drawer, setDrawer] = useState(false);
  const closeDrawer = useCallback(() => setDrawer(false), []);
  const { sig, engine } = latest;

  if (engine.state === 'off' || !sig) {
    return (
      <div className="empty fade-in">
        <div className="empty-ico"><Power size={28} strokeWidth={1.5} /></div>
        <h2>Engine off</h2>
        <p className="note">Start the engine on the vehicle laptop. Its block vibration streams here once a second.</p>
      </div>
    );
  }
  const H = history.slice(-180);
  const onServiced = () => { serviced(); labStore.forgetBaseline(); };

  return (
    <div className="lab">
      <header className="lab-head">
        <div className="lab-rpm" aria-label={`Engine speed ${sig.rpm} rpm`}>
          <span className="num">{Math.round(sig.rpm).toLocaleString('en-US')}</span><small>rpm</small>
        </div>
        <div className="lab-context">
          <span className="label">Engine state</span>
          <span>{contextWords(engine.context)}</span>
        </div>
        <div className="spacer" />
        <button className="btn" onClick={() => setDrawer(true)}>Model details</button>
      </header>

      <div className="lab-top">
        <Verdict latest={latest} frames={frames} />
        <Detectors engine={engine} onServiced={onServiced} />
      </div>

      <section className="panel panel-pad" aria-label="Signals">
        <div className="row" style={{ marginBottom: 14 }}>
          <Tabs items={VIEWS} value={view} onChange={setView} />
        </div>
        <Plot view={view} d={sig} />
        <div className="chart-caption">{WHY[view]}</div>
      </section>

      <section className="panel panel-pad" aria-label="Deviation from this car's normal, last 3 minutes">
        <div className="eyebrow" style={{ marginBottom: 10 }}>Deviation from this car’s own normal · last 3 min</div>
        <LineChart height={170} hlines={[{ y: engine.threshold, label: 'Deviation threshold' }]} fmtY={(v) => v.toFixed(0)}
          fmtX={() => ''} legend={false}
          series={[{ id: 'a', label: 'Deviation (RMS of top-5 feature z-scores)', color: 'var(--s1)', x: series(H, 'clock'), y: series(H, 'anomaly') }]} />
        <div className="chart-caption">
          Dashed line: the deviation threshold, {engine.threshold}. Crossing it does not raise the alarm; the classifier does (see 02 / Detectors).
        </div>
      </section>

      {drawer && <ModelDrawer engine={engine} onClose={closeDrawer} />}
    </div>
  );
}

export function Plot({ view, d, height = 320 }) {
  // the backend sends log10 power (bels); the heatmap labels its values in dB
  const zDb = useMemo(() => d.spectrogram.z.map((r) => r.map((v) => 10 * v)), [d.spectrogram.z]);
  if (view === 'time') {
    return <LineChart height={height} fmtX={(v) => `${v.toFixed(0)}`} xTitle="ms" fmtY={(v) => v.toFixed(1)} legend={false}
      series={[{ id: 'v', label: 'Block vibration', color: 'var(--s1)', x: d.time.t_ms, y: d.time.y, width: 1.2 }]} />;
  }
  if (view === 'spectrum') {
    return <LineChart height={height} xDomain={[0, 10000]} fmtX={(v) => `${(v / 1000).toFixed(0)}k`} xTitle="Hz" legend={false}
      bands={[{ x0: 5500, x1: 8000, label: 'knock band' }]}
      fmtY={(v) => v.toFixed(0)} series={[{ id: 's', label: 'Power (dB)', color: 'var(--s1)', x: d.spectrum.f, y: d.spectrum.db, width: 1.6 }]} />;
  }
  if (view === 'spectrogram') return <Heatmap f={d.spectrogram.f} t={d.spectrogram.t} z={zDb} height={height} />;
  if (view === 'envelope') {
    const marks = d.envelope.orders.map((f, k) => ({ x: f, label: ['0.5×', '1×', '1.5×', '2×'][k], row: k % 2 }));
    return <LineChart height={height} xDomain={[0, 400]} markers={marks} xTitle="Hz" fmtY={(v) => v.toFixed(1)} legend={false}
      series={[{ id: 'e', label: 'Envelope spectrum (normalised)', color: 'var(--s1)', x: d.envelope.f, y: d.envelope.y, width: 1.5 }]} />;
  }
  if (view === 'orders') return <VBars labels={d.orders.labels} values={d.orders.amp} height={height} fmt={(v) => v.toFixed(3)} />;
  const dev = d.crank.dev;
  return <VBars labels={dev.map((_, k) => k + 1)} values={dev} height={height} showEvery={5} fmt={(v) => `${v.toFixed(1)} rpm`}
    colorOf={(v) => (v < -15 ? 'var(--critical)' : 'var(--s1)')} />;
}
