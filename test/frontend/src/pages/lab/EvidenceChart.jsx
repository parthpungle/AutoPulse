// The evidence chart: this second against this car's normal. The normal is a band (mean ± 2σ), the
// live trace a linear line (never smoothed: smoothing hides narrow peaks), and wherever the live trace
// rises above the band the gap is filled in the excess tone (a deviation, not an alarm colour).
// Optional: the landing page's corner bracket around a frequency band, direct labels for harmonics or
// orders (leader lines, nudged apart so they never overlap), and one callout on a point.
import { useMemo, useRef } from 'react';
import { scaleLinear } from 'd3-scale';
import { area, line } from 'd3-shape';
import { useWidth } from '../../components/charts/useWidth.js';

const M = { l: 52, r: 18, t: 34, b: 34 };
const CORNER = 10;

/** Lay labels out left to right, each at least `gap` px after the previous one's end (and after `start`). */
function spread(items, x, start = -Infinity, charW = 6.4, gap = 8) {
  let end = start;
  return [...items].sort((a, b) => a.x - b.x).map((m) => {
    const px = x(m.x);
    const lx = Math.max(px, end + gap);
    end = lx + m.label.length * charW;
    return { ...m, px, lx };
  });
}

export default function EvidenceChart({
  f, live, base, xDomain, yDomain, floor, bracket, markers = [], callout, yUnit, xUnit = 'Hz', xFmt = (v) => v,
  learning, summary, height = 300,
}) {
  const ref = useRef(null);
  const W = Math.max(useWidth(ref), 320), H = height;

  // only the bins inside the x domain
  const idx = useMemo(() => {
    const [lo, hi] = xDomain;
    const out = [];
    for (let i = 0; i < f.length; i++) if (f[i] >= lo && f[i] <= hi) out.push(i);
    return out;
  }, [f, xDomain]);

  const x = scaleLinear().domain(xDomain).range([M.l, W - M.r]);
  const y = useMemo(() => {
    let lo = Infinity, hi = -Infinity;
    for (const i of idx) {
      lo = Math.min(lo, live[i], base ? base.mean[i] - 2 * base.std[i] : Infinity);
      hi = Math.max(hi, live[i], base ? base.mean[i] + 2 * base.std[i] : -Infinity);
    }
    const pad = (hi - lo) * 0.08 || 1;
    return scaleLinear().domain(yDomain ?? [floor ?? lo - pad, hi + pad]).nice(5).range([H - M.b, M.t]);
  }, [idx, live, base, yDomain, floor, H]);

  const upper = (i) => base.mean[i] + 2 * base.std[i];
  // a signal that cannot go below `floor` (the envelope: 0) gets a band that stops there too
  const lower = (i) => Math.max(floor ?? -Infinity, base.mean[i] - 2 * base.std[i]);
  const band = base && area().x((i) => x(f[i])).y0((i) => y(lower(i))).y1((i) => y(upper(i)))(idx);
  const excess = base && area().defined((i) => live[i] > upper(i)).x((i) => x(f[i])).y0((i) => y(upper(i))).y1((i) => y(live[i]))(idx);
  const trace = line().x((i) => x(f[i])).y((i) => y(live[i]))(idx);
  const labels = spread(markers, x, M.l - 8 + (yUnit?.length ?? 0) * 6.4);
  const xt = x.ticks(Math.max(3, Math.floor(W / 110)));
  const top = M.t, bottom = H - M.b;

  return (
    <div className="chart lab-ev" ref={ref}>
      <svg width={W} height={H} role="img" aria-label={summary}>
        {y.ticks(5).map((v) => (
          <g key={v}>
            <line x1={M.l} x2={W - M.r} y1={y(v)} y2={y(v)} stroke="var(--grid)" />
            <text x={M.l - 8} y={y(v)} textAnchor="end" dominantBaseline="middle">{Math.round(v * 100) / 100}</text>
          </g>
        ))}
        <text className="lab-ev__unit" x={M.l - 8} y={top - 22} textAnchor="start">{yUnit}</text>
        <line x1={M.l} x2={W - M.r} y1={bottom} y2={bottom} stroke="var(--axis)" />
        {xt.map((v) => <text key={v} x={x(v)} y={bottom + 16} textAnchor="middle">{xFmt(v)}</text>)}
        <text x={W - M.r} y={H - 2} textAnchor="end">{xUnit}</text>

        {bracket && (() => {
          const x0 = x(bracket.x0), x1 = x(bracket.x1);
          // the landing page's bracket: four corners and the left bar, no fill
          const d = `M${x0 + CORNER},${top}H${x0}V${bottom}H${x0 + CORNER}M${x1 - CORNER},${top}H${x1}V${top + CORNER}M${x1},${bottom - CORNER}V${bottom}H${x1 - CORNER}`;
          return (
            <g className="lab-ev__bracket">
              <path d={d} fill="none" />
              <text x={x0} y={top - 8}>{bracket.label}</text>
            </g>
          );
        })()}

        {band && <path d={band} fill="var(--band)" stroke="var(--band-edge)" strokeWidth="1" />}
        {excess && <path d={excess} fill="var(--lab-excess-fill)" stroke="var(--lab-excess)" strokeWidth="1" />}
        <path d={trace} fill="none" stroke="var(--trace)" strokeWidth="1.75" strokeLinejoin="round" />

        {labels.map((m) => (
          <g key={m.label} className="lab-ev__marker">
            <line x1={m.px} x2={m.px} y1={top} y2={bottom} strokeDasharray="2 4" />
            <polyline points={`${m.px},${top} ${m.px},${top - 4} ${m.lx},${top - 10}`} fill="none" />
            <text x={m.lx} y={top - 13}>{m.label}</text>
          </g>
        ))}

        {callout && (() => {
          const cx = x(callout.x), cy = Math.max(top + 18, y(callout.y));
          const s = cx > W - 160 ? -1 : 1;                       // near the right edge: point left
          return (
            <g className="lab-ev__callout">
              <circle cx={cx} cy={y(callout.y)} r="4" />
              <polyline points={`${cx},${y(callout.y)} ${cx + 18 * s},${cy - 18} ${cx + 26 * s},${cy - 18}`} fill="none" />
              <text x={cx + 30 * s} y={cy - 18} textAnchor={s > 0 ? 'start' : 'end'} dominantBaseline="middle">{callout.text}</text>
            </g>
          );
        })()}

        {learning && (
          <text className="lab-ev__learning" x={(M.l + W - M.r) / 2} y={top + 14} textAnchor="middle">{learning}</text>
        )}
      </svg>
    </div>
  );
}
