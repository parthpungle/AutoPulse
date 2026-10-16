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
