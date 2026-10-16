// Bounded audio ring buffer and bounded history: nothing grows while the microphone runs.

export class RingBuffer {
  constructor(capacity) {
    if (!(capacity > 0)) throw new Error('RingBuffer capacity must be positive');
    this.data = new Float32Array(capacity);
    this.write = 0;
    this.filled = 0;
  }

  push(chunk) {
    const cap = this.data.length;
    let src = chunk;
    if (src.length >= cap) src = src.subarray(src.length - cap);
    const first = Math.min(src.length, cap - this.write);
    this.data.set(src.subarray(0, first), this.write);
    this.data.set(src.subarray(first), 0);
    this.write = (this.write + src.length) % cap;
    this.filled = Math.min(cap, this.filled + src.length);
  }

  /** Copy of the newest n samples, oldest first; null until n samples have arrived. */
  latest(n) {
    if (n > this.filled || n > this.data.length) return null;
    const out = new Float32Array(n);
    const start = (this.write - n + this.data.length) % this.data.length;
    const first = Math.min(n, this.data.length - start);
    out.set(this.data.subarray(start, start + first));
    out.set(this.data.subarray(0, n - first), first);
    return out;
  }

  clear() {
    this.write = 0;
    this.filled = 0;
  }
}

/** New array with item first, at most max entries. */
export function pushBounded(list, item, max) {
  return [item, ...list].slice(0, max);
}

/** RMS and peak of one chunk, in dBFS and linear. */
export function level(chunk) {
  let sum = 0;
  let peak = 0;
  for (let i = 0; i < chunk.length; i++) {
    const v = chunk[i];
    sum += v * v;
    const a = Math.abs(v);
    if (a > peak) peak = a;
  }
  const rms = chunk.length ? Math.sqrt(sum / chunk.length) : 0;
  return { rms, peak, dbfs: 20 * Math.log10(rms + 1e-12) };
}
