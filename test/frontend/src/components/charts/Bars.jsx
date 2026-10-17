// Bar charts: horizontal (ranked values with labels) and vertical (categories or signed values).
import { useRef, useState } from 'react';
import { scaleBand, scaleLinear } from 'd3-scale';
import { useWidth } from './useWidth.js';

/** Horizontal bars: one hue; the emphasised row in slot 1, the rest recede. Values are always labelled. */
export function HBars({ items, max = 1, fmt = (v) => `${Math.round(v * 100)}%` }) {
  return (
    <div className="stack" style={{ gap: 9 }}>
      {items.map((it) => (
        <div key={it.label} title={`${it.label}: ${fmt(it.value)}`}>
          <div className="row" style={{ fontSize: 12.5, marginBottom: 4 }}>
            <span style={{ color: it.emphasis ? 'var(--ink)' : 'var(--ink-2)' }}>{it.label}</span>
            <span className="spacer" />
            <span style={{ fontVariantNumeric: 'tabular-nums', color: 'var(--ink-2)' }}>{fmt(it.value)}</span>
          </div>
          <div className="meter">
            <div style={{ width: `${Math.max(0.5, (it.value / max) * 100)}%`, background: it.color || (it.emphasis ? 'var(--s1)' : 'var(--s3)') }} />
          </div>
        </div>
      ))}
    </div>
  );
}

const M = { l: 48, r: 12, t: 12, b: 30 };

/** Vertical bars around a zero baseline; 4px rounded data-ends; per-bar tooltip. */
export function VBars({ labels, values, height = 260, color = 'var(--s1)', colorOf, fmt = (v) => v.toFixed(2), showEvery = 1 }) {
  const ref = useRef(null);
  const width = useWidth(ref);
  const [hover, setHover] = useState(null);
  const W = Math.max(width, 200), H = height;
  const x = scaleBand().domain(labels.map(String)).range([M.l, W - M.r]).paddingInner(0.18);
  const lo = Math.min(0, ...values), hi = Math.max(0, ...values);
  const y = scaleLinear().domain([lo, hi]).nice(5).range([H - M.b, M.t]);
  const bw = Math.max(1, x.bandwidth());
  return (
    <div className="chart" ref={ref}>
      <svg width={W} height={H} onMouseLeave={() => setHover(null)}>
        {y.ticks(Math.max(2, Math.min(5, Math.floor(height / 40)))).map((v) => (
          <g key={v}>
            <line x1={M.l} x2={W - M.r} y1={y(v)} y2={y(v)} stroke={v === 0 ? 'var(--axis)' : 'var(--grid)'} />
            <text x={M.l - 8} y={y(v)} textAnchor="end" dominantBaseline="middle">{fmt(v)}</text>
          </g>
        ))}
        {values.map((v, i) => {
          const y0 = y(0), y1 = y(v);
          const top = Math.min(y0, y1), h = Math.max(1, Math.abs(y1 - y0));
          const rr = Math.min(4, bw / 2, h / 2);
          return (
            <g key={i} onMouseEnter={() => setHover({ i, v, cx: x(String(labels[i])) + bw / 2, cy: top })}>
              <rect x={x(String(labels[i])) - 1} y={M.t} width={bw + 2} height={H - M.t - M.b} fill="transparent" />
              <rect x={x(String(labels[i]))} y={top} width={bw} height={h} rx={rr} fill={colorOf ? colorOf(v, i) : color}
                opacity={hover && hover.i !== i ? 0.6 : 1} />
            </g>
          );
        })}
        {labels.map((l, i) => i % showEvery === 0 && (
          <text key={i} x={x(String(l)) + bw / 2} y={H - M.b + 16} textAnchor="middle">{l}</text>
        ))}
      </svg>
      {hover && (
        <div className="tip" style={{ left: Math.min(hover.cx + 10, W - 150), top: Math.max(0, hover.cy - 10) }}>
          <div className="tx">{labels[hover.i]}</div>
          <div className="tr">Value<b>{fmt(hover.v)}</b></div>
        </div>
      )}
    </div>
  );
}
