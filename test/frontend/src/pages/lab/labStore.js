// The Signature lab's memory. The frame only carries the current second of signals, and the page
// remounts on every tab switch, so the lab keeps its own rolling buffer here, at module level, fed by
// LiveProvider for every frame whatever tab is open. It also learns a baseline spectrum per engine
// context (in this browser), for the "this car's normal" band on the evidence charts.
import { useSyncExternalStore } from 'react';

const KEEP = 180;          // seconds of signals kept
export const BASELINE_MIN = 10;   // healthy seconds per context before a baseline is shown
const LEARN_GATE = 2.8;    // learn only windows the backend would also call normal (baseline.py gate)

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

function learn(baselines, context, db) {
  const b = baselines[context] ?? { n: 0, mean: new Float64Array(db.length), m2: new Float64Array(db.length) };
  b.n += 1;
  for (let i = 0; i < db.length; i++) {             // Welford: running mean and variance per bin
    const d = db[i] - b.mean[i];
    b.mean[i] += d / b.n;
    b.m2[i] += d * (db[i] - b.mean[i]);
  }
  return { ...baselines, [context]: b };
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
  const ok = engine.status === 'ok' && engine.anomaly <= LEARN_GATE;
  const baselines = ok ? learn(base.baselines, engine.context, sig.spectrum.db) : base.baselines;
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

/** Baseline band for a context: { n, mean, std } (Float64Array per bin), or { n } while still learning. */
export function baselineFor(s, context) {
  const b = s.baselines[context];
  if (!b || b.n < BASELINE_MIN) return { n: b?.n ?? 0 };
  return { n: b.n, mean: b.mean, std: b.m2.map((v) => Math.sqrt(v / (b.n - 1))) };
}

/** useLabStore((s) => s.frames): re-renders only when the store changes, not on the 1 s ticker. The
 *  selector must return something already in the store (not a new object), or React loops. */
export function useLabStore(select = (s) => s) {
  return useSyncExternalStore(labStore.subscribe, () => select(labStore.get()));
}
