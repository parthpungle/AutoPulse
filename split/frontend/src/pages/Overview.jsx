// Cockpit: the car stays in the middle. Left: the multivariable sensor data, each on a scale with
// its normal band and a trend. Right: what the models recognise. Below the car: the engine's live
// signature in time and frequency. Grey while healthy; colour floods in only where something is wrong.
import { useEffect, useRef, useState } from 'react';
import { Power, Wrench } from 'lucide-react';
import Car3D from '../components/Car3D.jsx';
import { AlarmShape, KpiTile, LinearGauge, PRIORITY, Panel, RANGES, SensorTile, Sparkline, prio, prioColor } from '../components/hmi.jsx';
import { AlertCard, StatusIcon, Tabs } from '../components/ui.jsx';
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

export default function Overview() {
  const { latest, history, live, serviced } = useLive();
  const { vehicle: v, row, systems, zones, score, verdict, alerts, engine, sig } = latest;
  const [left, setLeft] = useState('sensors');
  const [right, setRight] = useState('diagnosis');
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
  const alarmCount = alerts.filter((a) => a.severity !== 'info').length;
  const top = engine.ensemble ? engine.ensemble.indexOf(Math.max(...engine.ensemble)) : -1;
  const ranked = engine.ensemble ? engine.classes.map((c, k) => ({ c: c.split(' (')[0], v: engine.ensemble[k], k }))
    .sort((a, b) => b.v - a.v).slice(0, 5) : [];

  return (
    <div className="cockpit">
      {/* KPI strip: the numbers that matter, large */}
      <div className="kpis">
        <KpiTile label="Health score" value={score} unit="/100" priority={scoreP} />
        <KpiTile label="Engine verdict" priority={engineP}>
          <div className="row" style={{ gap: 10 }}>
            <span className="big text" style={engineP ? { color: prioColor(engineP) } : undefined}>
              {engine.state === 'off' ? 'Engine off' : engine.label}
            </span>
            {engine.state !== 'off' && <span className="num muted">{Math.round(engine.confidence * 100)}%</span>}
          </div>
        </KpiTile>
        <KpiTile label="Speed" value={row.speed_kph?.toFixed(0)} unit="km/h" />
        <KpiTile label="Engine speed" value={row.rpm?.toFixed(0)} unit="rpm" />
        <KpiTile label="Coolant" value={row.coolant_c?.toFixed(0)} unit="°C" priority={p('cooling')} />
        <KpiTile label="Battery" value={row.battery_v?.toFixed(1)} unit="V" priority={p('battery')} />
      </div>

      {/* LEFT: multivariable sensor data */}
      <Panel className="side" title="Sensors · last 2 min" right={<Tabs value={left} onChange={setLeft} items={[['sensors', 'Sensors'], ['systems', 'Systems']]} />}>
        {left === 'sensors' ? (
          <div className="scroll">
            <SensorTile label="Engine speed" value={row.rpm} range={RANGES.rpm} series={col('rpm')} />
            <SensorTile label="Coolant temperature" value={row.coolant_c} range={RANGES.coolant_c} series={col('coolant_c')} priority={p('cooling')} />
            <SensorTile label="Oil pressure" value={row.oil_pressure_bar} range={RANGES.oil_pressure_bar} series={col('oil_pressure_bar')} priority={p('oil')} />
            <SensorTile label="System voltage" value={row.battery_v} range={RANGES.battery_v} series={col('battery_v')} priority={p('battery')} />
            <SensorTile label="Long-term fuel trim" value={row.ltft_pct} range={RANGES.ltft_pct} series={col('ltft_pct')} priority={p('fuel')} />
            <SensorTile priority={p('tyres')} range={RANGES.tyre}>
              <div className="label" style={p('tyres') ? { color: prioColor(p('tyres')) } : undefined}>Tyre pressures</div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px 14px' }}>
                {[['tyre_fl_psi', 'Front L', 'tyre_fl'], ['tyre_fr_psi', 'Front R', 'tyre_fr'], ['tyre_rl_psi', 'Rear L', 'tyre_rl'], ['tyre_rr_psi', 'Rear R', 'tyre_rr']].map(([k, l, z]) => (
                  <LinearGauge key={k} label={l} value={row[k]} range={RANGES.tyre} compact priority={prio(zones[z])} />
                ))}
              </div>
            </SensorTile>
            <SensorTile label="Fuel level" value={row.fuel_level_pct} range={RANGES.fuel_level_pct} series={col('fuel_level_pct')} />
          </div>
        ) : (
          <div className="scroll" style={{ gap: 0 }}>
            {systems.map((s) => (
              <div key={s.id} className="sys-row">
                <StatusIcon status={s.status} />
                <div><div className="n">{s.name}</div><div className="d">{s.detail}</div></div>
                <span className="status" style={{ color: s.status === 'ok' ? 'var(--text-dim)' : prioColor(prio(s.status)) }}>
                  {s.status === 'ok' ? 'Normal' : PRIORITY[prio(s.status)].name}
                </span>
              </div>
            ))}
          </div>
        )}
      </Panel>

      {/* CENTRE: the car, constant */}
      <section className="panel stage" style={{ '--glow': issues.length ? prioColor(Math.min(...issues.map((s) => prio(s.status)))) : undefined }}>
        <div className="stage-car"><Car3D type={v.car_type} zones={zones} distance={0.92} live={live} /></div>
        <div className="stage-hud">
          <div className="top">
            <div>
              <div className="label" style={{ color: 'var(--accent)' }}>Live from {v.name}</div>
              <div className="name">{carName(v.car_type)}</div>
              <div className="spec">{CAR_INFO[v.car_type]?.spec} · unit {v.unit}</div>
              <div className="row" style={{ gap: 6, marginTop: 6, fontSize: 12, color: 'var(--text-2)' }}>
                <Power size={13} color={row.ignition ? 'var(--accent)' : 'var(--text-dim)'} />{row.ignition ? 'Engine running' : 'Engine off'} · {verdict}
              </div>
            </div>
            <div className="legend">
              {[1, 2, 4].map((k) => <span key={k} className="row" style={{ gap: 5 }}><AlarmShape priority={k} size={13} /><span className="label">{PRIORITY[k].name}</span></span>)}
            </div>
          </div>
          <div className="callouts">
            {issues.map((s) => (
              <span key={s.id} className="callout" style={{ '--c': prioColor(prio(s.status)) }}>
                <AlarmShape priority={prio(s.status)} size={13} />{s.name}<span className="muted" style={{ fontWeight: 400 }}>· {s.detail}</span>
              </span>
            ))}
          </div>
        </div>
      </section>

      {/* BELOW THE CAR: the engine's signature, live */}
      <Panel className="sigstrip" title="Engine signature" priority={engineP} right={<Tabs value={view} onChange={setView} items={SIG_VIEWS} />}>
        <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
          <div className="body" ref={sigBody}>
            {sig ? (sigH > 60 && <Plot view={view} d={sig} height={sigH} />)
              : <div className="empty" style={{ minHeight: 0, height: '100%' }}><p className="note">Start the engine on the vehicle laptop to see its signature.</p></div>}
          </div>
          <div className="why">{sig && <span className="num" style={{ color: 'var(--text-2)' }}>live · 1 s · {sig.rpm} rpm · </span>}{SIG_WHY[view]}</div>
        </div>
      </Panel>

      {/* RIGHT: pattern recognition */}
      <Panel className="side" title="Recognition" right={<Tabs value={right} onChange={setRight}
        items={[['diagnosis', 'Diagnosis'], ['alerts', <span key="a">Alerts{alarmCount > 0 && <span className="count" style={{ '--c': 'var(--p1)' }}>{alarmCount}</span>}</span>]]} />}>
        {right === 'diagnosis' ? (
          <div className="scroll">
            <div className="verdict" style={{ '--c': engineP ? prioColor(engineP) : undefined }}>
              <div className="row" style={{ gap: 6 }}>{engineP && <AlarmShape priority={engineP} size={14} />}<span className="label">Engine · last 5 s</span></div>
              <div className="what">{engine.state === 'off' ? 'Engine off' : engine.label}</div>
              <div className="note">{engine.state === 'off' ? 'No vibration while the engine is stopped.'
                : `${Math.round(engine.confidence * 100)}% ensemble confidence. From the vibration alone: the vehicle never sends what was injected.`}</div>
            </div>
            {engine.ensemble && (
              <div className="stack" style={{ gap: 8 }}>
                <div className="label">Fault probability · 4-model ensemble</div>
                {ranked.map((r) => (
                  <div key={r.k} className={`pbar ${r.k === top ? 'top' : ''}`} style={{ '--c': r.k === top && engineP ? prioColor(engineP) : undefined }}>
                    <span style={{ color: r.k === top ? 'var(--text-max)' : 'var(--text-2)' }}>{r.c}</span>
                    <span className="v">{Math.round(r.v * 100)}%</span>
                    <div className="bar"><div style={{ width: `${r.v * 100}%` }} /></div>
                  </div>
                ))}
              </div>
            )}
            {engine.votes && (
              <table className="data">
                <thead><tr><th>Model</th><th>Top pick</th><th className="num">p</th></tr></thead>
                <tbody>
                  {Object.entries(engine.votes).map(([m, pv]) => {
                    const k = pv.indexOf(Math.max(...pv));
                    return <tr key={m}><td>{m}</td><td>{engine.classes[k].split(' (')[0]}</td><td className="num">{Math.round(pv[k] * 100)}%</td></tr>;
                  })}
                </tbody>
              </table>
            )}
            {engine.state === 'running' && (
              <div className="stack" style={{ gap: 6 }}>
                <div className="row"><span className="label">Deviation from this car's normal</span><span className="spacer" />
                  <span className="num" style={{ color: engine.anomaly > engine.threshold ? 'var(--p3)' : 'var(--text-1)' }}>{engine.anomaly.toFixed(1)}</span></div>
                <Sparkline values={col('anomaly')} range={RANGES.anomaly} threshold={engine.threshold} height={48} />
                <div className="row">
                  <span className="note muted" style={{ fontSize: 12 }}>Adaptive baseline · {engine.context.replace('_', ', ')} · {engine.learned} s learned</span>
                  <span className="spacer" />
                  <button className="btn ghost" onClick={serviced} title="Forget the learned normal, e.g. after a service"><Wrench size={13} />Serviced</button>
                </div>
              </div>
            )}
          </div>
        ) : (
          <div className="scroll">
            {alerts.length === 0
              ? <div className="note">No alarms. Every hard limit, rule and engine model is quiet.</div>
              : alerts.map((a) => <AlertCard key={a.title} a={a} />)}
          </div>
        )}
      </Panel>
    </div>
  );
}
