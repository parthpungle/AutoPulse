// Heatmap on canvas: one-hue (blue) sequential ramp, low values recede into the surface.
// Spectrogram by default (f x t axes); pass rowLabels/colLabels for a categorical grid such as a confusion matrix.
import { useEffect, useRef, useState } from 'react';
import { useWidth } from './useWidth.js';
import { cssVar, useTheme } from '../../theme.js';

// one cool hue, never an alarm colour; the stops are theme tokens (--ramp-0..7 in styles.css)
const RAMP_VARS = Array.from({ length: 8 }, (_, i) => `var(--ramp-${i})`);
const MS = { l: 48, r: 12, t: 8, b: 30 };

function hex(c) { return [1, 3, 5].map((i) => parseInt(c.slice(i, i + 2), 16)); }
function colorAt(STOPS, t) {
  const u = Math.min(0.9999, Math.max(0, t)) * (STOPS.length - 1);
  const i = Math.floor(u), f = u - i;
  return STOPS[i].map((a, k) => Math.round(a + (STOPS[i + 1][k] - a) * f));
}

export default function Heatmap({ f, t, z, height = 300, fmtF = (v) => `${(v / 1000).toFixed(0)}k`,
  rowLabels, colLabels, cellText, tip, xTitle, yTitle, legend = ['low', 'high power'],
  fTicks: fTicksProp, fmtT = (v) => v.toFixed(2), unit = 'dB' }) {
  const cat = !!rowLabels;                         // categorical: row 0 at the top, labels instead of axes
  const M = cat ? { l: 92, r: 12, t: 8, b: 58 } : MS;
  const ref = useRef(null);
  const canvas = useRef(null);
  const width = useWidth(ref);
  const [hover, setHover] = useState(null);
  const theme = useTheme();
  const W = Math.max(width, 200), H = height;
  const pw = W - M.l - M.r, ph = H - M.t - M.b;
  const flat = z.flat();
  const lo = Math.min(...flat), hi = Math.max(...flat);

  useEffect(() => {
    const c = canvas.current;
    if (!c || pw <= 0) return;
    const dpr = window.devicePixelRatio || 1;
    c.width = pw * dpr; c.height = ph * dpr;
    const ctx = c.getContext('2d');
    const nf = z.length, nt = z[0].length;
    const stops = Array.from({ length: 8 }, (_, i) => hex(cssVar(`--ramp-${i}`) || '#000000'));
    const img = ctx.createImageData(nt, nf);
    for (let i = 0; i < nf; i++) for (let j = 0; j < nt; j++) {
      const [r, g, b] = colorAt(stops, (z[i][j] - lo) / (hi - lo || 1));
      const k = ((cat ? i : nf - 1 - i) * nt + j) * 4;
      img.data[k] = r; img.data[k + 1] = g; img.data[k + 2] = b; img.data[k + 3] = 255;
    }
    const off = document.createElement('canvas');
    off.width = nt; off.height = nf;
    off.getContext('2d').putImageData(img, 0, 0);
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(off, 0, 0, c.width, c.height);
  }, [z, pw, ph, lo, hi, cat, theme]);

  const fTicks = cat ? [] : fTicksProp || [0, 2000, 4000, 6000, 8000, 10000, 12000].filter((v) => v <= f[f.length - 1]);
  const tMax = cat ? 0 : t[t.length - 1];
  return (
    <div className="chart" ref={ref}>
      <div style={{ position: 'relative', height: H }}>
        <canvas ref={canvas} style={{ position: 'absolute', left: M.l, top: M.t, width: pw, height: ph, borderRadius: 4 }}
          onMouseMove={(e) => {
            const r = e.currentTarget.getBoundingClientRect();
            const j = Math.floor(((e.clientX - r.left) / r.width) * t.length);
            const row = Math.floor(((e.clientY - r.top) / r.height) * z.length);
            const i = cat ? row : z.length - 1 - row;
            if (i >= 0 && i < z.length && j >= 0 && j < (cat ? colLabels.length : t.length)) setHover({ i, j, x: e.clientX - r.left + M.l, y: e.clientY - r.top });
          }}
          onMouseLeave={() => setHover(null)} />
        <svg width={W} height={H} style={{ position: 'absolute', inset: 0, pointerEvents: 'none' }}>
          {cat && rowLabels.map((l, i) => (
            <text key={`r${i}`} x={M.l - 8} y={M.t + (i + 0.5) * (ph / z.length)} textAnchor="end" dominantBaseline="middle">{l}</text>
          ))}
          {cat && colLabels.map((l, j) => (
            <text key={`c${j}`} x={M.l + (j + 0.5) * (pw / colLabels.length)} y={H - M.b + 16} textAnchor="middle">
              {String(l).includes(' ') ? [String(l).slice(0, String(l).indexOf(' ')), String(l).slice(String(l).indexOf(' ') + 1)]
                .map((part, k) => <tspan key={k} x={M.l + (j + 0.5) * (pw / colLabels.length)} dy={k ? 13 : 0}>{part}</tspan>) : l}
            </text>
          ))}
          {cat && cellText && z.map((row, i) => row.map((_, j) => (
            <text key={`t${i}-${j}`} x={M.l + (j + 0.5) * (pw / row.length)} y={M.t + (i + 0.5) * (ph / z.length)} textAnchor="middle"
              dominantBaseline="middle" style={{ fill: (z[i][j] - lo) / (hi - lo || 1) > 0.55 ? '#0f0e0d' : 'var(--ink)', fontSize: 12 }}>
              {cellText(i, j)}</text>
          )))}
          {cat && xTitle && <text x={M.l + pw / 2} y={H - 4} textAnchor="middle">{xTitle}</text>}
          {cat && yTitle && <text x={12} y={M.t + ph / 2} textAnchor="middle" transform={`rotate(-90 12 ${M.t + ph / 2})`}>{yTitle}</text>}
          {!cat && fTicks.map((v) => (
            <text key={v} x={M.l - 8} y={M.t + ph - (v / f[f.length - 1]) * ph} textAnchor="end" dominantBaseline="middle">{fmtF(v)}</text>
          ))}
          {!cat && [0, 0.25, 0.5, 0.75, 1].map((p) => (
            <text key={p} x={M.l + p * pw} y={H - M.b + 16} textAnchor="middle">{fmtT(p * tMax)}</text>
          ))}
          {!cat && <text x={W - M.r} y={H - 2} textAnchor="end">s</text>}
          {!cat && <text x={M.l - 8} y={M.t - 0} textAnchor="end" dominantBaseline="hanging">Hz</text>}
        </svg>
        {hover && (
          <div className="tip" style={{ left: Math.min(hover.x + 12, W - 160), top: hover.y }}>
            {tip ? tip(hover.i, hover.j) : (<>
              <div className="tx">{t[hover.j].toFixed(3)} s · {f[hover.i].toFixed(f[f.length - 1] < 100 ? 2 : 0)} Hz</div>
              <div className="tr">Power<b>{z[hover.i][hover.j].toFixed(1)} {unit}</b></div></>)}
          </div>
        )}
      </div>
      <div className="row" style={{ gap: 8, fontSize: 11.5, color: 'var(--muted)', marginLeft: M.l }}>
        <span>{legend[0]}</span>
        <div style={{ width: 120, height: 6, borderRadius: 3, background: `linear-gradient(90deg, ${RAMP_VARS.join(',')})` }} />
        <span>{legend[1]}</span>
      </div>
    </div>
  );
}
