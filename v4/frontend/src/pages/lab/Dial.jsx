// 03 / Engine cycle: one 720° four-stroke cycle as a ring (the landing page's ring motif, made into an
// instrument). Radius = vibration energy at that crank angle, folded from this second's 200 ms snippet
// (cycle.js). The four sectors are the four firings, F1 at the top; each shows its mean crank-speed
// change. This car's normal per firing is the band; energy above it is filled in the excess tone.
import { BIN, BINS, PER, sectorDev } from './cycle.js';

const SIZE = 420, C = SIZE / 2, R0 = 64, R1 = 150;
const RANGE = 36;                                         // dB shown between the inner and outer radius

const polar = (bin, r) => {
  const t = (((bin + 0.5) * BIN) / 720) * 2 * Math.PI;     // 720° of crank around the full ring, clockwise from top
  return [C + r * Math.sin(t), C - r * Math.cos(t)];
};
const ring = (pts) => `M${pts.map((p) => p.join(',')).join('L')}Z`;

export default function Dial({ fold, dev, base, peak, weak, summary }) {
  if (!fold.ok) {
    return (
      <svg className="lab-dial" width={SIZE} height={SIZE} role="img" aria-label={summary}>
        <circle cx={C} cy={C} r={R1} className="lab-dial__frame" />
        <circle cx={C} cy={C} r={R0} className="lab-dial__frame" />
        <text x={C} y={C} textAnchor="middle" dominantBaseline="middle" className="lab-dial__msg">Can't align this second</text>
      </svg>
    );
  }
  const upper = (i) => base.mean[i % PER] + 2 * base.std[i % PER];
  const lower = (i) => base.mean[i % PER] - 2 * base.std[i % PER];
  const bins = [...Array(BINS).keys()];
  const hi = Math.max(...fold.db, ...(base ? bins.map(upper) : []));
  const r = (db) => R0 + Math.max(0, Math.min(1, (db - (hi - RANGE)) / RANGE)) * (R1 - R0);
  const live = bins.map((i) => polar(i, r(fold.db[i])));

  // excess: contiguous runs of bins where the live energy is above this car's normal
  const excess = [];
  if (base) {
    let run = [];
    const flush = () => { if (run.length) excess.push(run); run = []; };
    bins.forEach((i) => (fold.db[i] > upper(i) ? run.push(i) : flush()));
    flush();
  }
  const sd = sectorDev(dev);

  return (
    <svg className="lab-dial" width={SIZE} height={SIZE} viewBox={`0 0 ${SIZE} ${SIZE}`} role="img" aria-label={summary}>
      {/* crank-angle ticks: every 30°, longer every 90°, labelled at each firing */}
      {Array.from({ length: 24 }, (_, k) => {
        const a = k * 30, major = a % 90 === 0;
        const [x0, y0] = polar(a / BIN - 0.5, R1 + 6), [x1, y1] = polar(a / BIN - 0.5, R1 + (major ? 14 : 10));
        return <line key={a} x1={x0} y1={y0} x2={x1} y2={y1} className={major ? 'lab-dial__tick lab-dial__tick--major' : 'lab-dial__tick'} />;
      })}
      <circle cx={C} cy={C} r={R0} className="lab-dial__frame" />
      <circle cx={C} cy={C} r={R1} className="lab-dial__frame lab-dial__frame--outer" />

      {base && (
        <path className="lab-dial__band" fillRule="evenodd"
          d={`${ring(bins.map((i) => polar(i, r(upper(i)))))}${ring(bins.map((i) => polar(i, r(lower(i)))).reverse())}`} />
      )}
      {excess.map((run) => (
        <path key={run[0]} className="lab-dial__excess"
          d={`M${run.map((i) => polar(i, r(upper(i))).join(',')).join('L')}L${[...run].reverse().map((i) => polar(i, r(fold.db[i])).join(',')).join('L')}Z`} />
      ))}
      <path d={ring(live)} className="lab-dial__live" />

      {/* firings: a spoke at each, its name, and its mean crank-speed change */}
      {[0, 1, 2, 3].map((s) => {
        const [x0, y0] = polar(s * PER - 0.5, R0), [x1, y1] = polar(s * PER - 0.5, R1 + 16);
        const [lx, ly] = polar(s * PER + PER / 2 - 0.5, R1 + 30);
        const slow = s === weak;
        return (
          <g key={s} className={slow ? 'lab-dial__firing lab-dial__firing--slow' : 'lab-dial__firing'}>
            <line x1={x0} y1={y0} x2={x1} y2={y1} />
            <text x={lx} y={ly - 6} textAnchor="middle">F{s + 1}</text>
            <text x={lx} y={ly + 8} textAnchor="middle" className="lab-dial__dev">{Math.round(sd[s]) < 0 ? '−' : '+'}{Math.abs(Math.round(sd[s]))} rpm</text>
          </g>
        );
      })}
      {[0, 180, 360, 540].map((a) => {
        const [x, y] = polar(a / BIN - 0.5, R1 + 22);
        return <text key={a} x={x} y={y} textAnchor="middle" dominantBaseline="middle" className="lab-dial__deg">{a}°</text>;
      })}

      {peak != null && (() => {
        const [px, py] = polar(peak, r(fold.db[peak]));
        return <circle cx={px} cy={py} r="5" className="lab-dial__peak" />;
      })()}

      <text x={C} y={C - 8} textAnchor="middle" className="lab-dial__center">720°</text>
      <text x={C} y={C + 10} textAnchor="middle" className="lab-dial__center-sub">one cycle</text>
    </svg>
  );
}
