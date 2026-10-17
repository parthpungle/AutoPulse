// Cockpit, polished: no boxes. The car floats on the page, the sensors and the recognition sit in
// open columns divided by hairlines, the live signature runs under the car. Everything fits the
// screen: nothing on this page scrolls, and nothing is drawn over the car.
import { useRef, useState } from 'react';
import { CircleCheck, Power, Wrench } from 'lucide-react';
import Car3D from '../components/Car3D.jsx';
import { AlarmShape, LinearGauge, RANGES, Sparkline, prio, prioColor } from '../components/hmi.jsx';
import { AlertCard, Tabs } from '../components/ui.jsx';
import { CAR_INFO, carName } from '../cars.js';
import { series, useLive } from '../live.jsx';
import { Plot } from './Signatures.jsx';
import { useSize } from '../components/charts/useWidth.js';

const SIG_VIEWS = [['time', 'Waveform'], ['spectrum', 'Spectrum'], ['spectrogram', 'Spectrogram'], ['orders', 'Orders'], ['crank', 'Crank']];
const SIG_WHY = {
  time: 'One impulse per firing. Knock rings after each; valve wear clicks once per cycle.',
  spectrum: 'Knock lifts the shaded 5.5–8 kHz band; belt squeal is a narrow tone near 3 kHz.',
  spectrogram: 'The spectrum through one second: the image the CNN reads.',
  orders: '0.5× rises with misfire, 1× with imbalance; 2× is normal firing.',
  crank: 'A misfiring cylinder stops pushing, so the crank slows on its turn.',
};


function Section({ title, meta, priority, right, children, className = '', spot }) {
  const color = prioColor(priority);
  return (
    <section className={`sect ${className}`} data-spot={spot}>
      <header className="sect-head">
        {priority && <AlarmShape priority={priority} size={13} />}
        <span className="label" style={color ? { color } : undefined}>{title}</span>
        {meta && <span className="meta">{meta}</span>}
        {right}
      </header>
      {children}
    </section>
  );
}

function SensorRow({ label, value, range, values, priority, spot }) {
  return (
    <div className="srow" data-spot={spot}>
      <LinearGauge label={label} value={value} range={range} priority={priority} />
      <div className="srow-spark"><Sparkline values={values} range={range} priority={priority} height={32} /></div>
    </div>
  );
}

export default function Overview() {
  const { latest, history, serviced } = useLive();
  const { vehicle: v, row, systems, zones, score, verdict, alerts, engine, sig } = latest;
  const [view, setView] = useState('time');
  const sigBody = useRef(null);
  const { h: sigH } = useSize(sigBody);

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
      {/* LEFT: the key sensors */}
      <Section className="col-l" title="Sensors" meta="2 min">
        <div className="srows">
          <SensorRow spot="sensor-coolant" label="Coolant" value={row.coolant_c} range={RANGES.coolant_c} values={col('coolant_c')} priority={p('cooling')} />
          <SensorRow spot="sensor-oil" label="Oil pressure" value={row.oil_pressure_bar} range={RANGES.oil_pressure_bar} values={col('oil_pressure_bar')} priority={p('oil')} />
          <SensorRow spot="sensor-battery" label="Battery" value={row.battery_v} range={RANGES.battery_v} values={col('battery_v')} priority={p('battery')} />
          <SensorRow spot="sensor-fuel" label="Fuel trim" value={row.ltft_pct} range={RANGES.ltft_pct} values={col('ltft_pct')} priority={p('fuel')} />
          <SensorRow label={`Tyres · lowest ${lowTyre ? lowTyre.slice(5, 7).toUpperCase() : ''}`} value={lowTyre ? row[lowTyre] : null}
            range={RANGES.tyre} values={minTyres} priority={p('tyres')} />
        </div>
      </Section>

      {/* CENTRE: the car, with its labels above and below it, never on it */}
      <div className="stage" style={{ '--glow': issues.length ? prioColor(Math.min(...issues.map((s) => prio(s.status)))) : undefined }}>
        <div className="stage-top">
          <div className="ident">
            <span className="eyebrow-x">Your car</span>
            <span className="name">{carName(v.car_type)}</span>
            <span className="spec">{CAR_INFO[v.car_type]?.spec}</span>
            <span className="unit">Unit {v.unit} · live from {v.name}</span>
          </div>
          {/* Ask AutoPulse opens here, above the car, between the name and the readouts */}
          <div className="ask-slot" id="ask-slot" />
          <div className="readouts" data-spot="readouts">
            <div><span className="label">Speed</span><b className="num">{row.speed_kph?.toFixed(0) ?? '—'}</b><small>km/h</small></div>
            <div><span className="label">Engine</span><b className="num">{row.rpm?.toFixed(0) ?? '—'}</b><small>rpm</small></div>
          </div>
        </div>
        <div className="stage-car" data-spot="car-stage"><Car3D type={v.car_type} zones={zones} distance={0.74} /></div>
        <div className="stage-bottom">
          <div className="score" data-spot="health-score">
            <span className="hero">
              <b style={scoreP ? { color: prioColor(scoreP) } : undefined}>{score}</b>
              <span className="of">
                <span className="label">Health score</span>
                {scoreP ? <span className="ok-pill" style={{ color: prioColor(scoreP) }}><AlarmShape priority={scoreP} size={12} />{scoreP === 1 ? 'Fault' : 'Check'}</span>
                  : <span className="ok-pill"><CircleCheck size={13} strokeWidth={2.2} />OK</span>}
                <small>of 100</small>
              </span>
            </span>
            <span className="verdict-line">
              <Power size={13} color={row.ignition ? 'var(--accent)' : 'var(--text-dim)'} />
              {row.ignition ? verdict : `Engine off · ${verdict}`}
            </span>
          </div>
          <div className="callouts" data-spot="systems">
            {issues.map((s) => (
              <span key={s.id} className="callout" style={{ '--c': prioColor(prio(s.status)) }}>
                <AlarmShape priority={prio(s.status)} size={12} />{s.name}
              </span>
            ))}
            {systems.filter((s) => s.status === 'ok').map((s) => (
              <span key={s.id} className="callout ok" title={s.detail}><CircleCheck size={13} strokeWidth={2.2} />{s.name.split(' & ')[0]}</span>
            ))}
          </div>
        </div>
      </div>

      {/* BELOW THE CAR: the live signature */}
      <Section className="sig" spot="signature" title="Engine signature" priority={engineP} right={<Tabs value={view} onChange={setView} items={SIG_VIEWS} />}>
        <div className="sig-body" ref={sigBody}>
          {sig ? (sigH > 60 && <Plot view={view} d={sig} height={sigH} />)
            : <p className="note muted" style={{ margin: 'auto' }}>Start the engine on the vehicle laptop to see its signature.</p>}
        </div>
        <div className="why">{sig && <span className="num">{sig.rpm} rpm · </span>}{SIG_WHY[view]}</div>
      </Section>

      {/* RIGHT: what the models recognise */}
      <Section className="col-r" title="Recognition" priority={engineP}>
        <div className="rec">
          <div>
            <span className="label">Engine · last 5 s</span>
            <div className={`what ${!engineP && engine.state !== 'off' ? 'ok' : ''}`} style={engineP ? { color: prioColor(engineP) } : undefined}>
              {!engineP && engine.state !== 'off' && <CircleCheck size={20} strokeWidth={2.2} />}
              {engine.state === 'off' ? 'Engine off' : engine.label}
            </div>
            {engine.state !== 'off' && <div className="muted" style={{ fontSize: 12 }}>{Math.round(engine.confidence * 100)}% · SVM · Softmax · ANN · CNN</div>}
          </div>

          {ranked.length > 0 && (
            <div className="probs" data-spot="probs">
              {ranked.map((r, i) => (
                <div key={r.k} className={`pbar ${i === 0 ? 'top' : ''}`} style={{ '--c': i === 0 && engineP ? prioColor(engineP) : undefined }}>
                  <span className="n">{r.c}</span>
                  <span className="v">{Math.round(r.v * 100)}%</span>
                  <div className="bar"><div style={{ width: `${r.v * 100}%` }} /></div>
                </div>
              ))}
            </div>
          )}

          {engine.state === 'running' && (
            <div className="dev" data-spot="deviation">
              <div className="row"><span className="label">vs this car's normal</span><span className="spacer" />
                <span className="num" style={{ color: engine.anomaly > engine.threshold ? 'var(--p3)' : 'var(--text-1)' }}>{engine.anomaly.toFixed(1)}</span></div>
              <Sparkline values={col('anomaly')} range={RANGES.anomaly} threshold={engine.threshold} height={34} />
              <div className="row">
                <span className="muted" style={{ fontSize: 12 }}>{engine.learned} s learned</span><span className="spacer" />
                <button className="link-btn" onClick={serviced} title="Forget the learned normal, e.g. after a service"><Wrench size={12} />Mark serviced</button>
              </div>
            </div>
          )}

          <div className="alert-slot" data-spot="top-alert">
            {topAlert
              ? <AlertCard a={topAlert} compact />
              : <p className="note muted">Nothing needs attention. Every hard limit and model is quiet.</p>}
            {alerts.length > 1 && <div className="muted" style={{ fontSize: 12 }}>+{alerts.length - 1} more on Live drive</div>}
          </div>
        </div>
      </Section>
    </div>
  );
}
