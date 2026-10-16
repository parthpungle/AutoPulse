import { useState } from 'react';
import { Power, Wrench } from 'lucide-react';
import LineChart from '../components/charts/LineChart.jsx';
import Heatmap from '../components/charts/Heatmap.jsx';
import { HBars, VBars } from '../components/charts/Bars.jsx';
import { Status, Tabs } from '../components/ui.jsx';
import { series, useLive } from '../live.jsx';

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
  const [view, setView] = useState('spectrum');
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
  const top = engine.ensemble.indexOf(Math.max(...engine.ensemble));

  return (
    <div className="grid2" style={{ gridTemplateColumns: '1fr 330px', alignItems: 'start' }}>
      <div className="stack">
        <div className="panel panel-pad">
          <div className="row" style={{ marginBottom: 14 }}>
            <Tabs items={VIEWS} value={view} onChange={setView} />
            <div className="spacer" />
            <span className="live-tag">live · {sig.rpm} rpm</span>
          </div>
          <Plot view={view} d={sig} />
          <div className="chart-caption">{WHY[view]}</div>
        </div>

        <div className="panel panel-pad">
          <div className="row" style={{ marginBottom: 10 }}>
            <div className="eyebrow">Deviation from this car’s own normal · last 3 min</div>
            <div className="spacer" />
            <button className="btn ghost" onClick={serviced} title="Forget the learned normal, e.g. after a service">
              <Wrench size={15} />Mark serviced
            </button>
          </div>
          <LineChart height={170} hlines={[{ y: engine.threshold, label: 'Alarm threshold' }]} fmtY={(v) => v.toFixed(0)}
            fmtX={() => ''} legend={false}
            series={[{ id: 'a', label: 'Adaptive baseline score', color: 'var(--s1)', x: series(H, 'clock'), y: series(H, 'anomaly') }]} />
          <div className="chart-caption">
            The baseline learns what is normal for this particular car in each engine state ({engine.context.replace('_', ', ')} now),
            from {engine.learned} healthy seconds so far. A new fault stands out against it even when the models are unsure.
          </div>
        </div>
      </div>

      <div className="stack">
        <div className="panel panel-pad">
          <div className="eyebrow">Verdict · last 5 s</div>
          <div style={{ fontSize: 20, fontWeight: 600, margin: '6px 0 4px' }}>{engine.label}</div>
          <div className="row" style={{ gap: 10 }}>
            <Status status={engine.status} />
            <span className="note">{Math.round(engine.confidence * 100)}% ensemble confidence</span>
          </div>
          <div className="note muted" style={{ marginTop: 8 }}>The vehicle never says what was injected. This comes from the vibration alone.</div>
        </div>
        <div className="panel panel-pad">
          <div className="eyebrow" style={{ marginBottom: 12 }}>Ensemble probability</div>
          <HBars items={engine.classes.map((c, k) => ({ label: c.split(' (')[0], value: engine.ensemble[k], emphasis: k === top }))
            .sort((a, b) => b.value - a.value).slice(0, 4)} />
          <div className="eyebrow" style={{ margin: '18px 0 10px' }}>Each model's top pick · this second</div>
          <table className="data">
            <tbody>
              {Object.entries(engine.votes).map(([m, p]) => {
                const k = p.indexOf(Math.max(...p));
                return <tr key={m}><td>{m}</td><td>{engine.classes[k].split(' (')[0]}</td><td className="num">{Math.round(p[k] * 100)}%</td></tr>;
              })}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

function Plot({ view, d }) {
  if (view === 'time') {
    return <LineChart height={320} fmtX={(v) => `${v.toFixed(0)}`} xTitle="ms" fmtY={(v) => v.toFixed(1)} legend={false}
      series={[{ id: 'v', label: 'Block vibration', color: 'var(--s1)', x: d.time.t_ms, y: d.time.y, width: 1.2 }]} />;
  }
  if (view === 'spectrum') {
    return <LineChart height={340} xDomain={[0, 10000]} fmtX={(v) => `${(v / 1000).toFixed(0)}k`} xTitle="Hz" legend={false}
      bands={[{ x0: 5500, x1: 8000, label: 'knock band' }]}
      fmtY={(v) => v.toFixed(0)} series={[{ id: 's', label: 'Power (dB)', color: 'var(--s1)', x: d.spectrum.f, y: d.spectrum.db, width: 1.6 }]} />;
  }
  if (view === 'spectrogram') return <Heatmap f={d.spectrogram.f} t={d.spectrogram.t} z={d.spectrogram.z} height={320} />;
  if (view === 'envelope') {
    const marks = d.envelope.orders.map((f, k) => ({ x: f, label: ['0.5×', '1×', '1.5×', '2×'][k], row: k % 2 }));
    return <LineChart height={320} xDomain={[0, 400]} markers={marks} xTitle="Hz" fmtY={(v) => v.toFixed(1)} legend={false}
      series={[{ id: 'e', label: 'Envelope spectrum (normalised)', color: 'var(--s1)', x: d.envelope.f, y: d.envelope.y, width: 1.5 }]} />;
  }
  if (view === 'orders') return <VBars labels={d.orders.labels} values={d.orders.amp} height={300} fmt={(v) => v.toFixed(3)} />;
  const dev = d.crank.dev;
  return <VBars labels={dev.map((_, k) => k + 1)} values={dev} height={300} showEvery={5} fmt={(v) => `${v.toFixed(1)} rpm`}
    colorOf={(v) => (v < -15 ? 'var(--critical)' : 'var(--s1)')} />;
}
