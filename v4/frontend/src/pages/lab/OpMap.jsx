// Operating point: where the engine has been this session, rpm against throttle. Grey cells are where
// the models called it healthy (from the backend's 15 min history); dots are seconds a fault was
// confirmed (from the lab store, since this page opened); the bright dot with its trail is now. When
// the action says to ease off, an arrow shows which way that moves the operating point.
import { scaleLinear } from 'd3-scale';
import { engineAlert } from './labStore.js';

const W = 340, H = 236;
const M = { l: 40, r: 12, t: 14, b: 32 };
const RPM_STEP = 250, THR_STEP = 5;
const SEV = { critical: 'var(--p1)', warning: 'var(--p2)' };

export default function OpMap({ rows, frames, alert: alertList }) {
  const run = rows.filter((r) => r.ignition && r.rpm != null && r.throttle_pct != null);
  if (run.length < 2) return null;
  const now = run[run.length - 1];
  const maxRpm = Math.max(4000, Math.ceil((Math.max(...run.map((r) => r.rpm)) + 300) / 1000) * 1000);
  const x = scaleLinear().domain([0, maxRpm]).range([M.l, W - M.r]);
  const y = scaleLinear().domain([0, 100]).range([H - M.b, M.t]);

  // healthy region: grid cells with at least 2 seconds the models called healthy
  const cells = new Map();
  for (const r of run) {
    if (r.healthy_p == null || r.healthy_p < 0.6) continue;
    const k = `${Math.floor(r.rpm / RPM_STEP)}:${Math.floor(r.throttle_pct / THR_STEP)}`;
    cells.set(k, (cells.get(k) ?? 0) + 1);
  }
  const byClock = new Map(run.map((r) => [r.clock, r]));
  const faults = frames.filter((f) => SEV[f.engine.status]).map((f) => ({ f, r: byClock.get(f.clock) })).filter((p) => p.r);
  const trail = run.slice(-15);
  const act = engineAlert(alertList)?.actions?.[0] ?? '';
  const easeOff = /ease off/i.test(act);
  const ax = x(now.rpm), ay = y(now.throttle_pct), toY = y(Math.max(0, now.throttle_pct - 25));

  return (
    <figure className="lab-opmap" aria-label={`Operating point now: ${Math.round(now.rpm)} rpm at ${Math.round(now.throttle_pct)}% throttle.${easeOff ? ' The action moves it to lower throttle.' : ''}`}>
      <svg width={W} height={H} role="img" aria-hidden>
        {[...cells].filter(([, n]) => n >= 2).map(([k]) => {
          const [i, j] = k.split(':').map(Number);
          return <rect key={k} x={x(i * RPM_STEP)} y={y((j + 1) * THR_STEP)} width={x(RPM_STEP) - x(0)} height={y(0) - y(THR_STEP)} className="lab-opmap__ok" />;
        })}
        {[0, 25, 50, 75, 100].map((v) => (
          <g key={v}><line x1={M.l} x2={W - M.r} y1={y(v)} y2={y(v)} stroke="var(--grid)" />
            <text x={M.l - 6} y={y(v)} textAnchor="end" dominantBaseline="middle">{v}%</text></g>
        ))}
        {x.ticks(4).map((v) => <text key={v} x={x(v)} y={H - M.b + 14} textAnchor="middle">{v / 1000}k</text>)}
        <text x={W - M.r} y={H - 4} textAnchor="end">rpm</text>
        {faults.map(({ f, r }) => <circle key={f.clock} cx={x(r.rpm)} cy={y(r.throttle_pct)} r="2.5" fill={SEV[f.engine.status]} />)}
        <polyline points={trail.map((r) => `${x(r.rpm)},${y(r.throttle_pct)}`).join(' ')} className="lab-opmap__trail" />
        {easeOff && toY - ay > 12 && (
          <g className="lab-opmap__arrow">
            <line x1={ax} y1={ay + 7} x2={ax} y2={toY} />
            <path d={`M${ax - 5},${toY - 8} L${ax},${toY} L${ax + 5},${toY - 8}`} />
            <text x={ax + 8} y={(ay + toY) / 2} dominantBaseline="middle">ease off</text>
          </g>
        )}
        <circle cx={ax} cy={ay} r="5" className="lab-opmap__now" />
      </svg>
      <figcaption>
        Throttle against rpm, this session. Grey: where the models called it healthy (backend history, 15 min). Dots: seconds
        a fault was confirmed (since this page opened). Bright dot and trail: the last 15 s.
      </figcaption>
    </figure>
  );
}
