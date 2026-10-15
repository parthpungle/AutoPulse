import { useEffect, useMemo, useRef, useState } from 'react';
import { CircleCheck, Pause, Play } from 'lucide-react';
import { useApi } from '../api.js';
import LineChart from '../components/charts/LineChart.jsx';
import { AlertCard, Tabs } from '../components/ui.jsx';
import { OBD_FAULTS, label, useScenario } from '../scenario.jsx';

const KPIS = [
  ['speed_kph', 'Speed', 'km/h', 0], ['rpm', 'Engine', 'rpm', 0], ['coolant_c', 'Coolant', '°C', 0],
  ['oil_pressure_bar', 'Oil pressure', 'bar', 1], ['battery_v', 'Battery', 'V', 1], ['fuel_level_pct', 'Fuel', '%', 1],
];

const VIEWS = {
  coolant: { name: 'Coolant', series: [['coolant_c', 'Coolant temperature (°C)', 'var(--s2)']], hlines: [{ y: 112, label: 'Critical 112 °C' }], fmt: (v) => v.toFixed(0) },
  battery: { name: 'Battery', series: [['battery_v', 'System voltage (V)', 'var(--s1)']], hlines: [{ y: 13.0, label: 'Not charging below 13 V' }], fmt: (v) => v.toFixed(1) },
  oil: { name: 'Oil', series: [['oil_pressure_bar', 'Oil pressure (bar)', 'var(--s3)']], hlines: [{ y: 0.5, label: 'Stop below 0.5 bar' }], fmt: (v) => v.toFixed(1) },
  tyres: { name: 'Tyres', series: [['tyre_fl_psi', 'Front-left', 'var(--s1)'], ['tyre_fr_psi', 'Front-right', 'var(--s2)'],
    ['tyre_rl_psi', 'Rear-left', 'var(--s3)'], ['tyre_rr_psi', 'Rear-right', 'var(--s4)']], hlines: [{ y: 22, label: 'Puncture below 22 psi' }], fmt: (v) => v.toFixed(0) },
  speed: { name: 'Speed', series: [['speed_kph', 'Vehicle speed (km/h)', 'var(--s1)']], hlines: [], fmt: (v) => v.toFixed(0) },
};

const pickView = (f) => ({ coolant_leak: 'coolant', thermostat_stuck: 'coolant', belt_broken: 'coolant', alternator_failure: 'battery',
  low_oil_pressure: 'oil', puncture: 'tyres', slow_leak: 'tyres' }[f] || 'coolant');

export default function LiveDrive() {
  const { s } = useScenario();
  const body = useMemo(() => ({ obd_fault: s.obd_fault, ambient: s.ambient, seed: s.seed }), [s.obd_fault, s.ambient, s.seed]);
  const { data, loading } = useApi('/drive', body);
  const [t, setT] = useState(10);
  const [playing, setPlaying] = useState(false);
  const [view, setView] = useState(pickView(s.obd_fault));
  const raf = useRef(null);

  useEffect(() => { setView(pickView(s.obd_fault)); setT(10); setPlaying(true); }, [s.obd_fault, s.ambient, s.seed]);
  useEffect(() => {
    if (!playing || !data) return undefined;
    raf.current = setInterval(() => setT((v) => {
      if (v >= 895) { setPlaying(false); return 899; }
      return v + 5;
    }), 60);
    return () => clearInterval(raf.current);
  }, [playing, data]);

  if (!data) return <div className="muted">Loading drive…</div>;
  const S = data.series;
  const n = S.t.length;
  const i = Math.min(n - 1, Math.max(0, Math.round(t)));
  const frame = data.alerts.reduce((acc, a) => (a.t <= t ? a : acc), data.alerts[0]);
  const alerts = frame?.alerts || [];
  const V = VIEWS[view];
  const visible = (k) => S[k].map((v, j) => (j <= i ? v : null));

  return (
    <div className={`stack ${loading ? 'loading' : ''}`}>
      <div className="panel panel-pad">
        <div className="row" style={{ gap: 16 }}>
          <button className="btn primary" onClick={() => { if (t >= 895) setT(10); setPlaying(!playing); }} style={{ minWidth: 104 }}>
            {playing ? <Pause size={16} /> : <Play size={16} />}{playing ? 'Pause' : t >= 895 ? 'Replay' : 'Play'}
          </button>
          <input type="range" min="10" max={n - 1} step="1" value={i} onChange={(e) => { setPlaying(false); setT(+e.target.value); }}
            aria-label="Drive time" />
          <div style={{ minWidth: 150, textAlign: 'right' }}>
            <div className="kpi-label">Drive time</div>
            <div style={{ fontVariantNumeric: 'tabular-nums' }}>{Math.floor(i / 60)} min {String(i % 60).padStart(2, '0')} s</div>
          </div>
        </div>
        <div className="note" style={{ marginTop: 8 }}>Injected: <b style={{ color: 'var(--ink)' }}>{label(OBD_FAULTS, s.obd_fault)}</b> from minute 4. Change it under Scenario.</div>
      </div>

      <div className="grid3" style={{ gridTemplateColumns: 'repeat(6, 1fr)' }}>
        {KPIS.map(([k, name, unit, d]) => (
          <div key={k} className="panel panel-pad" style={{ padding: '12px 14px' }}>
            <div className="kpi-label">{name}</div>
            <div className="kpi-value" style={{ fontSize: 22 }}>{S[k][i].toFixed(d)}<small>{unit}</small></div>
          </div>
        ))}
      </div>

      <div className="grid2" style={{ gridTemplateColumns: '1.6fr 1fr', alignItems: 'start' }}>
        <div className="panel panel-pad">
          <div className="row" style={{ marginBottom: 14 }}>
            <Tabs value={view} onChange={setView} items={Object.entries(VIEWS).map(([k, v]) => [k, v.name])} />
          </div>
          <LineChart height={320} xDomain={[0, n - 1]} cursorX={i} hlines={V.hlines} fmtX={(v) => `${Math.round(v / 60)}m`} fmtY={V.fmt}
            series={V.series.map(([k, l, c]) => ({ id: k, label: l, color: c, x: S.t, y: visible(k) }))} />
          <div className="chart-caption">Telemetry up to the scrubber position. Dashed line: the hard limit the safety rules use.</div>
        </div>
        <div className="stack">
          <div className="eyebrow">Alerts & guidance · {Math.floor(i / 60)}:{String(i % 60).padStart(2, '0')}</div>
          {alerts.length === 0 ? (
            <div className="panel panel-pad row"><CircleCheck size={18} color="var(--good)" /><div><div style={{ fontWeight: 500 }}>All systems normal</div>
              <div className="note">No hard limit or rule has fired.</div></div></div>
          ) : alerts.map((a) => <AlertCard key={a.title} a={a} />)}
        </div>
      </div>
    </div>
  );
}
