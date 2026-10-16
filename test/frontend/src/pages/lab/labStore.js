// The Signature lab's memory. The frame only carries the current second of signals, and the page
// remounts on every tab switch, so the lab keeps its own rolling buffer here, at module level, fed by
// LiveProvider for every frame whatever tab is open. It also learns a baseline spectrum per engine
// context (in this browser), for the "this car's normal" band on the evidence charts.
import { useSyncExternalStore } from 'react';

const KEEP = 180;          // seconds of signals kept
export const BASELINE_MIN = 10;   // healthy seconds per context before a baseline is shown
// Learn from seconds the classifier calls healthy: no confirmed fault and a healthy share of 0.6 or
// more. Not from the backend status alone: after a long fault the backend's own baseline freezes,
// and a repaired car then reads "sounds different" (info) until Mark serviced, so nothing would be
// learned for the rest of the session.
const LEARN_HEALTHY_P = 0.6;
const LEARNED = ['spectrum', 'envelope', 'orders'];

const empty = () => ({ car: null, frames: [], baselines: {}, axes: null, version: 0 });
let state = empty();
const listeners = new Set();

function emit(next) {
  state = { ...next, version: state.version + 1 };
  listeners.forEach((fn) => fn());
}

const argmax = (a) => a.reduce((k, v, i) => (v > a[k] ? i : k), 0);
const f32 = (a) => Float32Array.from(a);

/** The engine alert carries the classifier's advice: its message ends with the model confidence. */
export const engineAlert = (alerts) => alerts?.find((a) => /Model confidence/.test(a.message)) ?? null;

function welford(b, y) {
  b.n += 1;
  for (let i = 0; i < y.length; i++) {               // running mean and variance per bin
    const d = y[i] - b.mean[i];
    b.mean[i] += d / b.n;
    b.m2[i] += d * (y[i] - b.mean[i]);
  }
}

/** One second the models called healthy, folded into this context's normal for each signal. */
function learn(baselines, context, f) {
  const prev = baselines[context] ?? {};
  const next = {};
  for (const key of LEARNED) {
    const y = f[key];
    const b = prev[key] ?? { n: 0, mean: new Float64Array(y.length), m2: new Float64Array(y.length) };
    welford(b, y);
    next[key] = b;
  }
  return { ...baselines, [context]: next };
}

/** @param {import('./types.js').Frame} m */
function push(m) {
  if (!m?.vehicle) return;
  const car = `${m.vehicle.car_type}/${m.vehicle.unit}`;
  const base = state.car === car ? state : { ...empty(), car };
  const { sig, engine, row } = m;
  if (!sig || engine.state !== 'running') {
    if (base !== state) emit(base);
    return;
  }
  const last = base.frames[base.frames.length - 1];
  if (last && row.clock <= last.clock) return;     // the hello after a reconnect repeats the last frame

  const z = sig.spectrogram.z;
  const flat = new Float32Array(z.length * z[0].length);
  z.forEach((r, i) => flat.set(r, i * r.length));
  /** @type {import('./types.js').LabFrame} */
  const f = {
    clock: row.clock, t: row.t, rpm: sig.rpm,
    spectrum: f32(sig.spectrum.db), envelope: f32(sig.envelope.y), spectrogram: flat,
    time: f32(sig.time.y), crank: f32(sig.crank.dev), orders: f32(sig.orders.amp),
    engine: {
      status: engine.status, fault: engine.fault, label: engine.label, anomaly: engine.anomaly,
      healthy_p: engine.healthy_p, context: engine.context, threshold: engine.threshold,
    },
    picks: Object.fromEntries(Object.entries(engine.votes).map(([k, p]) => [k, argmax(p)])),
    top: argmax(engine.ensemble),
    alert: engineAlert(m.alerts)?.title ?? null,
  };
  const frames = [...(base.frames.length >= KEEP ? base.frames.slice(base.frames.length - KEEP + 1) : base.frames), f];
  const healthy = engine.fault === 'healthy' && engine.healthy_p >= LEARN_HEALTHY_P;
  const baselines = healthy ? learn(base.baselines, engine.context, f) : base.baselines;
  const axes = base.axes ?? {
    spectrum: f32(sig.spectrum.f), envelope: f32(sig.envelope.f),
    spectrogramF: f32(sig.spectrogram.f), spectrogramT: f32(sig.spectrogram.t), time: f32(sig.time.t_ms),
  };
  emit({ ...base, frames, baselines, axes });
}

export const labStore = {
  push,
  /** "Mark serviced": forget this car's learned normal (the backend forgets its own too). */
  forgetBaseline: () => emit({ ...state, baselines: {} }),
  subscribe: (fn) => { listeners.add(fn); return () => listeners.delete(fn); },
  get: () => state,
};

/**
 * This car's normal for one signal ('spectrum' | 'envelope' | 'orders') in one context:
 * { n, mean, std } (Float64Array per bin), or just { n } while fewer than BASELINE_MIN seconds.
 */
export function baselineFor(s, context, key = 'spectrum') {
  const b = s.baselines[context]?.[key];
  if (!b || b.n < BASELINE_MIN) return { n: b?.n ?? 0 };
  return { n: b.n, mean: b.mean, std: b.m2.map((v) => Math.sqrt(v / (b.n - 1))) };
}

/** useLabStore((s) => s.frames): re-renders only when the store changes, not on the 1 s ticker. The
 *  selector must return something already in the store (not a new object), or React loops. */
export function useLabStore(select = (s) => s) {
  return useSyncExternalStore(labStore.subscribe, () => select(labStore.get()));
}

/**
 * A stored second as a frame-shaped sig (plain arrays, as the charts expect), so every evidence and
 * drill-down view can show a past second exactly as it showed the live one. `labels` comes from the
 * live sig (the order labels never change).
 */
export function sigAt(f, axes, labels) {
  const nt = axes.spectrogramT.length;
  return {
    rpm: f.rpm,
    time: { t_ms: Array.from(axes.time), y: Array.from(f.time) },
    spectrum: { f: Array.from(axes.spectrum), db: Array.from(f.spectrum) },
    spectrogram: {
      f: Array.from(axes.spectrogramF), t: Array.from(axes.spectrogramT),
      z: Array.from({ length: axes.spectrogramF.length }, (_, i) => Array.from(f.spectrogram.subarray(i * nt, (i + 1) * nt))),
    },
    envelope: { f: Array.from(axes.envelope), y: Array.from(f.envelope), orders: [0.5, 1, 1.5, 2].map((o) => (o * f.rpm) / 60) },
    orders: { labels, amp: Array.from(f.orders) },
    crank: { dev: Array.from(f.crank) },
    marks: {},
  };
}
