// The engine cycle from the 200 ms vibration snippet (sig.time: every 6th sample of 24 kHz, so 4 kHz).
// There is no crank or cam reference in the stream and every window starts at a random crank phase,
// so this is an estimate: firings are found as the impulse comb at the expected spacing (an I4 fires
// every 180°, i.e. every 30/rpm s), 0° is put at the first firing in the window, and the snippet's
// energy is folded onto 720° using rpm. Firings are named F1–F4 by their order in this window only;
// which cylinder each one is cannot be known from the data.

export const FS = 4000;
export const BIN = 6;                       // degrees of crank per bin
export const PER = 180 / BIN;              // bins per firing interval (30)
export const BINS = 4 * PER;               // bins per 720° cycle (120)
const MIN_CONTRAST = 1.6;                  // best comb phase must beat the average phase by this much

/**
 * @returns {{ ok: false, reason: string } | { ok: true, phase: number, period: number, db: Float64Array,
 *   profile: Float64Array, contrast: number }}
 *   db: 120 bins over 720° (dB, arbitrary ref.); profile: 30 bins over one firing interval, averaged
 *   over all firings (phase-free, so it can be learned as this car's normal).
 */
export function foldCycle(y, rpm) {
  const n = y.length;
  const period = (FS * 30) / rpm;                       // samples between firings
  if (!(rpm > 300) || n < 4 * period) return { ok: false, reason: 'this second is shorter than one engine cycle' };

  // short-time energy, lightly smoothed
  const e = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    const a = y[Math.max(0, i - 1)], b = y[i], c = y[Math.min(n - 1, i + 1)];
    e[i] = (a * a + b * b + c * c) / 3;
  }
  // the comb phase that lands on the most energy: that is where the firings are
  let best = 0, bestScore = -1, sum = 0, count = 0;
  for (let p = 0; p < period; p++) {
    let s = 0;
    for (let k = 0; p + k * period < n; k++) {
      const i = Math.round(p + k * period);
      s += Math.max(e[Math.max(0, i - 1)], e[i] ?? 0, e[Math.min(n - 1, i + 1)]);
    }
    sum += s; count++;
    if (s > bestScore) { bestScore = s; best = p; }
  }
  const contrast = bestScore / (sum / count || 1);
  if (contrast < MIN_CONTRAST) return { ok: false, reason: 'no clear firing impulses this second' };

  // fold onto 720°: firing k (from the first one in the window) covers sector k mod 4
  const acc = new Float64Array(BINS), cnt = new Float64Array(BINS);
  const pAcc = new Float64Array(PER), pCnt = new Float64Array(PER);
  for (let i = 0; i < n; i++) {
    const u = (i - best) / period;
    const k = Math.floor(u);
    const b = Math.min(PER - 1, Math.floor((u - k) * PER));
    const bin = (((k % 4) + 4) % 4) * PER + b;
    acc[bin] += e[i]; cnt[bin]++;
    pAcc[b] += e[i]; pCnt[b]++;
  }
  const toDb = (a, c) => a.map((v, i) => 10 * Math.log10((c[i] ? v / c[i] : 0) + 1e-9));
  const db = toDb(acc, cnt);
  for (let i = 0; i < BINS; i++) if (!cnt[i]) db[i] = db[(i + BINS - 1) % BINS];   // fill a rare empty bin
  return { ok: true, phase: best, period, db, profile: toDb(pAcc, pCnt), contrast };
}

/** Mean crank speed change per firing sector (F1–F4), from crank.dev indexed from the window's first firing. */
export function sectorDev(dev) {
  return [0, 1, 2, 3].map((s) => {
    const v = Array.from(dev).filter((_, i) => i % 4 === s);
    return v.length ? v.reduce((a, b) => a + b, 0) / v.length : 0;
  });
}

/**
 * One line for "where in the cycle": the weakest firing when one is clearly slower, else where the
 * energy rises furthest over this car's normal (and in how many of the four firings), else whether
 * the four firings look alike.
 */
export function describeCycle(fold, dev, base) {
  if (!fold.ok) return { text: `Can't align this second: ${fold.reason}.` };
  const sd = sectorDev(dev);
  const weak = sd.indexOf(Math.min(...sd));
  const others = sd.filter((_, i) => i !== weak).reduce((a, b) => a + b, 0) / 3;
  if (sd[weak] < others - 10) {
    return { text: `F${weak + 1} slows the crank by ${Math.round(others - sd[weak])} rpm more than the other three firings, once per cycle.`, weak };
  }
  if (base?.mean) {
    const upper = (b) => base.mean[b] + 2 * base.std[b];
    // first look at what all four firings share: the rise over the normal mean, averaged over the
    // sectors (against the mean, like the spectrum readout; the ±2σ band spans a whole rpm band)
    const avg = Array.from({ length: PER }, (_, b) => [0, 1, 2, 3].reduce((a, s) => a + fold.db[s * PER + b], 0) / 4 - base.mean[b]);
    const top = avg.indexOf(Math.max(...avg));
    if (avg[top] > 3) {
      let lo = top, hi = top;
      while (lo > 0 && avg[lo - 1] > 3) lo--;
      while (hi < PER - 1 && avg[hi + 1] > 3) hi++;
      const peak = [0, 1, 2, 3].map((s) => s * PER + top).reduce((a, i) => (fold.db[i] > fold.db[a] ? i : a));
      const span = lo === hi ? `at ~${Math.round((top + 0.5) * BIN)}°` : `from ~${lo * BIN}° to ~${(hi + 1) * BIN}°`;
      return { text: `Energy above normal ${span} after every firing, by ${avg[top].toFixed(1)} dB on average over the four.`, peak };
    }
    // otherwise, one firing on its own
    let bi = 0, bx = -Infinity;
    for (let i = 0; i < BINS; i++) {
      const x = fold.db[i] - upper(i % PER);
      if (x > bx) { bx = x; bi = i; }
    }
    if (bx > 3) {
      return { text: `F${Math.floor(bi / PER) + 1} alone rises ${bx.toFixed(1)} dB above normal at ~${Math.round(((bi % PER) + 0.5) * BIN)}° after its firing.`, peak: bi };
    }
    return { text: 'All four firings sit inside this car\'s normal.' };
  }
  const e = [0, 1, 2, 3].map((s) => Math.max(...fold.db.slice(s * PER, (s + 1) * PER)));
  return { text: Math.max(...e) - Math.min(...e) < 3 ? 'The four firings look alike (within 3 dB).' : `F${e.indexOf(Math.min(...e)) + 1} is the weakest impulse this second.` };
}
