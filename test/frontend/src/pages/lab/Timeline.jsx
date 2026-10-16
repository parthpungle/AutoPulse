// 04 / Timeline: the last 180 s of both detectors on one time axis, so the verdict and the charts can
// never seem to disagree. The top lane is the deviation from this car's normal against its own
// threshold (it can only raise an advisory). The bottom lane is the classifier: its non-healthy share
// and, underneath, the seconds it actually confirmed a fault (that is what raises the alarm). Dragging
// on either lane, or the arrow keys, picks a past second for every evidence view; Esc returns to live.
import { useRef } from 'react';
import { scaleLinear } from 'd3-scale';
import { line } from 'd3-shape';
import { useWidth } from '../../components/charts/useWidth.js';

const SPAN = 180;
const M = { l: 52, r: 18, t: 44, b: 26 };
const DEV_H = 112, GAP = 22, CLS_H = 52, STRIP = 8;
const SEV = { critical: 'var(--p1)', warning: 'var(--p2)', info: 'var(--p4)' };

/** Runs of consecutive stored seconds with the same non-ok status, as [{ from, to, status }]. */
function runs(frames) {
  const out = [];
  for (const f of frames) {
    const s = f.engine.status;
    const last = out[out.length - 1];
    if (s === 'ok') continue;
    if (last && last.status === s && f.clock - last.to <= 2) last.to = f.clock;
    else out.push({ from: f.clock, to: f.clock, status: s });
  }
  return out;
}

/**
 * Where the deviation first rose above its threshold for this episode: the earliest upward crossing
 * from 30 s before the fault was confirmed onwards, or, with no fault, the most recent crossing.
 */
function firstCrossing(rows, thr, onset) {
  const ups = [];
  for (let i = 1; i < rows.length; i++) {
    const a = rows[i - 1].anomaly, b = rows[i].anomaly;
    if (b != null && b >= thr && (a == null || a < thr)) ups.push(rows[i].clock);
  }
  if (onset == null) return ups[ups.length - 1] ?? null;
  return ups.find((c) => c >= onset - 30) ?? null;
}

export default function Timeline({ rows, frames, now, threshold, onset, inspect, onInspect }) {
  const ref = useRef(null);
  const W = Math.max(useWidth(ref), 320);
  const H = M.t + DEV_H + GAP + CLS_H + M.b;
  const devTop = M.t, devBot = M.t + DEV_H;
  const clsTop = devBot + GAP, clsBot = clsTop + CLS_H;

  const x = scaleLinear().domain([now - SPAN, now]).range([M.l, W - M.r]).clamp(true);
  const yDev = scaleLinear().domain([0, 10]).range([devBot, devTop]);
  const yCls = scaleLinear().domain([0, 1]).range([clsBot - STRIP - 4, clsTop]);
  const shown = rows.filter((r) => r.clock >= now - SPAN);
  const dev = line().defined((r) => r.anomaly != null).x((r) => x(r.clock)).y((r) => yDev(Math.min(10, r.anomaly)))(shown);
  const cls = line().defined((r) => r.healthy_p != null).x((r) => x(r.clock)).y((r) => yCls(1 - r.healthy_p))(shown);
  const segs = runs(frames);
  const seenFrom = frames[0]?.clock;
  const crossing = firstCrossing(shown, threshold, onset);

  // scrubbing: only seconds the lab has stored signals for can be inspected
  const pick = (clientX) => {
    if (!frames.length) return;
    const r = ref.current.getBoundingClientRect();
    const c = Math.round(x.invert(clientX - r.left));
    const lo = frames[0].clock, hi = frames[frames.length - 1].clock;
    onInspect(c >= hi ? null : Math.max(lo, c));
  };
  const onKey = (e) => {
    if (!frames.length) return;
    const lo = frames[0].clock, hi = frames[frames.length - 1].clock;
    const cur = inspect ?? hi;
    if (e.key === 'ArrowLeft') onInspect(Math.max(lo, cur - (e.shiftKey ? 10 : 1)));
    else if (e.key === 'ArrowRight') onInspect(cur + (e.shiftKey ? 10 : 1) >= hi ? null : cur + (e.shiftKey ? 10 : 1));
    else if (e.key === 'End' || e.key === 'Escape') onInspect(null);
    else return;
    e.preventDefault();
  };
  const ago = (c) => `−${now - c} s`;
  // recent markers sit near the right edge: their labels go on the left of the line there
  const marker = (c, label, row) => c != null && c >= now - SPAN && (
    <g className="lab-tl__marker" key={label}>
      <line x1={x(c)} x2={x(c)} y1={M.t - 14} y2={clsBot} />
      {x(c) > W - 240
        ? <text x={x(c) - 4} y={M.t - 30 + row * 11} textAnchor="end">{label} · {ago(c)}</text>
        : <text x={x(c) + 4} y={M.t - 30 + row * 11}>{label} · {ago(c)}</text>}
    </g>
  );

  return (
    <section className="panel panel-pad lab-timeline" aria-labelledby="lab-tl-title">
      <div className="row">
        <h2 className="eyebrow lab-eyebrow" id="lab-tl-title"><span className="num">04</span> / Timeline · last 3 min</h2>
        <div className="spacer" />
        <span className="lab-tl__hint">Drag, or focus and use ← →, to inspect a past second</span>
      </div>
      <div ref={ref} className="chart lab-tl" tabIndex={0} role="slider" aria-label="Inspect a past second"
        aria-valuemin={-SPAN} aria-valuemax={0} aria-valuenow={inspect == null ? 0 : inspect - now}
        aria-valuetext={inspect == null ? 'live' : `${now - inspect} seconds ago`} onKeyDown={onKey}
        onPointerDown={(e) => { e.currentTarget.setPointerCapture(e.pointerId); pick(e.clientX); }}
        onPointerMove={(e) => e.buttons === 1 && pick(e.clientX)}>
        <svg width={W} height={H} aria-hidden>
          {/* deviation lane */}
          <text className="lab-tl__lane" x={M.l} y={devTop - 6}>Deviation from this car's normal · RMS of top-5 feature z-scores (max 10)</text>
          {[0, 5, 10].map((v) => (
            <g key={v}>
              <line x1={M.l} x2={W - M.r} y1={yDev(v)} y2={yDev(v)} stroke="var(--grid)" />
              <text x={M.l - 8} y={yDev(v)} textAnchor="end" dominantBaseline="middle">{v}</text>
            </g>
          ))}
          <line className="lab-tl__thr" x1={M.l} x2={W - M.r} y1={yDev(threshold)} y2={yDev(threshold)} />
          <text className="lab-tl__thr-label" x={M.l + 4} y={yDev(threshold) - 5}>{threshold} · advisory after 3 s above</text>
          <path d={dev} fill="none" stroke="var(--trace)" strokeWidth="1.75" strokeLinejoin="round" />

          {/* classifier lane */}
          <text className="lab-tl__lane" x={M.l} y={clsTop - 6}>Classifier · non-healthy share, 5 s mean · bar: seconds a fault was confirmed</text>
          <line x1={M.l} x2={W - M.r} y1={yCls(0)} y2={yCls(0)} stroke="var(--grid)" />
          <line className="lab-tl__thr" x1={M.l} x2={W - M.r} y1={yCls(0.5)} y2={yCls(0.5)} />
          <text className="lab-tl__thr-label" x={M.l + 4} y={yCls(0.5) - 5}>0.50 · alarm after 2 s above (one class)</text>
          <text x={M.l - 8} y={yCls(0.5)} textAnchor="end" dominantBaseline="middle">0.5</text>
          <path d={cls} fill="none" stroke="var(--s3)" strokeWidth="1.5" strokeLinejoin="round" />
          {seenFrom != null && seenFrom > now - SPAN && (
            <text className="lab-tl__unseen" x={x(seenFrom) - 6} y={clsBot - 1} textAnchor="end">before this page: no stored signals</text>
          )}
          {segs.map((s) => (
            <rect key={s.from} x={x(s.from - 0.5)} width={Math.max(2, x(s.to + 0.5) - x(s.from - 0.5))} y={clsBot - STRIP} height={STRIP}
              fill={SEV[s.status]} />
          ))}

          {/* time axis */}
          <line x1={M.l} x2={W - M.r} y1={clsBot} y2={clsBot} stroke="var(--axis)" />
          {[180, 150, 120, 90, 60, 30, 0].map((s) => (
            <text key={s} x={x(now - s)} y={clsBot + 16} textAnchor="middle">{s ? `−${s} s` : 'now'}</text>
          ))}

          {marker(crossing, `first above ${threshold}`, 0)}
          {marker(onset, 'fault confirmed', 1)}

          {inspect != null && (
            <g className="lab-tl__cursor">
              <line x1={x(inspect)} x2={x(inspect)} y1={devTop - 4} y2={clsBot} />
              <rect x={x(inspect) - 30} y={clsBot + 4} width="60" height="17" rx="2" />
              <text x={x(inspect)} y={clsBot + 16} textAnchor="middle">{ago(inspect)}</text>
            </g>
          )}
        </svg>
      </div>
      <p className="chart-caption">
        The alarm follows the classifier: a fault is confirmed when one class holds 0.50 or more of the 5 s vote for 2 s in a row
        (red or amber bar). The deviation is a second, independent detector; on its own it only raises an advisory (violet bar).
      </p>
    </section>
  );
}
