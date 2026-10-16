import { CatmullRomCurve3, DataTexture, FloatType, NearestFilter, RGBAFormat, Vector3 } from 'three';
import type { SensorRig } from '../sensors/SensorRig';

export const PATH_SAMPLES = 128;
export const PATH_ROWS = 16;
/** Control points per row (every path is resampled from a 5-point Catmull-Rom). */
const CTRL = 5;

/**
 * Every signal path of the Sensor Array, baked into one float texture (128 samples x 16 rows,
 * RGBA = position + local scale) that the particle simulation reads:
 *  - rows 0-7, phenomenon -> sensor: from the part of the engine that makes what sensor i hears to
 *    its tip (acoustic and coolant from the block, vibration crawling along the crank's surface, the
 *    crank sensor from the 60-2 trigger wheel, the lambda plume sweeping past the tip and on); the
 *    throttle and the current clamp instead run straight through the bore and along the cable
 *  - rows 8-14, sensor -> OBD-II port: from the free end of each cable, around the crank, into
 *    the port's socket face; row 15 runs from the port up the frame (the bus)
 *
 * Paths live in rig space (the rig only ever translates, so the shader adds `offset`), which means a
 * row only changes when its endpoints move: the flying or showcased sensor, or the port. Rows are
 * compared against their last control points and resampled only then.
 */
export class FlowPaths {
  readonly data = new Float32Array(PATH_SAMPLES * PATH_ROWS * 4);
  readonly texture: DataTexture;
  /** The rig's translation, added in the shader. */
  readonly offset = new Vector3();
  private readonly curves: CatmullRomCurve3[] = [];
  private readonly last: Float32Array = new Float32Array(PATH_ROWS * CTRL * 3 + PATH_ROWS).fill(NaN);
  private readonly pts: Vector3[] = [];
  private readonly v = new Vector3();
  private readonly n = new Vector3();
  private readonly tip = new Vector3();
  private readonly port = new Vector3();
  /** Rows rebuilt in the last update (for the debug numbers). */
  rebuilt = 0;

  constructor() {
    this.texture = new DataTexture(this.data, PATH_SAMPLES, PATH_ROWS, RGBAFormat, FloatType);
    this.texture.minFilter = this.texture.magFilter = NearestFilter;
    this.texture.generateMipmaps = false;
    for (let r = 0; r < PATH_ROWS; r++) {
      const p: Vector3[] = [];
      for (let k = 0; k < CTRL; k++) p.push(new Vector3());
      this.curves.push(new CatmullRomCurve3(p, false, 'centripetal'));
    }
    for (let k = 0; k < CTRL; k++) this.pts.push(new Vector3());
  }

  /** A builder-space point of sensor i, in rig space. */
  private local(rig: SensorRig, i: number, p: Vector3, out: Vector3) {
    return rig.sensors[i].inner.localToWorld(out.copy(p)).sub(rig.group.position);
  }

  /** Control points of row r into this.pts; returns the row's local scale. */
  private control(rig: SensorRig, r: number): number {
    const P = this.pts;
    if (r >= 8) return this.dataRow(rig, r - 8);
    const s = rig.sensors[r];
    const scale = s.outer.scale.x;
    if (s.through) {
      // straight through the part: the throttle bore, the cable through the clamp's jaw
      const th = s.through;
      for (let k = 0; k < CTRL; k++) this.local(rig, r, th[Math.min(th.length - 1, Math.round((k / (CTRL - 1)) * (th.length - 1)))], P[k]);
      if (th.length === 3) {
        // three anchors: put the extra controls halfway along each half
        P[1].lerpVectors(P[0], P[2], 0.5);
        P[3].lerpVectors(P[2], P[4], 0.5);
      }
      return scale;
    }
    this.local(rig, r, s.tip, this.tip);
    // the flow leaves the engine on the side facing the sensor (wherever it is: on its mount or in
    // the showcase), at the sensor's height
    this.n.set(this.tip.x, 0, this.tip.z);
    if (this.n.lengthSq() < 1e-6) this.n.set(s.rest.x, 0, s.rest.z);
    this.n.normalize();
    const y = this.tip.y;
    const n = this.n;
    const side = (a: number, rad: number, h: number, out: Vector3) => out.set((n.x * Math.cos(a) - n.z * Math.sin(a)) * rad, h, (n.z * Math.cos(a) + n.x * Math.sin(a)) * rad);
    switch (r) {
      case 1: // vibration: crawls up the crank's surface from a journal below, then out to the tip
        side(-0.35, 0.64, y - 1.5, P[0]);
        side(-0.15, 0.67, y - 0.85, P[1]);
        side(0, 0.7, y - 0.2, P[2]);
        P[3].lerpVectors(P[2], this.tip, 0.55);
        P[4].copy(this.tip);
        break;
      case 2: // crank position: from the 60-2 wheel's teeth into the tip
        side(0, rig.dims.triggerR, rig.dims.triggerY, P[0]);
        side(0.05, rig.dims.triggerR + 0.25, rig.dims.triggerY + 0.04, P[1]);
        P[2].lerpVectors(P[1], this.tip, 0.4);
        P[3].lerpVectors(P[1], this.tip, 0.75);
        P[4].copy(this.tip);
        break;
      case 3: // coolant: drifts off the block, a little above the mount
        side(0.2, 0.5, y + 0.45, P[0]);
        side(0.1, 0.8, y + 0.4, P[1]);
        P[2].lerpVectors(P[1], this.tip, 0.4).y += 0.25;
        P[3].lerpVectors(P[1], this.tip, 0.75).y += 0.1;
        P[4].copy(this.tip);
        break;
      case 5: {
        // lambda: an exhaust plume from low on the block, past the tip and on beyond it
        side(-0.5, 0.75, y - 1.3, P[0]);
        side(-0.25, 0.95, y - 0.6, P[1]);
        P[2].copy(this.tip);
        this.v.subVectors(this.tip, P[1]).normalize();
        P[3].copy(this.tip).addScaledVector(this.v, 0.7);
        P[4].copy(this.tip).addScaledVector(this.v, 1.5).y += 0.35;
        break;
      }
      default: // acoustic (and the unused CAN row): from the block at the mount's height into the tip
        side(0, 0.62, y + 0.1, P[0]);
        side(0.08, 0.9, y + 0.3, P[1]);
        P[2].lerpVectors(P[1], this.tip, 0.4).y += 0.2;
        P[3].lerpVectors(P[1], this.tip, 0.75).y += 0.06;
        P[4].copy(this.tip);
    }
    return scale;
  }

  /** Data rows: cable end -> around the crank -> the port (row 15: the port -> up the bus). */
  private dataRow(rig: SensorRig, i: number): number {
    const P = this.pts;
    const portSensor = rig.sensors[7];
    this.local(rig, 7, portSensor.tip, this.port);
    if (i === 7) {
      P[0].copy(this.port);
      this.local(rig, 7, portSensor.cableEnd, P[1]);
      P[2].set(P[1].x * 0.6, P[1].y + 1.2, P[1].z * 0.6);
      P[3].set(0.2, rig.dims.top + 0.4, 0.2);
      P[4].set(0, rig.dims.top + 2.6, 0);
      return 1;
    }
    const s = rig.sensors[i];
    this.local(rig, i, s.cableEnd, P[0]);
    // a harness: in toward the crank, down (or up) to the port's height, then into the socket
    this.n.set(P[0].x, 0, P[0].z);
    const r0 = this.n.length() || 1;
    this.n.multiplyScalar(1 / r0);
    P[1].set(this.n.x * Math.min(r0, 1.35), P[0].y + 0.15, this.n.z * Math.min(r0, 1.35));
    this.v.set(this.port.x, 0, this.port.z).normalize();
    P[3].set(this.v.x * 1.3, this.port.y + 0.35, this.v.z * 1.3);
    P[2].lerpVectors(P[1], P[3], 0.5);
    // keep the middle of the harness off the crank's axis
    const rr = Math.hypot(P[2].x, P[2].z);
    if (rr < 1.2) {
      this.n.set(P[1].x + P[3].x, 0, P[1].z + P[3].z);
      if (this.n.lengthSq() < 1e-6) this.n.set(1, 0, 0);
      this.n.normalize().multiplyScalar(1.2);
      P[2].x = this.n.x;
      P[2].z = this.n.z;
    }
    P[4].copy(this.port);
    return 1;
  }

  update(rig: SensorRig) {
    rig.group.updateMatrixWorld(true);
    this.offset.copy(rig.group.position);
    this.rebuilt = 0;
    for (let r = 0; r < PATH_ROWS; r++) {
      const scale = this.control(rig, r);
      // unchanged control points: keep the row
      let same = Math.abs(this.last[PATH_ROWS * CTRL * 3 + r] - scale) < 1e-4;
      const o = r * CTRL * 3;
      for (let k = 0; k < CTRL && same; k++) {
        const p = this.pts[k];
        same = Math.abs(this.last[o + k * 3] - p.x) < 1e-4 && Math.abs(this.last[o + k * 3 + 1] - p.y) < 1e-4 && Math.abs(this.last[o + k * 3 + 2] - p.z) < 1e-4;
      }
      if (same) continue;
      const curve = this.curves[r];
      for (let k = 0; k < CTRL; k++) {
        const p = this.pts[k];
        curve.points[k].copy(p);
        this.last[o + k * 3] = p.x;
        this.last[o + k * 3 + 1] = p.y;
        this.last[o + k * 3 + 2] = p.z;
      }
      this.last[PATH_ROWS * CTRL * 3 + r] = scale;
      const row = r * PATH_SAMPLES * 4;
      for (let k = 0; k < PATH_SAMPLES; k++) {
        curve.getPoint(k / (PATH_SAMPLES - 1), this.v);
        const i = row + k * 4;
        this.data[i] = this.v.x;
        this.data[i + 1] = this.v.y;
        this.data[i + 2] = this.v.z;
        this.data[i + 3] = scale;
      }
      this.rebuilt++;
    }
    if (this.rebuilt) this.texture.needsUpdate = true;
  }

  dispose() {
    this.texture.dispose();
  }
}
