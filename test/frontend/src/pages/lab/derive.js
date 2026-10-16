// Numbers the lab derives from the frame and the lab store (no new data: see SIGNATURE_LAB_PLAN.md §2).

export const argmax = (a) => a.reduce((k, v, i) => (v > a[k] ? i : k), 0);

/** Short class name, e.g. 'Knock / detonation' or 'Valve train wear'. */
export const shortClass = (c) => c.split(' (')[0];

/**
 * Model agreement this second: how many of the models' own picks match the 5 s verdict class.
 * Replaces the old "99% ensemble confidence".
 */
export function agreement(engine) {
  const k = argmax(engine.ensemble);
  const picks = Object.values(engine.votes).map(argmax);
  return { k, agree: picks.filter((p) => p === k).length, total: picks.length };
}

/** Largest 5 s share of any fault class (the number the backend compares with 0.5). */
export const faultShare = (engine) => Math.max(...engine.ensemble.slice(1));

/** Of the last n seconds in the store, how many had this fault id ('healthy' counts healthy seconds). */
export function persistence(frames, fault, n = 5) {
  const last = frames.slice(-n);
  return { hits: last.filter((f) => f.engine.fault === fault).length, of: last.length };
}

/**
 * When the current run of this fault id began: walk back while consecutive stored seconds share
 * it. `early` means the run reaches the oldest second kept, so it began at least that long ago.
 */
export function onset(frames, fault) {
  let i = frames.length - 1;
  if (i < 0 || frames[i].engine.fault !== fault) return null;
  while (i > 0 && frames[i - 1].engine.fault === fault && frames[i].clock - frames[i - 1].clock <= 2) i--;
  return { clock: frames[i].clock, early: i === 0 };
}

export function duration(s) {
  if (s < 60) return `${Math.round(s)} s`;
  const m = Math.floor(s / 60);
  return `${m} min ${String(Math.round(s % 60)).padStart(2, '0')} s`;
}

const BAND = {
  idle: 'idle, under 1,000 rpm',
  low: 'low band, 1,000–1,800 rpm',
  mid: 'mid band, 1,800–2,600 rpm',
  high: 'high band, 2,600 rpm and up',
};

/** 'warm_mid' -> 'Warm engine · mid band, 1,800–2,600 rpm' (the backend's baseline context). */
export function contextWords(ctx) {
  if (!ctx) return '';
  const [temp, band] = ctx.split('_');
  return `${temp === 'cold' ? 'Cold engine (under 60 °C)' : 'Warm engine'} · ${BAND[band] ?? band}`;
}

/** The engine alert's message without the trailing "Model confidence 99%." */
export const plainMessage = (msg) => msg?.replace(/\s*Model confidence \d+%\.?\s*$/, '') ?? '';

// ------------------------------------------------------------------ evidence (Phase 2)
// Pure functions over the frame's arrays (plain arrays or Float32Array alike).

/** Indices of the bins inside [lo, hi]. */
function binsIn(f, lo, hi) {
  const out = [];
  for (let i = 0; i < f.length; i++) if (f[i] >= lo && f[i] <= hi) out.push(i);
  return out;
}

const mean = (xs) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : NaN);
const median = (xs) => {
  const s = [...xs].sort((a, b) => a - b);
  return s.length ? s[s.length >> 1] : NaN;
};

export const bandMean = (f, y, lo, hi) => mean(binsIn(f, lo, hi).map((i) => y[i]));

/** Mean of live minus this car's normal over a band (dB on the spectrum, ratio units elsewhere). */
export const excessInBand = (f, live, base, lo, hi) => mean(binsIn(f, lo, hi).map((i) => live[i] - base.mean[i]));

/** Tallest bin in [lo, hi], its frequency refined by a parabola through its neighbours, and how far it
 *  stands above the median of the window. */
export function peakIn(f, y, lo, hi) {
  const idx = binsIn(f, lo, hi);
  if (!idx.length) return null;
  const k = idx.reduce((a, i) => (y[i] > y[a] ? i : a), idx[0]);
  let fk = f[k];
  if (k > 0 && k < y.length - 1) {
    const d = y[k - 1] - 2 * y[k] + y[k + 1];
    if (d !== 0) fk += (0.5 * (y[k - 1] - y[k + 1]) / d) * (f[k + 1] - f[k]);
  }
  return { f: fk, y: y[k], prominence: y[k] - median(idx.map((i) => y[i])) };
}

/** The window (width Hz) where live rises furthest above this car's normal, on average. */
export function largestExcess(f, live, base, width = 500) {
  const df = f[1] - f[0];
  const n = Math.max(1, Math.round(width / df));
  let best = { lo: f[0], hi: f[n - 1], db: -Infinity };
  for (let i = 0; i + n <= f.length; i++) {
    let s = 0;
    for (let j = i; j < i + n; j++) s += live[j] - base.mean[j];
    if (s / n > best.db) best = { lo: f[i], hi: f[i + n - 1], db: s / n };
  }
  return best;
}

/** How many bins sit inside mean ± 2σ. */
export function insideShare(live, base) {
  let k = 0;
  for (let i = 0; i < live.length; i++) if (Math.abs(live[i] - base.mean[i]) <= 2 * base.std[i]) k++;
  return k / live.length;
}

/**
 * Misfire: the firing phase (every 4th firing, an I4 engine fires 4 times per cycle) whose crank
 * speed change is lowest on average. The phase is relative to this window only (no crank reference).
 */
export function weakFiring(dev) {
  const by = [0, 1, 2, 3].map((p) => mean(Array.from(dev).filter((_, i) => i % 4 === p)));
  const phase = by.indexOf(Math.min(...by));
  return { phase, mean: by[phase], others: mean(by.filter((_, p) => p !== phase)) };
}

/** Half-order frequencies (k · rpm/120, the 720° cycle's harmonics) up to fmax. */
const halfOrders = (rpm, fmax) => Array.from({ length: Math.floor(fmax / (rpm / 120)) }, (_, k) => (k + 1) * (rpm / 120));

/**
 * Bearing: the tallest envelope peak (20–399 Hz) that is not an engine order, i.e. more than 4 Hz
 * from every half-order. Returns its frequency and its multiple of crank speed, or null.
 */
export function nonOrderPeak(f, y, rpm) {
  const orders = halfOrders(rpm, 420);
  let best = null;
  for (let i = 1; i < f.length - 1; i++) {
    if (f[i] < 20 || y[i] < y[i - 1] || y[i] < y[i + 1]) continue;
    if (orders.some((o) => Math.abs(o - f[i]) <= 4)) continue;
    if (!best || y[i] > best.y) best = { f: f[i], y: y[i] };
  }
  return best && best.y >= 0.15 ? { ...best, ratio: best.f / (rpm / 60) } : null;
}

/** The slowest bearing-defect rate the simulator's cars use (7.15× crank) leaves the 0–399 Hz view. */
export const bearingOutOfView = (rpm) => 7.15 * (rpm / 60) > 399;

/** Firing frequency harmonics of a four-cylinder engine (rpm/30, 2×, 3×) up to fmax. */
export const firingHarmonics = (rpm, fmax, n = 3) =>
  Array.from({ length: n }, (_, k) => ({ x: (k + 1) * (rpm / 30), label: `${k + 1}× firing` })).filter((m) => m.x <= fmax);
