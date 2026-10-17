// Insights: open sections divided by hairlines (like the cockpit), sized to fill the screen.
// Charts take whatever height their row gets, so nothing scrolls and nothing is left empty.
import { useRef, useState } from 'react';
import { useNavTarget } from '../assistant/nav.js';
import { useApi } from '../api.js';
import LineChart from '../components/charts/LineChart.jsx';
import { HBars } from '../components/charts/Bars.jsx';
import { useSize } from '../components/charts/useWidth.js';
import { Tabs } from '../components/ui.jsx';
import VibrationTab from './VibrationTab.jsx';

export default function Insights() {
  const [tab, setTab] = useState('baseline');
  useNavTarget('insights', 'tab', setTab);
  return (
    <div className="ins" data-spot="insights-panel">
      <Tabs items={[['baseline', 'Adaptive baseline'], ['wear', 'Component wear'], ['vibration', 'Vibration analysis']]} value={tab} onChange={setTab} />
      {tab === 'baseline' ? <Baseline /> : tab === 'wear' ? <Wear /> : <div className="ins-scroll"><VibrationTab /></div>}
    </div>
  );
}

function Sect({ title, meta, className = '', children }) {
  return (
    <section className={`sect ${className}`}>
      <div className="sect-head"><span className="label">{title}</span>{meta && <span className="meta">{meta}</span>}</div>
      {children}
    </section>
  );
}

/** A chart that fills the space left in its section. */
function FillChart(props) {
  const ref = useRef(null);
  const { h } = useSize(ref);
  const legend = props.legend !== false && props.series.length > 1 ? 30 : 0;   // the legend sits under the plot
  return <div className="fill" ref={ref}>{h > 60 && <LineChart {...props} height={h - legend} />}</div>;
}

function Num({ label, value, unit, sub }) {
  return (
    <div className="ins-num">
      <span className="label">{label}</span>
      <b className="num">{value}{unit && <small>{unit}</small>}</b>
      <span className="muted">{sub}</span>
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
      <Sect title={title} meta="log scale">
        <FillChart yLog xDomain={[0, 239]} bands={band} hlines={[{ y: data.threshold, label: 'Alarm threshold' }]}
          fmtX={(v) => `d${v}`} fmtY={(v) => (v >= 1 ? v.toFixed(0) : v.toFixed(1))}
          series={[{ id: 's', label: 'Fixed baseline', color: 'var(--s4)', x: c.day, y: c.static },
            { id: 'a', label: 'AutoPulse adaptive', color: 'var(--s1)', x: c.day, y: c.adaptive }]} />
      </Sect>
    );
  };
  const amb = data.contexts.cold_start;
  return (
    <div className="ins-base">
      <div className="ins-nums">
        <Num label="False-alarm days · fixed" value={data.static_false_alarm_days} sub="Alarms before any fault existed" />
        <Num label="False-alarm days · adaptive" value={data.adaptive_false_alarm_days} sub="Seasons and ageing absorbed" />
        <Num label="Detection delay · adaptive" value={data.adaptive_detection_delay} unit="days" sub="From the first sign of valve wear" />
      </div>
      <div className="ins-pair">
        {chart('cold_start', 'Cold start · anomaly score')}
        {chart('warm_idle', 'Warm idle · anomaly score')}
      </div>
      <Sect title="Ambient temperature · summer → winter" className="ins-amb">
        <FillChart xDomain={[0, 239]} fmtX={(v) => `d${v}`} fmtY={(v) => `${v.toFixed(0)}°`} legend={false}
          series={[{ id: 't', label: 'Ambient °C', color: 'var(--s2)', x: amb.day, y: amb.ambient }]} />
        <div className="chart-caption">One simulated car over 240 days. The fixed baseline false-alarms as winter cold starts get noisier;
          the adaptive one stays quiet until valve wear begins on day {data.fault_day}, then rises in both contexts.</div>
      </Sect>
    </div>
  );
}

function Wear() {
  const { data } = useApi('/wear');
  if (!data) return <div className="muted">Loading…</div>;
  const b = data.battery;
  return (
    <div className="ins-wear">
      <div className="ins-side">
        <Sect title="Component health · normal ageing">
          <div className="ins-bars">
            <HBars max={100} fmt={(v) => `${Math.round(v)}%`} items={data.components.map((c) => ({ label: c.name, value: c.health,
              color: c.health > 50 ? 'var(--good)' : c.health > 25 ? 'var(--warning)' : 'var(--critical)' }))} />
          </div>
          <div className="chart-caption">Like a phone's battery health: slow, expected decline. A sudden step would raise an alert instead.</div>
        </Sect>
        {b.months_left && (
          <Sect title="Battery replacement">
            <Num value={`~${b.months_left}`} unit="months" sub="Trend of the temperature-compensated cranking dip" />
          </Sect>
        )}
      </div>
      <Sect title="Battery · cranking voltage dip" className="ins-main">
        <FillChart xDomain={[0, b.day.length - 1]} hlines={[{ y: b.limit, label: 'Replace battery' }]} fmtX={(v) => `d${v}`}
          fmtY={(v) => `${v.toFixed(1)} V`}
          series={[{ id: 'r', label: 'Measured (cold mornings dip more)', color: 'var(--s4)', x: b.day, y: b.raw, width: 1.2, dim: true },
            { id: 'c', label: 'Temperature-compensated', color: 'var(--s1)', x: b.day, y: b.comp }]} />
      </Sect>
    </div>
  );
}
