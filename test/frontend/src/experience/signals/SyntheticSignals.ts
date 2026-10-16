import type { Shared } from '../Uniforms';

const TAU = Math.PI * 2;

/** Small deterministic noise in 0..1 (no allocations). */
function hash(n: number) {
  const s = Math.sin(n * 127.1 + 311.7) * 43758.5453;
  return s - Math.floor(s);
}

/** Smooth value noise in -1..1. */
function vnoise(t: number) {
  const i = Math.floor(t);
  const f = t - i;
  const u = f * f * (3 - 2 * f);
  return (hash(i) * (1 - u) + hash(i + 1) * u) * 2 - 1;
}

/**
 * Per-sensor synthetic signals for the Sensor Array, driven by the engine state (the Recognition
 * toggles: uKnock, uMisfire, uValve, uTurb). Cards, particle streams, the 2-D mini traces and the
 * crankshaft's rotation all read from here. Cheap math, preallocated, no per-frame allocations.
 */
export class SyntheticSignals {
  /** Activity 0..1 per sensor, in SENSORS order. */
  readonly amp = new Float32Array(8);
  rpm = 820;
  /** Visual crank angle (radians) and angular speed (rad/s): slowed down so the eye can follow it. */
  crankAngle = 0;
  omega = 0;
  throttle = 0.12; // 0..1
  coolant = 86; // °C
  trimShort = 0; // %
  trimLong = 2; // %
  current = 0; // normalised
  time = 0;
  /** Firing events per second (4-stroke inline four: RPM / 60 x 2) and their running count. */
  fireRate = 26;
  firePhase = 0;

  private knock = 0;
  private misfire = 0;
  private valve = 0;
  private turb = 1;
  private beat = 1.6;

  update(dt: number, s: Shared, reduced: boolean) {
    const t = (this.time += dt);
    this.knock = s.uKnock.value;
    this.misfire = s.uMisfire.value;
    this.valve = s.uValve.value;
    this.turb = s.uTurb.value;
    this.beat = s.uBeat.value;

    // throttle: plateaus with smooth ramps and an occasional snap
    const seg = Math.floor(t / 3.2);
    const f = (t / 3.2) % 1;
    const a = 0.1 + 0.55 * hash(seg);
    const b = 0.1 + 0.55 * hash(seg + 1);
    const ramp = f < 0.8 ? 0 : (f - 0.8) / 0.2;
    this.throttle = a + (b - a) * ramp * ramp * (3 - 2 * ramp);

    this.rpm = 800 + this.throttle * 2600 + 40 * vnoise(t * 0.7) * this.turb;
    this.fireRate = (this.rpm / 60) * 2;
    this.firePhase += this.fireRate * dt;
    this.coolant = 86 + 3 * Math.sin(t * 0.05) + 0.4 * vnoise(t * 0.3);
    this.trimShort = 4 * Math.sin(t * 2.1) * (0.6 + 0.4 * vnoise(t)) + 6 * this.misfire * Math.sin(t * 0.9);
    this.trimLong = 2 + 3 * this.misfire;

    // crank: base speed from rpm, misfire stutters every 4th rev, knock jolts, valve wear jitters
    let w = 0.45 * Math.sqrt(this.rpm / 800);
    const rev = Math.floor(this.crankAngle / TAU);
    if (rev % 4 === 3) w *= 1 - 0.45 * this.misfire;
    const ph = (t * this.beat) % 1;
    w += this.knock * 2.4 * Math.exp(-ph * 30);
    w += this.valve * 0.35 * vnoise(t * 40);
    this.omega = w * (reduced ? 0.25 : 1);
    this.crankAngle += this.omega * dt;

    const pulse = Math.exp(-ph * 9);
    this.current = 0.5 + 0.5 * Math.sin(t * 9.0) * Math.sin(t * 0.7);

    const amp = this.amp;
    amp[0] = clamp01(0.45 + 0.25 * this.throttle + 0.4 * this.knock * pulse + 0.2 * this.valve);
    amp[1] = clamp01(0.4 + 0.2 * this.throttle + 0.45 * this.knock * pulse + 0.15 * this.misfire);
    amp[2] = clamp01(0.45 + 0.3 * (this.rpm - 800) / 2600 + 0.25 * this.misfire * (rev % 4 === 3 ? 1 : 0));
    amp[3] = clamp01(0.25 + (this.coolant - 80) / 40);
    amp[4] = clamp01(0.2 + 0.8 * this.throttle);
    amp[5] = clamp01(0.4 + 0.05 * Math.abs(this.trimShort) + 0.2 * this.misfire);
    amp[6] = clamp01(0.35 + 0.35 * this.current);
    amp[7] = 0.75;
  }

  /**
   * One sample of a sensor's trace at time `t` (seconds, at most a window behind `time`),
   * roughly -1..1, for the 2-D mini traces. Uses the latest engine-state values, so selecting
   * Knock changes the mic and vibration traces. Every trace keeps a steady periodic baseline
   * (at least ~35% of full scale) in the healthy states; faults change its shape on top.
   */
  trace(sensor: number, t: number): number {
    const k = this.knock;
    const m = this.misfire;
    const v = this.valve;
    // firing events at the current rate, counted back from now (no phase jumps as RPM moves)
    const fc = this.firePhase - (this.time - t) * this.fireRate;
    const fire = fc - Math.floor(fc);
    const cyl = ((Math.floor(fc) % 4) + 4) % 4;
    const dropped = m > 0.01 && cyl === 3 ? 1 - 0.85 * m : 1;
    switch (sensor) {
      case 0: {
        // mic: firing pulses plus broadband; knock rings right after firing, valve ticks at cam rate
        const hum = Math.sin(t * 2 * Math.PI * 60) * 0.25 + vnoise(t * 400) * 0.2;
        const fireHit = Math.exp(-fire * 14) * Math.sin(t * 2 * Math.PI * 180) * 0.6 * dropped;
        const ring = k * Math.exp(-fire * 30) * Math.sin(t * 2 * Math.PI * 900) * 0.9;
        const tick = v * Math.exp(-((t * 3) % 1) * 60) * 0.8;
        return hum + fireHit + ring + tick;
      }
      case 1: {
        // accelerometer: burst envelopes at every firing, knock adds a ringing resonance
        const env = Math.exp(-fire * 7) * dropped;
        return Math.sin(t * 2 * Math.PI * 140) * env * 0.8 + k * Math.exp(-fire * 22) * Math.sin(t * 2 * Math.PI * 700) * 0.9 + vnoise(t * 300) * 0.08;
      }
      case 2: {
        // crank position: 60-2 square pulses with a gap once per rev
        const tooth = (t * 60) % 60;
        if (tooth > 58) return -0.8;
        return (tooth % 1) < 0.5 ? 0.8 : -0.8;
      }
      case 3:
        // thermostat / fan cycling around the warm set point, plus the slow drift
        return 0.42 * Math.sin((t * 2 * Math.PI) / 9) + (this.coolant - 86) / 8 + 0.05 * vnoise(t * 2);
      case 4: {
        const seg = Math.floor(t / 1.6);
        const f = (t / 1.6) % 1;
        const a = hash(seg);
        const b = hash(seg + 1);
        const r = f < 0.75 ? 0 : (f - 0.75) / 0.25;
        return (a + (b - a) * r * r * (3 - 2 * r)) * 1.6 - 0.8;
      }
      case 5:
        // rich/lean switching around stoichiometric; misfire pushes it lean
        return Math.tanh(Math.sin(t * 2 * Math.PI * 1.2) * 4) * 0.7 - 0.3 * m;
      case 6: {
        // injector current: ramp, peak, hold plateau with a hump
        const p = (t * 4) % 1;
        if (p > 0.45) return -0.7;
        const ramp = Math.min(1, p / 0.08);
        const q = (p - 0.12) / 0.03;
        const hump = Math.exp(-q * q) * 0.35;
        return -0.7 + ramp * 1.1 + hump - (p > 0.15 ? 0.35 : 0);
      }
      default: {
        // CAN: packet bursts
        const slot = Math.floor(t * 40);
        return hash(slot) > 0.55 ? ((t * 400) % 1 < 0.5 ? 0.7 : -0.7) : -0.05;
      }
    }
  }
}

function clamp01(x: number) {
  return x < 0 ? 0 : x > 1 ? 1 : x;
}
