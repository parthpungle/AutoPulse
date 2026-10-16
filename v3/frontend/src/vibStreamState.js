// Pure state logic for the simulated-accelerometer stream (tested with `npm test`, no browser needed).
// The display buffer is bounded: only the last `windowS` seconds of decimated points are kept per channel.

export const initialStream = { state: null, wave: {}, ana: null, error: null };

export function applyBatch(wave, msg, windowS) {
  const out = {};
  const keepFrom = msg.t1 - windowS;
  for (const [ch, b] of Object.entries(msg.channels)) {
    const prev = wave[ch] || { t: [], y: [] };
    const t = prev.t.concat(b.t), y = prev.y.concat(b.y);
    let k = 0;
    while (k < t.length && t[k] < keepFrom) k++;
    out[ch] = k ? { t: t.slice(k), y: y.slice(k) } : { t, y };
  }
  return out;
}

export function reduceStream(s, msg) {
  switch (msg.type) {
    case 'state':
      // a fresh run (or reset) starts from sample 0: drop the old picture
      return { ...s, state: msg, error: null, ...(msg.samples === 0 ? { wave: {}, ana: null } : {}) };
    case 'batch':
      return { ...s, wave: applyBatch(s.wave, msg, s.state?.settings?.window_s ?? 4) };
    case 'analysis':
      return { ...s, ana: msg };
    case 'error':
      return { ...s, error: msg.message };
    default:
      return s;
  }
}
