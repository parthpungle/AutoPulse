// Small shared UI pieces: status icon + word, score ring, tabs, stat tile, alert card.
import { Boxes, CircleCheck, CircleDot, CircleHelp, FlaskConical, Info, Syringe, LoaderCircle, MapPin, OctagonAlert, TriangleAlert } from 'lucide-react';
import { AlarmShape, prio } from './hmi.jsx';

export const STATUS_WORD = { ok: 'OK', info: 'Note', unsure: 'Unsure', warning: 'Check', critical: 'Fault', pending: 'Waiting', checking: 'Checking' };

export function StatusIcon({ status, size = 16 }) {
  const p = prio(status);
  if (p) return <AlarmShape priority={p} size={size} />;          // ISA-18.2: shape + number, never colour alone
  if (status === 'unsure') return <CircleHelp size={size} strokeWidth={1.75} color="var(--p4)" />;   // models disagree: not an alarm
  if (status === 'ok') return <CircleCheck size={size} strokeWidth={2} color="var(--ok)" />;   // checked and fine
  return <LoaderCircle size={size} strokeWidth={2} color="var(--muted)" className={status === 'checking' ? 'spin' : ''} />;
}

export function Status({ status }) {
  return <span className={`status ${status === 'checking' ? 'pending' : status}`}><StatusIcon status={status} size={14} />{STATUS_WORD[status]}</span>;
}

export const scoreStatus = (score) => (score >= 85 ? 'ok' : score >= 60 ? 'warning' : 'critical');

export function Ring({ value, size = 120, stroke = 9, status }) {
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  const col = status === 'ok' ? 'var(--ok)' : `var(--${status})`;
  return (
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} role="img" aria-label={`Health score ${value}`}>
      <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="var(--surface-3)" strokeWidth={stroke} />
      <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke={col} strokeWidth={stroke} strokeLinecap="round"
        strokeDasharray={`${(c * value) / 100} ${c}`} transform={`rotate(-90 ${size / 2} ${size / 2})`}
        style={{ transition: 'stroke-dasharray .8s ease' }} />
      <text x="50%" y="50%" textAnchor="middle" dominantBaseline="central" fill={status === 'muted' ? 'var(--text-max)' : col}
        style={{ font: `500 ${size * 0.32}px var(--sans)`, letterSpacing: '-.03em' }}>{value}</text>
    </svg>
  );
}

export function Tabs({ items, value, onChange }) {
  return (
    <div className="tabs" role="tablist">
      {items.map(([id, name]) => (
        <button key={id} role="tab" aria-selected={value === id} className={value === id ? 'on' : ''} onClick={() => onChange(id)}>{name}</button>
      ))}
    </div>
  );
}

export function Stat({ label, value, unit, sub, tone }) {
  return (
    <div className="panel panel-pad">
      <div className="kpi-label">{label}</div>
      <div className="kpi-value" style={tone ? { color: `var(--${tone})` } : null}>{value}{unit && <small>{unit}</small>}</div>
      {sub && <div className="note" style={{ marginTop: 4 }}>{sub}</div>}
    </div>
  );
}

const SEV_VAR = { critical: '--p1', warning: '--p2', info: '--p4', ok: '--rule-strong' };

export function AlertCard({ a, compact = false }) {
  const actions = compact ? (a.actions || []).slice(0, 2) : a.actions;
  return (
    <div className={`alert fade-in ${compact ? 'compact' : ''}`} style={{ '--c': `var(${SEV_VAR[a.severity]})` }}>
      <Status status={a.severity} />
      <h4>{a.title}</h4>
      {!compact && <p>{a.message}</p>}
      {actions?.length > 0 && <ul>{actions.map((x) => <li key={x}>{x}</li>)}</ul>}
      {a.maps_url && <a className="maps" href={a.maps_url} target="_blank" rel="noreferrer"><MapPin size={13} />Nearest help on maps</a>}
    </div>
  );
}

/** Tiny trend line for a KPI (no axes; the number next to it carries the value). */
export function Spark({ values, width = 120, height = 28, color = 'var(--s1)', min, max }) {
  const v = values.filter((x) => x != null && Number.isFinite(x));
  if (v.length < 2) return <svg width={width} height={height} aria-hidden />;
  const lo = min ?? Math.min(...v), hi = max ?? Math.max(...v);
  const span = hi - lo || 1;
  const pts = v.map((y, i) => `${(i / (v.length - 1)) * width},${height - 2 - ((y - lo) / span) * (height - 4)}`).join(' ');
  return (
    <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`} aria-hidden>
      <polyline points={pts} fill="none" stroke={color} strokeWidth="1.5" strokeLinejoin="round" />
    </svg>
  );
}

// Where a number comes from. Never colour alone: each kind also has its own icon, border style and words.
// Colours: Okabe-Ito (colour-blind safe). real = filled, real_injected = striped, simulink = double border,
// simulator = dashed outline.
export const SOURCES = {
  real: { label: 'Real', icon: CircleDot, color: '#56B4E9', title: 'Measured on real recordings or real driving' },
  real_injected: { label: 'Real trips + injected faults', icon: Syringe, color: '#009E73',
    title: 'Real healthy driving data; the faults were added in software' },
  simulink: { label: 'Simulink/MATLAB', icon: Boxes, color: '#E69F00', title: 'Independent MATLAB or MathWorks Simulink engine model' },
  simulator: { label: 'Simulator', icon: FlaskConical, color: '#BBBBBB', title: 'Our own engine simulator: an upper bound, not a real-world score' },
};

export function SourceTag({ kind, label }) {
  const k = SOURCES[kind] || SOURCES.simulator;
  const Icon = k.icon;
  return (
    <span className={`source-tag src-${kind}`} style={{ '--src': k.color }} title={k.title}>
      <Icon size={12} strokeWidth={2.2} aria-hidden />{label || k.label}
    </span>
  );
}

/** Shown when the engine models abstain: an explicit "Unsure" with the reasons the dashboard found. */
export function UnsureBanner({ engine }) {
  if (!engine || engine.status !== 'unsure') return null;
  return (
    <div className="panel panel-pad unsure-banner" role="status">
      <StatusIcon status="unsure" size={22} />
      <div>
        <div style={{ fontWeight: 600, fontSize: 15 }}>Engine verdict: unsure · {Math.round((engine.confidence || 0) * 100)}% confidence</div>
        <div className="note" style={{ marginTop: 2 }}>{engine.why_unsure || 'The models disagree.'}</div>
        <div className="note muted" style={{ marginTop: 2 }}>Not called healthy, not called a fault. Get closer, wait for a steadier engine speed, or have it checked.</div>
      </div>
    </div>
  );
}
