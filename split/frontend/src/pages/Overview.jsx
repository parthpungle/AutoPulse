import { ChevronRight, HeartPulse, Power } from 'lucide-react';
import Car3D from '../components/Car3D.jsx';
import { SourceTag, Spark, Status, StatusIcon, scoreStatus } from '../components/ui.jsx';
import { useApi } from '../api.js';
import { CAR_INFO, carName } from '../cars.js';
import { series, useLive } from '../live.jsx';

const GAUGES = [
  ['speed_kph', 'Speed', 'km/h', 0, 'var(--s1)'], ['rpm', 'Engine', 'rpm', 0, 'var(--s1)'],
  ['coolant_c', 'Coolant', '°C', 0, 'var(--s2)'], ['oil_pressure_bar', 'Oil', 'bar', 1, 'var(--s3)'],
  ['battery_v', 'Battery', 'V', 1, 'var(--s4)'], ['fuel_level_pct', 'Fuel', '%', 0, 'var(--s3)'],
];

export default function Overview({ go }) {
  const { latest, history } = useLive();
  const { vehicle: v, row, systems, zones, score, verdict, alerts, engine } = latest;
  const st = scoreStatus(score);
  const issues = systems.filter((c) => c.status !== 'ok');
  const facts = issues.length ? issues : systems.slice(0, 5);
  const recent = history.slice(-120);
  const real = useApi('/results').data?.real?.audio;               // the headline accuracy: real recordings only
  const best = real && Object.entries(real.models).sort((a, b) => b[1].macro_f1.mean - a[1].macro_f1.mean)[0];
  const replay = engine.source === 'real recording';

  return (
    <div className="overview">
      <div className="stage">
        <div className="stage-info">
          <div className="eyebrow accent">Live from {v.name}</div>
          <h2>{carName(v.car_type)}</h2>
          <div className="ink2">{CAR_INFO[v.car_type]?.spec}</div>
          <div className="muted" style={{ fontSize: 13 }}>Unit {v.unit}</div>
          <div className="engine-line">
            <Power size={15} color={row.ignition ? 'var(--good)' : 'var(--muted)'} />
            {row.ignition ? `Engine running · trip ${Math.floor(row.t / 60)}:${String(row.t % 60).padStart(2, '0')}` : 'Engine off'}
          </div>

          <div className="stage-score">
            <span className="big" style={{ color: `var(--${st === 'ok' ? 'good' : st})` }}>{score}</span>
            <div>
              <div className="kpi-label">Health score</div>
              <div className="row" style={{ marginTop: 4, gap: 8 }}><Status status={st} />
                <SourceTag kind="simulator" label={replay ? 'Simulated car · real engine sound' : 'Simulated car'} /></div>
            </div>
          </div>
          <div style={{ marginTop: 8, fontSize: 15 }}>{verdict}</div>
          {best && (
            <div className="row" style={{ marginTop: 10, gap: 8, flexWrap: 'wrap', fontSize: 13 }}>
              <span className="ink2">Engine-sound models: <b>{(best[1].accuracy.mean * 100).toFixed(1)}%</b> on {real.n_recordings} real
                recordings ({best[0].split(' (')[0]}, held out by recording)</span>
              <SourceTag kind="real" />
            </div>
          )}
          {alerts[0] && alerts[0].severity !== 'info' && (
            <div className="top-alert" style={{ '--c': `var(--${alerts[0].severity})` }}>
              <StatusIcon status={alerts[0].severity} size={15} />
              <div><b>{alerts[0].title}</b><div className="muted">{alerts[0].actions?.[0]}</div></div>
            </div>
          )}
          <div className="row" style={{ marginTop: 18 }}>
            <button className="btn primary" onClick={() => go('check')}><HeartPulse size={16} />Health check</button>
            <button className="btn ghost" onClick={() => go('drive')}>Live drive</button>
          </div>
        </div>

        <div className="stage-mid" />
        <div className="stage-car">
          <Car3D type={v.car_type} zones={zones} distance={0.98} />
        </div>

        <div className="stage-facts">
          <div className="eyebrow">{issues.length ? `${issues.length} need attention` : 'All systems normal'}</div>
          {facts.map((c) => (
            <button key={c.id} className="fact" onClick={() => go(c.id === 'engine' ? 'signatures' : 'check')} style={{ textAlign: 'left', color: 'inherit' }}>
              <StatusIcon status={c.status} />
              <div>
                <div style={{ fontWeight: 500 }}>{c.name}</div>
                <div className="muted" style={{ fontSize: 12 }}>{c.detail}</div>
              </div>
              <span className="spacer" /><ChevronRight size={15} color="var(--muted)" />
            </button>
          ))}
          {engine.state === 'running' && engine.anomaly == null && (
            <div className="fact" style={{ cursor: 'default' }}>
              <div className="muted" style={{ fontSize: 12 }}>
                Engine sound: real recording. The own-normal baseline is paused (it was set up on simulated engines).
              </div>
            </div>
          )}
          {engine.state === 'running' && engine.anomaly != null && (
            <div className="fact" style={{ cursor: 'default' }}>
              <div style={{ width: '100%' }}>
                <div className="kpi-label">Engine vs its own normal</div>
                <div className="meter" style={{ marginTop: 8 }}>
                  <div style={{ width: `${Math.min(100, (engine.anomaly / (engine.threshold * 1.6)) * 100)}%`,
                    background: engine.anomaly > engine.threshold ? 'var(--warning)' : 'var(--s1)' }} />
                </div>
                <div className="muted" style={{ fontSize: 12, marginTop: 6 }}>
                  Deviation {engine.anomaly.toFixed(1)} of {engine.threshold} · learned from {engine.learned} s of driving
                </div>
              </div>
            </div>
          )}
        </div>
      </div>

      <div className="gauges panel">
        {GAUGES.map(([k, name, unit, d, color]) => (
          <div key={k} className="gauge">
            <div className="kpi-label">{name}</div>
            <div className="kpi-value">{row[k] == null ? '—' : row[k].toFixed(d)}<small>{unit}</small></div>
            <Spark values={series(recent, k)} color={color} width={150} />
          </div>
        ))}
      </div>
    </div>
  );
}
