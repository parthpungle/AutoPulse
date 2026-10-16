import { CatmullRomCurve3, DataTexture, FloatType, NearestFilter, RGBAFormat, Vector3 } from 'three';
import type { SensorRig } from '../sensors/SensorRig';

const SAMPLES = 64;
const STREAMS = 8;

/**
 * The eight signal streams of the Sensor Array: each starts at a sensor's tip, bows into the
 * crankshaft at that sensor's height, then spirals up the spine and out of the top. The paths are
 * sampled into a 64 x 8 float texture (one row per sensor) that the particle simulation reads.
 * Rebuilt in place every frame while the section is near, because the sensors move (focus drift,
 * the rig rising and sinking). No allocations.
 */
export class StreamCurves {
  readonly data = new Float32Array(SAMPLES * STREAMS * 4);
  readonly texture: DataTexture;
  private readonly curves: CatmullRomCurve3[] = [];
  private readonly tmp = new Vector3();

  constructor() {
    this.texture = new DataTexture(this.data, SAMPLES, STREAMS, RGBAFormat, FloatType);
    this.texture.minFilter = this.texture.magFilter = NearestFilter;
    this.texture.generateMipmaps = false;
    this.texture.needsUpdate = true;
    for (let i = 0; i < STREAMS; i++) {
      const pts: Vector3[] = [];
      for (let k = 0; k < 7; k++) pts.push(new Vector3());
      this.curves.push(new CatmullRomCurve3(pts, false, 'centripetal'));
    }
  }

  update(rig: SensorRig) {
    rig.group.updateMatrixWorld(true);
    const top = rig.dims.top + rig.group.position.y + 0.9;
    for (let i = 0; i < STREAMS; i++) {
      const p = this.curves[i].points;
      const tip = rig.tipWorld(i, p[0]);
      const y0 = tip.y;
      const len = Math.hypot(tip.x, tip.z) || 1;
      const dx = tip.x / len;
      const dz = tip.z / len;
      const span = top - y0;
      // bow in toward the crank, touch it, then wind a quarter turn per step up the spine
      p[1].set(tip.x * 0.62, y0 + 0.18, tip.z * 0.62);
      p[2].set(dx * 0.95, y0 + 0.08, dz * 0.95);
      p[3].set(-dz * 0.85, y0 + span * 0.3, dx * 0.85);
      p[4].set(-dx * 0.75, y0 + span * 0.55, -dz * 0.75);
      p[5].set(dz * 0.6, y0 + span * 0.8, -dx * 0.6);
      p[6].set(0.12 * Math.cos(i), top, 0.12 * Math.sin(i));
      const row = i * SAMPLES * 4;
      for (let k = 0; k < SAMPLES; k++) {
        this.curves[i].getPoint(k / (SAMPLES - 1), this.tmp);
        const o = row + k * 4;
        this.data[o] = this.tmp.x;
        this.data[o + 1] = this.tmp.y;
        this.data[o + 2] = this.tmp.z;
        this.data[o + 3] = 1;
      }
    }
    this.texture.needsUpdate = true;
  }

  dispose() {
    this.texture.dispose();
  }
}
