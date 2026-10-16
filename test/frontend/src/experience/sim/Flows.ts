import type { SyntheticSignals } from '../signals/SyntheticSignals';
import type { Shared } from '../Uniforms';

/**
 * Timing of the Sensor Array's signal flows. Speeds are in path lengths per second; the phases
 * are integrated here (never `time * speed` in the shader), so a speed that follows RPM or the
 * throttle never makes a flow jump. `arrival` mirrors the shader's timing for the active flow, so
 * the showcased sensor's tip glows exactly as its particles arrive.
 */
export const FLOW = {
  /** Phenomenon flow per sensor: acoustic, vibration, crank, coolant, throttle, lambda, current, CAN. */
  speed: [0.34, 0.42, 0.5, 0.08, 0.5, 0.3, 0.42, 0.38],
  /** Data dashes along the cable to the OBD-II port. */
  data: 0.3,
  /** Acoustic wavefront shells in flight: healthy, and tightened by knock. */
  shells: [6, 10],
  /** Crank pulses in flight (one per passing tooth of the 60-2 wheel). */
  blips: 24,
  /** Current pulse groups and data dashes per path. */
  groups: 6,
  dashes: 14,
};

const fract = (x: number) => x - Math.floor(x);

export class Flows {
  /** Integrated phase per sensor (path lengths travelled). */
  readonly phase = new Float32Array(8);
  dataPhase = 0;
  /** 0..1: the active flow arriving at its sensor. */
  arrival = 0;
  /** ?debug knob: global speed multiplier. */
  speedScale = 1;

  update(dt: number, signals: SyntheticSignals, s: Shared, active: number, reduced: boolean) {
    const k = dt * this.speedScale * (reduced ? 0.25 : 1);
    const rpmK = Math.sqrt(signals.rpm / 800);
    for (let i = 0; i < 8; i++) {
      let v = FLOW.speed[i];
      if (i === 2) v *= rpmK; // pulses come faster as the engine revs
      if (i === 4) v *= 0.5 + signals.throttle; // more air, faster
      this.phase[i] += v * k;
    }
    this.dataPhase += FLOW.data * k;
    this.arrival = this.arrivalOf(active, signals, s);
  }

  /** How strongly the active flow is reaching the tip right now (see shapes.glsl). */
  private arrivalOf(a: number, signals: SyntheticSignals, s: Shared) {
    const ph = this.phase[Math.max(0, a)];
    const t = s.uTime.value;
    const knock = s.uKnock.value * Math.exp(-fract(t * s.uBeat.value) * 28);
    switch (a) {
      case 0: {
        // a shell lands every 1/N of the phase
        const n = FLOW.shells[0] + (FLOW.shells[1] - FLOW.shells[0]) * s.uKnock.value;
        return Math.exp(-fract(ph * n) * 5) * (0.7 + 0.3 * s.uKnock.value);
      }
      case 1:
        return 0.35 + 0.65 * Math.min(1, knock);
      case 2: {
        // a pulse per tooth, none for the two missing teeth
        const tooth = Math.floor(ph * FLOW.blips);
        return (tooth % 60) >= 58 ? 0 : Math.exp(-fract(ph * FLOW.blips) * 4);
      }
      case 3:
        return 0.3 + 0.1 * Math.sin(t * 0.9);
      case 4:
        return 0.15 + 0.75 * signals.throttle;
      case 5:
        // rich / lean switching
        return 0.5 + 0.5 * Math.max(-1, Math.min(1, signals.trace(5, signals.time) / 0.7));
      case 6: {
        // a pulse group is passing through the jaw (mid-path)
        const d = fract(0.5 - ph);
        return fract(d * FLOW.groups) < 0.45 ? 0.9 : 0.1;
      }
      default: {
        // packets landing on the port
        const d = fract(1 - this.phase[7]);
        return fract(d * 10) < 0.4 ? 0.8 : 0.15;
      }
    }
  }
}
