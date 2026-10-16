// Control-room building blocks (ISA-101 / High-Performance HMI, after TorqueTwin's design system):
// priority shapes, linear gauges with a shaded normal band, band-backed sparklines, KPI and sensor tiles.
// Grey while healthy; colour appears only with an alarm, and always with its shape and number.

export const PRIORITY = {
  1: { name: 'Critical', color: 'var(--p1)', shape: 'diamond' },
  2: { name: 'High', color: 'var(--p2)', shape: 'triangle' },
  3: { name: 'Medium', color: 'var(--p3)', shape: 'square' },
  4: { name: 'Advisory', color: 'var(--p4)', shape: 'circle' },
};
/** AutoPulse statuses onto ISA-18.2 priorities. */
export const prio = (status) => ({ critical: 1, warning: 2, info: 4 })[status] ?? null;
export const prioColor = (p) => (p ? PRIORITY[p].color : undefined);

const PATHS = {
  diamond: 'M12 1.5 22.5 12 12 22.5 1.5 12Z',
  triangle: 'M12 2 23 21.5H1Z',
  square: 'M3 3h18v18H3Z',
  circle: 'M12 2a10 10 0 1 0 0.001 0Z',
};

/** Colour + shape + number, never colour alone. Unacknowledged alarms flash at 1 Hz. */
export function AlarmShape({ priority, size = 16, flash = false }) {
  const p = PRIORITY[priority];
  if (!p) return null;
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" role="img" aria-label={`Priority ${priority} ${p.name}`}
      className={flash ? 'flash' : undefined} style={{ flex: 'none' }}>
      <path d={PATHS[p.shape]} fill={p.color} />
      <text x="12" y={p.shape === 'triangle' ? 18 : 16.2} textAnchor="middle" fontFamily="IBM Plex Mono, monospace" fontWeight="600"
        fontSize={p.shape === 'triangle' ? 10 : 11} fill="var(--on-alarm)">{priority}</text>
    </svg>
  );
}

/** Display ranges: scale, normal operating band, alarm limits. */
export const RANGES = {
  speed_kph: { scale: [0, 140], normal: [0, 120], digits: 0, unit: 'km/h' },
  rpm: { scale: [0, 6000], normal: [700, 3500], hi: 5500, digits: 0, unit: 'rpm' },
  coolant_c: { scale: [0, 130], normal: [80, 100], hi: 112, digits: 0, unit: '°C' },
  oil_pressure_bar: { scale: [0, 6], normal: [1, 5], lo: 0.5, digits: 1, unit: 'bar' },
  battery_v: { scale: [10, 15.5], normal: [13.5, 14.6], lo: 13, digits: 1, unit: 'V' },
  fuel_level_pct: { scale: [0, 100], normal: [15, 100], lo: 10, digits: 0, unit: '%' },
  ltft_pct: { scale: [-25, 25], normal: [-8, 8], hi: 10, digits: 0, unit: '%' },
  engine_load: { scale: [0, 100], normal: [0, 85], digits: 0, unit: '%' },
  tyre: { scale: [0, 45], normal: [30, 36], lo: 22, digits: 0, unit: 'psi' },
  anomaly: { scale: [0, 10], normal: [0, 3.5], hi: 3.5, digits: 1, unit: 'σ' },
};
const pct = (r, v) => ((Math.min(r.scale[1], Math.max(r.scale[0], v)) - r.scale[0]) / (r.scale[1] - r.scale[0])) * 100;
export const outside = (r, v) => v != null && ((r.lo !== undefined && v < r.lo) || (r.hi !== undefined && v > r.hi));

/** Linear scale with the normal band shaded, limit ticks and a moving pointer, instead of a bare number. */
export function LinearGauge({ label, value, range, priority = null, compact = false, unit }) {
  const p = priority ?? (outside(range, value) ? 3 : null);
  const color = prioColor(p);
  const ok = value != null && Number.isFinite(value);
  return (
    <div>
      <div className="gauge-top">
        <span className="label" style={color ? { color } : undefined}>{label}</span>
        <span>
          <span className={`gauge-val ${compact ? 'compact' : ''}`} style={color ? { color } : undefined}>{ok ? value.toFixed(range.digits) : '—'}</span>
          <span className="gauge-unit">{unit ?? range.unit}</span>
        </span>
      </div>
      <div className="gauge-scale">
        <div className="track" />
        <div className="bandz" style={{ left: `${pct(range, range.normal[0])}%`, width: `${pct(range, range.normal[1]) - pct(range, range.normal[0])}%` }} />
        {range.lo !== undefined && <div className="lim" style={{ left: `${pct(range, range.lo)}%` }} />}
        {range.hi !== undefined && <div className="lim" style={{ left: `${pct(range, range.hi)}%` }} />}
        {ok && <div className="ptr" style={{ left: `${pct(range, value)}%`, background: color }} />}
      </div>
    </div>
  );
}

/** Trend with the normal band behind it; the trace takes the alarm colour only while an alarm points at it. */
export function Sparkline({ values, range, priority = null, height = 40, threshold }) {
  const v = values.filter((x) => x != null && Number.isFinite(x));
  const [lo, hi] = range.scale;
  const W = 200;
  const y = (x) => height - 2 - ((Math.min(hi, Math.max(lo, x)) - lo) / (hi - lo)) * (height - 4);
  const pts = values.map((x, i) => (x == null || !Number.isFinite(x) ? null : `${(i / Math.max(values.length - 1, 1)) * W},${y(x)}`))
    .filter(Boolean).join(' ');
  return (
    <svg viewBox={`0 0 ${W} ${height}`} preserveAspectRatio="none" width="100%" height={height} aria-hidden style={{ display: 'block' }}>
      <rect x="0" y={y(range.normal[1])} width={W} height={Math.max(0, y(range.normal[0]) - y(range.normal[1]))} fill="var(--band)" />
      {range.normal[1] < hi && <line x1="0" x2={W} y1={y(range.normal[1])} y2={y(range.normal[1])} stroke="var(--band-edge)" vectorEffect="non-scaling-stroke" />}
      {range.normal[0] > lo && <line x1="0" x2={W} y1={y(range.normal[0])} y2={y(range.normal[0])} stroke="var(--band-edge)" vectorEffect="non-scaling-stroke" />}
      {threshold !== undefined && <line x1="0" x2={W} y1={y(threshold)} y2={y(threshold)} stroke="var(--text-dim)" strokeDasharray="3 3" vectorEffect="non-scaling-stroke" />}
      {v.length > 1 && <polyline points={pts} fill="none" stroke={priority ? PRIORITY[priority].color : 'var(--trace)'} strokeWidth="1.25"
        vectorEffect="non-scaling-stroke" strokeLinejoin="round" />}
    </svg>
  );
}

/** Large-number tile: critical numbers big, mono, tabular. */
export function KpiTile({ label, value, unit, priority = null, text = false, children }) {
  const color = prioColor(priority);
  return (
    <div className="kpi" style={color ? { borderColor: color, background: `color-mix(in srgb, ${color} 12%, var(--bg-1))` } : undefined}>
      <div className="row" style={{ gap: 6 }}>
        {priority && <AlarmShape priority={priority} size={14} />}
        <span className="label" style={color ? { color } : undefined}>{label}</span>
      </div>
      {children ?? (
        <div><span className={`big ${text ? 'text' : ''}`} style={color ? { color } : undefined}>{value ?? '—'}</span>{unit && <span className="unit">{unit}</span>}</div>
      )}
    </div>
  );
}

/** Standard panel: hairline frame, uppercase title, optional meta and controls on the right. */
export function Panel({ title, meta, right, children, className = '', bodyClass = '', style, priority }) {
  const color = prioColor(priority);
  return (
    <section className={`panel ${className}`} style={{ display: 'flex', flexDirection: 'column', minHeight: 0, ...(color ? { borderColor: color } : null), ...style }}>
      <header className="phead">
        {priority && <AlarmShape priority={priority} size={14} />}
        <span className="label" style={color ? { color } : undefined}>{title}</span>
        {meta && <span className="meta">{meta}</span>}
        {right}
      </header>
      <div className={bodyClass} style={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column' }}>{children}</div>
    </section>
  );
}

/** One sensor: gauge with its normal band, plus a trend. */
export function SensorTile({ label, value, range, series, priority = null, children }) {
  const color = prioColor(priority);
  return (
    <div className="tile" style={color ? { borderColor: color, background: `color-mix(in srgb, ${color} 10%, var(--bg-1))` } : undefined}>
      <div className="tile-body">
        {children ?? <LinearGauge label={label} value={value} range={range} priority={priority} />}
        {series && <div className="spark"><Sparkline values={series} range={range} priority={priority} height={36} /></div>}
      </div>
    </div>
  );
}
