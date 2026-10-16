// Line chart: thin 2px lines, hairline grid, one y-axis, crosshair + tooltip on hover.
// Legend for 2+ series (text in ink, colour only on the swatch). Optional markers, bands, threshold.
import { useMemo, useRef, useState } from 'react';
import { scaleLinear, scaleLog } from 'd3-scale';
import { line } from 'd3-shape';
import { useWidth } from './useWidth.js';

const M = { l: 48, r: 16, t: 12, b: 30 };

function nearest(xs, v) {
  let lo = 0, hi = xs.length - 1;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (xs[mid] < v) lo = mid; else hi = mid;
  }
  return Math.abs(xs[lo] - v) <= Math.abs(xs[hi] - v) ? lo : hi;
}

export default function LineChart({
  series, height = 280, yLog = false, xDomain, yDomain, markers = [], bands = [], hlines = [],
  cursorX = null, fmtX = (v) => v, fmtY = (v) => v, xTitle, yTitle, legend = true,
}) {
  const ref = useRef(null);
  const width = useWidth(ref);
  const [hover, setHover] = useState(null);
  const H = height, W = Math.max(width, 200);

  const { x, y } = useMemo(() => {
    const xs = series.flatMap((s) => s.x);
    const ys = series.flatMap((s) => s.y).filter((v) => v != null && Number.isFinite(v) && (!yLog || v > 0));
    const xd = xDomain || [Math.min(...xs), Math.max(...xs)];
    let yd = yDomain;
    if (!yd) {
      const lo = Math.min(...ys, ...hlines.map((h) => h.y)), hi = Math.max(...ys, ...hlines.map((h) => h.y));
      const pad = (hi - lo) * 0.08 || 1;
      yd = yLog ? [lo * 0.85, hi * 1.15] : [lo - pad, hi + pad];
    }
    const yS = (yLog ? scaleLog() : scaleLinear()).domain(yd).range([H - M.b, M.t]);
    if (!yLog) yS.nice(5);
    return { x: scaleLinear().domain(xd).range([M.l, W - M.r]), y: yS };
  }, [series, W, H, yLog, xDomain, yDomain, hlines]);

  const paths = series.map((s) => {
    const pts = s.x.map((xv, i) => [xv, s.y[i]]);
    return line().defined((d) => d[1] != null && Number.isFinite(d[1]) && (!yLog || d[1] > 0))
      .x((d) => x(d[0])).y((d) => y(d[1]))(pts);
  });

  const onMove = (e) => {
    const r = ref.current.getBoundingClientRect();
    const px = e.clientX - r.left;
    if (px < M.l || px > W - M.r) return setHover(null);
    const xv = x.invert(px);
    const rows = series.map((s) => {
      const i = nearest(s.x, xv);
      return { s, i, xv: s.x[i], yv: s.y[i] };
    });
    setHover({ px: x(rows[0].xv), xv: rows[0].xv, rows });
  };

  const xt = x.ticks(Math.max(3, Math.floor(W / 110)));
  const yt = yLog ? y.ticks(4).filter((v, i, a) => a.length < 8 || i % 2 === 0) : y.ticks(5);

  return (
    <div className="chart" ref={ref}>
      {legend && series.length > 1 && (
        <div className="legend">
          {series.map((s) => <span key={s.id}><i className="sw line" style={{ background: s.color }} />{s.label}</span>)}
          {hlines.map((h) => <span key={h.label}><i className="sw line" style={{ background: 'var(--ink-2)' }} />{h.label}</span>)}
        </div>
      )}
      <svg width={W} height={H} onMouseMove={onMove} onMouseLeave={() => setHover(null)} role="img"
        aria-label={series.map((s) => s.label).join(', ')}>
        {bands.map((b) => (
          <g key={b.label}>
            <rect x={x(b.x0)} y={M.t} width={Math.max(0, x(b.x1) - x(b.x0))} height={H - M.t - M.b} fill={b.fill || 'rgba(208,59,59,0.08)'} />
            <text x={x(b.x0) + 6} y={M.t + 12} style={{ fill: b.labelColor || 'var(--critical)' }}>{b.label}</text>
          </g>
        ))}
        {yt.map((v) => (
          <g key={v}>
            <line x1={M.l} x2={W - M.r} y1={y(v)} y2={y(v)} stroke="var(--grid)" />
            <text x={M.l - 8} y={y(v)} textAnchor="end" dominantBaseline="middle">{fmtY(v)}</text>
          </g>
        ))}
        <line x1={M.l} x2={W - M.r} y1={H - M.b} y2={H - M.b} stroke="var(--axis)" />
        {xt.map((v) => <text key={v} x={x(v)} y={H - M.b + 16} textAnchor="middle">{fmtX(v)}</text>)}
        {xTitle && <text x={W - M.r} y={H - 2} textAnchor="end">{xTitle}</text>}
        {yTitle && <text x={M.l} y={M.t - 2} textAnchor="start" dy="-0.2em" style={{ fill: 'var(--muted)' }}>{''}</text>}
        {markers.map((m) => (
          <g key={m.label}>
            <line x1={x(m.x)} x2={x(m.x)} y1={M.t} y2={H - M.b} stroke="var(--line-2)" />
            <text x={x(m.x) + 4} y={M.t + 10 + (m.row || 0) * 12} style={{ fill: 'var(--ink-2)' }}>{m.label}</text>
          </g>
        ))}
        {hlines.map((h) => (
          <g key={h.label}>
            <line x1={M.l} x2={W - M.r} y1={y(h.y)} y2={y(h.y)} stroke="var(--ink-2)" strokeDasharray="5 4" strokeWidth="1" />
          </g>
        ))}
        {paths.map((d, i) => <path key={series[i].id} d={d} fill="none" stroke={series[i].color} strokeWidth={series[i].width || 2}
          strokeLinejoin="round" strokeLinecap="round" opacity={series[i].dim ? 0.55 : 1} />)}
        {cursorX != null && <line x1={x(cursorX)} x2={x(cursorX)} y1={M.t} y2={H - M.b} stroke="var(--accent)" strokeWidth="1.5" />}
        {hover && (
          <g>
            <line x1={hover.px} x2={hover.px} y1={M.t} y2={H - M.b} stroke="var(--muted)" />
            {hover.rows.map(({ s, xv, yv }) => yv != null && Number.isFinite(yv) && (
              <circle key={s.id} cx={x(xv)} cy={y(yv)} r="4.5" fill={s.color} stroke="var(--surface)" strokeWidth="2" />
            ))}
          </g>
        )}
      </svg>
      {hover && (
        <div className="tip" style={{ left: Math.min(hover.px + 12, W - 170), top: 18 }}>
          <div className="tx">{fmtX(hover.xv)}{xTitle ? ` ${xTitle}` : ''}</div>
          {hover.rows.map(({ s, yv }) => (
            <div className="tr" key={s.id}><i className="sw" style={{ background: s.color }} />{s.label}<b>{yv == null ? '–' : fmtY(yv)}</b></div>
          ))}
        </div>
      )}
    </div>
  );
}
