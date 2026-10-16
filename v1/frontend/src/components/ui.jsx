// Small shared UI pieces: status icon + word, score ring, tabs, stat tile, alert card.
import { CircleCheck, Info, LoaderCircle, MapPin, OctagonAlert, TriangleAlert } from 'lucide-react';

export const STATUS_WORD = { ok: 'OK', info: 'Note', warning: 'Check', critical: 'Fault', pending: 'Waiting', checking: 'Checking' };

export function StatusIcon({ status, size = 16 }) {
  const p = { size, strokeWidth: 2 };
  if (status === 'ok') return <CircleCheck {...p} color="var(--good)" />;
  if (status === 'warning') return <TriangleAlert {...p} color="var(--warning)" />;
  if (status === 'critical') return <OctagonAlert {...p} color="var(--critical)" />;
  if (status === 'info') return <Info {...p} color="var(--info)" />;
  return <LoaderCircle {...p} color="var(--muted)" className={status === 'checking' ? 'spin' : ''} />;
}

export function Status({ status }) {
  return <span className={`status ${status === 'checking' ? 'pending' : status}`}><StatusIcon status={status} size={14} />{STATUS_WORD[status]}</span>;
}

export const scoreStatus = (score) => (score >= 85 ? 'ok' : score >= 60 ? 'warning' : 'critical');

export function Ring({ value, size = 120, stroke = 9, status }) {
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  const col = `var(--${status === 'ok' ? 'good' : status})`;
  return (
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} role="img" aria-label={`Health score ${value}`}>
      <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="var(--surface-3)" strokeWidth={stroke} />
      <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke={col} strokeWidth={stroke} strokeLinecap="round"
        strokeDasharray={`${(c * value) / 100} ${c}`} transform={`rotate(-90 ${size / 2} ${size / 2})`}
        style={{ transition: 'stroke-dasharray .8s ease' }} />
      <text x="50%" y="50%" textAnchor="middle" dominantBaseline="central" fill="var(--ink)"
        style={{ font: `500 ${size * 0.3}px var(--sans)` }}>{value}</text>
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

const SEV_VAR = { critical: '--critical', warning: '--warning', info: '--info', ok: '--good' };

export function AlertCard({ a }) {
  return (
    <div className="alert fade-in" style={{ '--c': `var(${SEV_VAR[a.severity]})` }}>
      <Status status={a.severity} />
      <h4>{a.title}</h4>
      <p>{a.message}</p>
      {a.actions?.length > 0 && <ul>{a.actions.map((x) => <li key={x}>{x}</li>)}</ul>}
      {a.maps_url && <a className="maps" href={a.maps_url} target="_blank" rel="noreferrer"><MapPin size={13} />Nearest help on maps</a>}
    </div>
  );
}
