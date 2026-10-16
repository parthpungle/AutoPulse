import { useState } from 'react';
import { useNavTarget } from '../assistant/nav.js';
import { CircleCheck } from 'lucide-react';
import LineChart from '../components/charts/LineChart.jsx';
import { AlertCard, Tabs } from '../components/ui.jsx';
import { series, useLive } from '../live.jsx';

const KPIS = [
  ['speed_kph', 'Speed', 'km/h', 0], ['rpm', 'Engine', 'rpm', 0], ['coolant_c', 'Coolant', '°C', 0],
  ['oil_pressure_bar', 'Oil pressure', 'bar', 1], ['battery_v', 'Battery', 'V', 1], ['fuel_level_pct', 'Fuel', '%', 1],
];

const VIEWS = {
  coolant: { name: 'Coolant', series: [['coolant_c', 'Coolant temperature (°C)', 'var(--s1)']], hlines: [{ y: 112, label: 'Critical 112 °C' }], fmt: (v) => v.toFixed(0) },
  battery: { name: 'Battery', series: [['battery_v', 'System voltage (V)', 'var(--s1)']], hlines: [{ y: 13.0, label: 'Not charging below 13 V' }], fmt: (v) => v.toFixed(1) },
  oil: { name: 'Oil', series: [['oil_pressure_bar', 'Oil pressure (bar)', 'var(--s1)']], hlines: [{ y: 0.5, label: 'Stop below 0.5 bar' }], fmt: (v) => v.toFixed(1) },
  tyres: { name: 'Tyres', series: [['tyre_fl_psi', 'Front-left', 'var(--s1)'], ['tyre_fr_psi', 'Front-right', 'var(--s2)'],
    ['tyre_rl_psi', 'Rear-left', 'var(--s3)'], ['tyre_rr_psi', 'Rear-right', 'var(--s4)']], hlines: [{ y: 22, label: 'Puncture below 22 psi' }], fmt: (v) => v.toFixed(0) },
  fuel: { name: 'Fuel', series: [['fuel_level_pct', 'Fuel level (%)', 'var(--s1)']], hlines: [], fmt: (v) => v.toFixed(1) },
  speed: { name: 'Speed', series: [['speed_kph', 'Vehicle speed (km/h)', 'var(--s1)']], hlines: [], fmt: (v) => v.toFixed(0) },
};
const WINDOWS = [['120', '2 min'], ['300', '5 min'], ['900', '15 min']];

const mmss = (s) => `${Math.floor(s / 60)}:${String(Math.round(s) % 60).padStart(2, '0')}`;

export default function LiveDrive() {
  const { latest, history } = useLive();
  const [view, setView] = useState('coolant');
  const [win, setWin] = useState('300');
  useNavTarget('drive', 'tab', setView);
  const { row, alerts } = latest;
  const H = history.slice(-Number(win));
  const x = series(H, 'clock');
  const end = row.clock;
  const V = VIEWS[view];

  return (
    <div className="stack">
      <div className="grid3" style={{ gridTemplateColumns: 'repeat(6, 1fr)' }}>
        {KPIS.map(([k, name, unit, d]) => (
          <div key={k} className="panel panel-pad" style={{ padding: '12px 14px' }}>
            <div className="kpi-label">{name}</div>
            <div className="kpi-value" style={{ fontSize: 22 }}>{row[k] == null ? '—' : row[k].toFixed(d)}<small>{unit}</small></div>
          </div>
        ))}
      </div>

      <div className="grid2" style={{ gridTemplateColumns: '1.6fr 1fr', alignItems: 'start' }}>
        <div className="panel panel-pad" data-spot="drive-chart">
          <div className="row" style={{ marginBottom: 14, flexWrap: 'wrap' }}>
            <Tabs value={view} onChange={setView} items={Object.entries(VIEWS).map(([k, v]) => [k, v.name])} />
            <div className="spacer" />
            <Tabs value={win} onChange={setWin} items={WINDOWS} />
          </div>
          {H.length > 1 ? (
            <LineChart height={340} xDomain={[end - Number(win), end]} hlines={V.hlines} fmtY={V.fmt}
              fmtX={(v) => (v >= end - 0.5 ? 'now' : `-${mmss(end - v)}`)}
              series={V.series.map(([k, l, c]) => ({ id: k, label: l, color: c, x, y: series(H, k) }))} />
          ) : <div className="muted" style={{ height: 340 }}>Collecting telemetry…</div>}
          <div className="chart-caption">Streamed from the vehicle once a second. Dashed line: the hard limit the safety rules use.</div>
        </div>
        <div className="stack" data-spot="drive-alerts">
          <div className="row">
            <div className="eyebrow">Alerts & guidance</div>
            <div className="spacer" />
            <span className="muted" style={{ fontSize: 12 }}>{row.ignition ? `Trip ${mmss(row.t)}` : 'Engine off'}</span>
          </div>
          {alerts.length === 0 ? (
            <div className="panel panel-pad row"><CircleCheck size={18} color="var(--good)" /><div><div style={{ fontWeight: 500 }}>All systems normal</div>
              <div className="note">No hard limit, rule or engine model has fired.</div></div></div>
          ) : alerts.map((a) => <AlertCard key={a.title} a={a} />)}
        </div>
      </div>
    </div>
  );
}
