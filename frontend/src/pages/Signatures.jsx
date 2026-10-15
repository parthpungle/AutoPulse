import { useMemo, useState } from 'react';
import { useApi } from '../api.js';
import LineChart from '../components/charts/LineChart.jsx';
import Heatmap from '../components/charts/Heatmap.jsx';
import { HBars, VBars } from '../components/charts/Bars.jsx';
import { Status, Tabs } from '../components/ui.jsx';
import { CAR_INFO, useScenario } from '../scenario.jsx';

const VIEWS = [
  ['time', 'Waveform'], ['spectrum', 'Spectrum'], ['spectrogram', 'Spectrogram'],
  ['envelope', 'Envelope'], ['orders', 'Orders'], ['crank', 'Crank speed'],
];
const WHY = {
  time: 'One impulse per firing. Knock adds a sharp ring after each one; valve wear adds a click once per cycle.',
  spectrum: 'Where the energy sits. Knock lifts the 5.5–8 kHz band; belt squeal is a narrow tone at 2–5 kHz.',
  spectrogram: 'How the spectrum changes inside one second. This image is what the CNN looks at.',
  envelope: 'How often impacts repeat. A bearing defect shows as a peak at its defect frequency (BPFO).',
  orders: 'Energy at multiples of crank speed. 0.5× rises with misfire, 1× with imbalance; 2× is normal firing.',
  crank: 'Speed change on every firing. A misfiring cylinder stops pushing, so the crank slows on its turn.',
};
const SERIES = ['var(--s1)', 'var(--s2)', 'var(--s3)', 'var(--s4)'];

export default function Signatures() {
  const { s } = useScenario();
  const [view, setView] = useState('spectrum');
  const [rpm, setRpm] = useState(1500);
  const [cold, setCold] = useState(false);
  const [compare, setCompare] = useState([]);
  const body = useMemo(() => ({ ...s, rpm, cold, compare }), [s, rpm, cold, compare]);
  const { data, loading } = useApi('/signature', body);

  const others = Object.keys(CAR_INFO).filter((k) => k !== s.car_type);
  const toggle = (k) => setCompare((c) => (c.includes(k) ? c.filter((x) => x !== k) : [...c, k].slice(0, 3)));

  return (
    <div className="grid2" style={{ gridTemplateColumns: '1fr 320px', alignItems: 'start' }}>
      <div className="stack">
        <div className="panel panel-pad">
          <div className="row" style={{ gap: 28, flexWrap: 'wrap' }}>
            <label className="field" style={{ minWidth: 240, flex: 1 }}>
              <span className="row">Engine speed<span className="spacer" /><span className="val">{rpm} rpm</span></span>
              <input type="range" min="750" max="4000" step="50" value={rpm} onChange={(e) => setRpm(+e.target.value)} />
            </label>
            <label className="row" style={{ gap: 8, fontSize: 13, color: 'var(--ink-2)' }}>
              <input type="checkbox" checked={cold} onChange={(e) => setCold(e.target.checked)} style={{ accentColor: 'var(--accent)' }} />Cold engine
            </label>
            <div>
              <div className="kpi-label" style={{ marginBottom: 6 }}>Compare car types</div>
              <div className="toggle-chips">
                {others.map((k) => <button key={k} className={compare.includes(k) ? 'on' : ''} onClick={() => toggle(k)}>{CAR_INFO[k].name}</button>)}
              </div>
            </div>
          </div>
        </div>

        <div className={`panel panel-pad ${loading ? 'loading' : ''}`}>
          <div className="row" style={{ marginBottom: 14 }}>
            <Tabs items={VIEWS} value={view} onChange={setView} />
          </div>
          {data && <Plot view={view} d={data} carType={s.car_type} rpm={rpm} />}
          <div className="chart-caption">{WHY[view]}</div>
        </div>
      </div>

      <div className="stack">
        {data && (
          <div className="panel panel-pad">
            <div className="eyebrow">Verdict</div>
            <div style={{ fontSize: 20, fontWeight: 600, margin: '6px 0 4px' }}>{data.verdict.label}</div>
            <div className="row" style={{ gap: 10 }}>
              <Status status={data.verdict.fault === 'healthy' ? 'ok' : 'warning'} />
              <span className="note">{Math.round(data.verdict.confidence * 100)}% ensemble confidence</span>
            </div>
            <div className="note" style={{ marginTop: 8 }}>Injected: {data.verdict.truth}</div>
          </div>
        )}
        {data && (
          <div className="panel panel-pad">
            <div className="eyebrow" style={{ marginBottom: 12 }}>Ensemble probability</div>
            <HBars items={data.classes.map((c, k) => ({ label: c.split(' (')[0], value: data.ensemble[k],
              emphasis: k === data.ensemble.indexOf(Math.max(...data.ensemble)) }))
              .sort((a, b) => b.value - a.value).slice(0, 4)} />
            <div className="eyebrow" style={{ margin: '18px 0 10px' }}>Each model's top pick</div>
            <table className="data">
              <tbody>
                {Object.entries(data.votes).map(([m, p]) => {
                  const k = p.indexOf(Math.max(...p));
                  return <tr key={m}><td>{m}</td><td>{data.classes[k].split(' (')[0]}</td><td className="num">{Math.round(p[k] * 100)}%</td></tr>;
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}

function Plot({ view, d, carType, rpm }) {
  if (view === 'time') {
    return <LineChart height={320} fmtX={(v) => `${v.toFixed(0)}`} xTitle="ms" fmtY={(v) => v.toFixed(1)}
      series={[{ id: 'v', label: 'Block vibration', color: 'var(--s1)', x: d.time.t_ms, y: d.time.y, width: 1.2 }]} />;
  }
  if (view === 'spectrum') {
    const marks = Object.entries(d.marks).filter(([, f]) => f <= 10000).map(([l, f], k) => ({ x: f, label: l, row: k % 3 }));
    return <LineChart height={340} xDomain={[0, 10000]} markers={marks} fmtX={(v) => `${(v / 1000).toFixed(0)}k`} xTitle="Hz"
      fmtY={(v) => v.toFixed(0)} series={d.spectra.map((sp, k) => ({ id: sp.car_type, label: CAR_INFO[sp.car_type]?.name || sp.label,
        color: SERIES[k], x: sp.f, y: sp.db, width: sp.car_type === carType ? 2 : 1.4 }))} />;
  }
  if (view === 'spectrogram') return <Heatmap f={d.spectrogram.f} t={d.spectrogram.t} z={d.spectrogram.z} height={320} />;
  if (view === 'envelope') {
    const marks = [{ x: d.envelope.bpfo, label: 'bearing defect (BPFO)' }, ...d.envelope.orders.map((f, k) => ({ x: f, label: ['0.5×', '1×', '1.5×', '2×'][k], row: 1 }))];
    return <LineChart height={320} xDomain={[0, 400]} markers={marks} xTitle="Hz" fmtY={(v) => v.toFixed(1)}
      series={[{ id: 'e', label: 'Envelope spectrum (normalised)', color: 'var(--s1)', x: d.envelope.f, y: d.envelope.y, width: 1.5 }]} />;
  }
  if (view === 'orders') return <VBars labels={d.orders.labels} values={d.orders.amp} height={300} fmt={(v) => v.toFixed(3)} />;
  const dev = d.crank.dev;
  return <VBars labels={dev.map((_, k) => k + 1)} values={dev} height={300} showEvery={5} fmt={(v) => `${v.toFixed(1)} rpm`}
    colorOf={(v) => (v < -15 ? 'var(--critical)' : 'var(--s1)')} />;
}
