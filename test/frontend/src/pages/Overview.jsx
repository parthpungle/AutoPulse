// Cockpit: the car is the hero, big and centred. A quiet sensor column on the left, what the
// models recognise on the right, the engine's live signature under the car. Grey while healthy;
// warm colour appears only where something is wrong.
import { useEffect, useRef, useState } from 'react';
import { Power, Wrench } from 'lucide-react';
import Car3D from '../components/Car3D.jsx';
import { AlarmShape, LinearGauge, Panel, RANGES, Sparkline, prio, prioColor } from '../components/hmi.jsx';
import { AlertCard, Tabs } from '../components/ui.jsx';
import { CAR_INFO, carName } from '../cars.js';
import { series, useLive } from '../live.jsx';
import { Plot } from './Signatures.jsx';

const SIG_VIEWS = [['time', 'Waveform'], ['spectrum', 'Spectrum'], ['spectrogram', 'Spectrogram'], ['orders', 'Orders'], ['crank', 'Crank']];
const SIG_WHY = {
  time: 'Block vibration, first 200 ms: one impulse per firing. Knock rings after each; valve wear clicks once per cycle.',
  spectrum: 'Where the energy sits. Knock lifts the shaded 5.5–8 kHz band; belt squeal is a narrow tone near 3 kHz.',
  spectrogram: 'The spectrum through one second: the image the CNN reads.',
  orders: 'Energy at multiples of crank speed: 0.5× rises with misfire, 1× with imbalance, 2× is normal firing.',
  crank: 'Speed change at every firing. A misfiring cylinder stops pushing, so the crank slows on its turn.',
};

function useHeight(ref) {
  const [h, setH] = useState(0);
  useEffect(() => {
    if (!ref.current) return undefined;
    const ro = new ResizeObserver(([e]) => setH(Math.floor(e.contentRect.height)));
    ro.observe(ref.current);
    return () => ro.disconnect();
  }, [ref]);
  return h;
}

/** One quiet sensor row: gauge with its normal band, and a two-minute trend. */
function SensorRow({ label, value, range, values, priority }) {
  return (
    <div className="srow">
      <LinearGauge label={label} value={value} range={range} priority={priority} />
      <Sparkline values={values} range={range} priority={priority} height={30} />
    </div>
  );
}

export default function Overview() {
  const { latest, history, serviced } = useLive();
  const { vehicle: v, row, systems, zones, score, verdict, alerts, engine, sig } = latest;
  const [view, setView] = useState('time');
  const sigBody = useRef(null);
  const sigH = useHeight(sigBody);

  const H = history.slice(-120);
  const col = (k) => series(H, k);
  const sys = Object.fromEntries(systems.map((s) => [s.id, s]));
  const p = (id) => prio(sys[id]?.status);
  const scoreP = score >= 85 ? null : score >= 60 ? 2 : 1;
  const engineP = engine.state === 'off' ? null : prio(engine.status);
  const issues = systems.filter((s) => s.status !== 'ok');
  const topAlert = alerts.find((a) => a.severity !== 'info');
  const tyreKeys = ['tyre_fl_psi', 'tyre_fr_psi', 'tyre_rl_psi', 'tyre_rr_psi'];
  const lowTyre = tyreKeys.reduce((m, k) => (row[k] != null && (m == null || row[k] < row[m]) ? k : m), null);
  const minTyres = H.map((r) => Math.min(...tyreKeys.map((k) => r[k] ?? Infinity)));
  const ranked = engine.ensemble ? engine.classes.map((c, k) => ({ c: c.split(' (')[0], v: engine.ensemble[k], k }))
    .sort((a, b) => b.v - a.v).slice(0, 3) : [];

  return (
    <div className="cockpit">
      {/* LEFT: the key sensors, quietly */}
      <Panel className="side" title="Sensors" meta="last 2 min">
        <div className="scroll sensors">
          <SensorRow label="Coolant" value={row.coolant_c} range={RANGES.coolant_c} values={col('coolant_c')} priority={p('cooling')} />
          <SensorRow label="Oil pressure" value={row.oil_pressure_bar} range={RANGES.oil_pressure_bar} values={col('oil_pressure_bar')} priority={p('oil')} />
          <SensorRow label="Battery" value={row.battery_v} range={RANGES.battery_v} values={col('battery_v')} priority={p('battery')} />
          <SensorRow label="Fuel trim" value={row.ltft_pct} range={RANGES.ltft_pct} values={col('ltft_pct')} priority={p('fuel')} />
          <SensorRow label={`Tyres · lowest ${lowTyre ? lowTyre.slice(5, 7).toUpperCase() : ''}`} value={lowTyre ? row[lowTyre] : null}
            range={RANGES.tyre} values={minTyres} priority={p('tyres')} />
        </div>
      </Panel>

      {/* CENTRE: the car */}
      <section className="panel stage" style={{ '--glow': issues.length ? prioColor(Math.min(...issues.map((s) => prio(s.status)))) : undefined }}>
        <div className="stage-car"><Car3D type={v.car_type} zones={zones} distance={0.8} /></div>
        <div className="stage-hud">
          <div className="top">
            <div>
              <div className="label" style={{ color: 'var(--accent)' }}>Live · {v.name}</div>
              <div className="name">{carName(v.car_type)}</div>
              <div className="spec">{CAR_INFO[v.car_type]?.spec} · unit {v.unit}</div>
            </div>
            <div className="readouts">
              <div><span className="label">Speed</span><b className="num">{row.speed_kph?.toFixed(0) ?? '—'}</b><small>km/h</small></div>
              <div><span className="label">Engine</span><b className="num">{row.rpm?.toFixed(0) ?? '—'}</b><small>rpm</small></div>
            </div>
          </div>
          <div className="bottom">
            <div className="score">
              <span className="label">Health</span>
              <div className="row" style={{ gap: 10, alignItems: 'baseline' }}>
                <b className="num" style={scoreP ? { color: prioColor(scoreP) } : undefined}>{score}</b>
                <span className="muted num">/100</span>
              </div>
              <div className="verdict-line">
                <Power size={13} color={row.ignition ? 'var(--accent)' : 'var(--text-dim)'} />
                {row.ignition ? verdict : `Engine off · ${verdict}`}
              </div>
            </div>
            <div className="callouts">
              {issues.map((s) => (
                <span key={s.id} className="callout" style={{ '--c': prioColor(prio(s.status)) }}>
                  <AlarmShape priority={prio(s.status)} size={12} />{s.name}
                </span>
              ))}
            </div>
          </div>
        </div>
      </section>

      {/* BELOW THE CAR: the live signature */}
      <Panel className="sigstrip" title="Engine signature" priority={engineP} right={<Tabs value={view} onChange={setView} items={SIG_VIEWS} />}>
        <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
          <div className="body" ref={sigBody}>
            {sig ? (sigH > 60 && <Plot view={view} d={sig} height={sigH} />)
              : <div className="empty" style={{ minHeight: 0, height: '100%' }}><p className="note">Start the engine on the vehicle laptop to see its signature.</p></div>}
          </div>
          <div className="why">{sig && <span className="num" style={{ color: 'var(--text-2)' }}>{sig.rpm} rpm · </span>}{SIG_WHY[view]}</div>
        </div>
      </Panel>

      {/* RIGHT: what the models recognise */}
      <Panel className="side" title="Recognition" priority={engineP}>
        <div className="scroll">
          <div>
            <div className="label">Engine · last 5 s</div>
            <div className="what" style={engineP ? { color: prioColor(engineP) } : undefined}>
              {engine.state === 'off' ? 'Engine off' : engine.label}
            </div>
            {engine.state !== 'off' && <div className="note muted">{Math.round(engine.confidence * 100)}% confidence · SVM, Softmax, ANN, CNN</div>}
          </div>

          {ranked.length > 0 && (
            <div className="stack" style={{ gap: 9 }}>
              {ranked.map((r, i) => (
                <div key={r.k} className={`pbar ${i === 0 ? 'top' : ''}`} style={{ '--c': i === 0 && engineP ? prioColor(engineP) : undefined }}>
                  <span style={{ color: i === 0 ? 'var(--text-max)' : 'var(--text-2)' }}>{r.c}</span>
                  <span className="v">{Math.round(r.v * 100)}%</span>
                  <div className="bar"><div style={{ width: `${r.v * 100}%` }} /></div>
                </div>
              ))}
            </div>
          )}

          {engine.state === 'running' && (
            <div className="stack" style={{ gap: 6 }}>
              <div className="row"><span className="label">vs this car's normal</span><span className="spacer" />
                <span className="num" style={{ color: engine.anomaly > engine.threshold ? 'var(--p3)' : 'var(--text-1)' }}>{engine.anomaly.toFixed(1)}</span></div>
              <Sparkline values={col('anomaly')} range={RANGES.anomaly} threshold={engine.threshold} height={40} />
              <div className="row">
                <span className="muted" style={{ fontSize: 12 }}>{engine.learned} s learned</span>
                <span className="spacer" />
                <button className="btn ghost" onClick={serviced} title="Forget the learned normal, e.g. after a service"><Wrench size={13} />Serviced</button>
              </div>
            </div>
          )}

          <div className="rule" />
          {topAlert
            ? <AlertCard a={topAlert} />
            : <div className="quiet"><span className="label">Alerts</span><p className="note muted">Nothing needs attention. Every hard limit and model is quiet.</p></div>}
          {alerts.length > 1 && <div className="muted" style={{ fontSize: 12 }}>+{alerts.length - 1} more on Live drive</div>}
        </div>
      </Panel>
    </div>
  );
}
