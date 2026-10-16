// Spectrogram heatmap on canvas: one-hue (blue) sequential ramp, low values recede into the surface.
import { useEffect, useRef, useState } from 'react';
import { useWidth } from './useWidth.js';

const RAMP = ['#1a1918', '#104281', '#184f95', '#256abf', '#3987e5', '#6da7ec', '#9ec5f4', '#cde2fb'];
const M = { l: 48, r: 12, t: 8, b: 30 };

function hex(c) { return [1, 3, 5].map((i) => parseInt(c.slice(i, i + 2), 16)); }
const STOPS = RAMP.map(hex);
function colorAt(t) {
  const u = Math.min(0.9999, Math.max(0, t)) * (STOPS.length - 1);
  const i = Math.floor(u), f = u - i;
  return STOPS[i].map((a, k) => Math.round(a + (STOPS[i + 1][k] - a) * f));
}

export default function Heatmap({ f, t, z, height = 300, fmtF = (v) => `${(v / 1000).toFixed(0)}k`, fTicks: fTicksProp, fmtT = (v) => v.toFixed(2), unit = 'dB' }) {
  const ref = useRef(null);
  const canvas = useRef(null);
  const width = useWidth(ref);
  const [hover, setHover] = useState(null);
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
    const img = ctx.createImageData(nt, nf);
    for (let i = 0; i < nf; i++) for (let j = 0; j < nt; j++) {
      const [r, g, b] = colorAt((z[i][j] - lo) / (hi - lo || 1));
      const k = ((nf - 1 - i) * nt + j) * 4;
      img.data[k] = r; img.data[k + 1] = g; img.data[k + 2] = b; img.data[k + 3] = 255;
    }
    const off = document.createElement('canvas');
    off.width = nt; off.height = nf;
    off.getContext('2d').putImageData(img, 0, 0);
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(off, 0, 0, c.width, c.height);
  }, [z, pw, ph, lo, hi]);

  const fTicks = fTicksProp || [0, 2000, 4000, 6000, 8000, 10000, 12000].filter((v) => v <= f[f.length - 1]);
  const tMax = t[t.length - 1];
  return (
    <div className="chart" ref={ref}>
      <div style={{ position: 'relative', height: H }}>
        <canvas ref={canvas} style={{ position: 'absolute', left: M.l, top: M.t, width: pw, height: ph, borderRadius: 4 }}
          onMouseMove={(e) => {
            const r = e.currentTarget.getBoundingClientRect();
            const j = Math.floor(((e.clientX - r.left) / r.width) * t.length);
            const i = z.length - 1 - Math.floor(((e.clientY - r.top) / r.height) * z.length);
            if (i >= 0 && i < z.length && j >= 0 && j < t.length) setHover({ i, j, x: e.clientX - r.left + M.l, y: e.clientY - r.top });
          }}
          onMouseLeave={() => setHover(null)} />
        <svg width={W} height={H} style={{ position: 'absolute', inset: 0, pointerEvents: 'none' }}>
          {fTicks.map((v) => (
            <text key={v} x={M.l - 8} y={M.t + ph - (v / f[f.length - 1]) * ph} textAnchor="end" dominantBaseline="middle">{fmtF(v)}</text>
          ))}
          {[0, 0.25, 0.5, 0.75, 1].map((p) => (
            <text key={p} x={M.l + p * pw} y={H - M.b + 16} textAnchor="middle">{fmtT(p * tMax)}</text>
          ))}
          <text x={W - M.r} y={H - 2} textAnchor="end">s</text>
          <text x={M.l - 8} y={M.t - 0} textAnchor="end" dominantBaseline="hanging">Hz</text>
        </svg>
        {hover && (
          <div className="tip" style={{ left: Math.min(hover.x + 12, W - 160), top: hover.y }}>
            <div className="tx">{t[hover.j].toFixed(3)} s · {f[hover.i].toFixed(f[f.length - 1] < 100 ? 2 : 0)} Hz</div>
            <div className="tr">Power<b>{z[hover.i][hover.j].toFixed(1)} {unit}</b></div>
          </div>
        )}
      </div>
      <div className="row" style={{ gap: 8, fontSize: 11.5, color: 'var(--muted)', marginLeft: M.l }}>
        <span>low</span>
        <div style={{ width: 120, height: 6, borderRadius: 3, background: `linear-gradient(90deg, ${RAMP.join(',')})` }} />
        <span>high power</span>
      </div>
    </div>
  );
}
