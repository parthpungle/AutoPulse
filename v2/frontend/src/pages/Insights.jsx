import { useState } from 'react';
import { useNavTarget } from '../assistant/nav.js';
import { useApi } from '../api.js';
import LineChart from '../components/charts/LineChart.jsx';
import { HBars } from '../components/charts/Bars.jsx';
import { Stat, Tabs } from '../components/ui.jsx';

export default function Insights() {
  const [tab, setTab] = useState('baseline');
  useNavTarget('insights', 'tab', setTab);
  return (
    <div className="stack" data-spot="insights-panel">
      <Tabs items={[['baseline', 'Adaptive baseline'], ['wear', 'Component wear']]} value={tab} onChange={setTab} />
      {tab === 'baseline' ? <Baseline /> : <Wear />}
    </div>
  );
}

function Baseline() {
  const { data } = useApi('/baseline');
  if (!data) return <div className="muted">Simulating 8 months of one car…</div>;
  const band = [{ x0: data.fault_day, x1: 239, label: 'valve wear begins' }];
  const chart = (ctx, title) => {
    const c = data.contexts[ctx];
    return (
      <div className="panel panel-pad">
        <div className="eyebrow" style={{ marginBottom: 10 }}>{title}</div>
        <LineChart height={240} yLog xDomain={[0, 239]} bands={band} hlines={[{ y: data.threshold, label: 'Alarm threshold' }]}
          fmtX={(v) => `d${v}`} fmtY={(v) => (v >= 1 ? v.toFixed(0) : v.toFixed(1))}
          series={[{ id: 's', label: 'Fixed baseline', color: 'var(--s4)', x: c.day, y: c.static },
            { id: 'a', label: 'AutoPulse adaptive', color: 'var(--s1)', x: c.day, y: c.adaptive }]} />
      </div>
    );
  };
  const amb = data.contexts.cold_start;
  return (
    <>
      <div className="grid3">
        <Stat label="False-alarm days · fixed" value={data.static_false_alarm_days} sub="Alarms before any fault existed" />
        <Stat label="False-alarm days · adaptive" value={data.adaptive_false_alarm_days} sub="Seasons and ageing absorbed" />
        <Stat label="Detection delay · adaptive" value={data.adaptive_detection_delay} unit="days" sub="From the first sign of valve wear" />
      </div>
      <div className="grid2" style={{ gridTemplateColumns: '1fr 1fr' }}>
        {chart('cold_start', 'Cold start · anomaly score')}
        {chart('warm_idle', 'Warm idle · anomaly score')}
      </div>
      <div className="panel panel-pad">
        <div className="eyebrow" style={{ marginBottom: 10 }}>Ambient temperature · summer → winter</div>
        <LineChart height={150} xDomain={[0, 239]} fmtX={(v) => `d${v}`} fmtY={(v) => `${v.toFixed(0)}°`}
          series={[{ id: 't', label: 'Ambient °C', color: 'var(--s2)', x: amb.day, y: amb.ambient }]} />
        <div className="chart-caption">One simulated car over 240 days. The fixed baseline false-alarms as winter cold starts get noisier;
          the adaptive one stays quiet until valve wear begins on day {data.fault_day}, then rises in both contexts.</div>
      </div>
    </>
  );
}

function Wear() {
  const { data } = useApi('/wear');
  if (!data) return <div className="muted">Loading…</div>;
  const b = data.battery;
  return (
    <div className="grid2" style={{ gridTemplateColumns: '360px 1fr', alignItems: 'start' }}>
      <div className="stack">
        <div className="panel panel-pad">
          <div className="eyebrow" style={{ marginBottom: 14 }}>Component health · normal ageing</div>
          <HBars max={100} fmt={(v) => `${Math.round(v)}%`} items={data.components.map((c) => ({ label: c.name, value: c.health,
            color: c.health > 50 ? 'var(--good)' : c.health > 25 ? 'var(--warning)' : 'var(--critical)' }))} />
          <div className="chart-caption">Like a phone's battery health: slow, expected decline. A sudden step would raise an alert instead.</div>
        </div>
        {b.months_left && <Stat label="Battery replacement" value={`~${b.months_left}`} unit="months" sub="Trend of the temperature-compensated cranking dip" />}
      </div>
      <div className="panel panel-pad">
        <div className="eyebrow" style={{ marginBottom: 10 }}>Battery · cranking voltage dip</div>
        <LineChart height={320} xDomain={[0, b.day.length - 1]} hlines={[{ y: b.limit, label: 'Replace battery' }]} fmtX={(v) => `d${v}`}
          fmtY={(v) => `${v.toFixed(1)} V`}
          series={[{ id: 'r', label: 'Measured (cold mornings dip more)', color: 'var(--s4)', x: b.day, y: b.raw, width: 1.2, dim: true },
            { id: 'c', label: 'Temperature-compensated', color: 'var(--s1)', x: b.day, y: b.comp }]} />
      </div>
    </div>
  );
}
