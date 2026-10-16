import { Vector2, Vector3, Vector4 } from 'three';
import { CLUSTERS } from './sim/Targets';

/**
 * Where each section's shape sits, in world units at z = 0. The shader (shapes.glsl) reads these
 * uniforms and the DOM labels are pinned to the same points, so there is one source of truth.
 * Landscape layouts push sections 1-3 right of the copy; portrait keeps them centred and high.
 */
export class Layout {
  readonly view = new Vector2(1, 1);
  wide = 1;
  readonly L0 = new Vector4();
  readonly L2 = new Vector4();
  readonly L3 = new Vector4();
  readonly L4 = new Vector4();
  readonly clusterC = CLUSTERS.map((c) => new Vector2(c.c[0], c.c[1]));

  update(viewW: number, viewH: number) {
    const w = viewW;
    const h = viewH;
    const wide = w / h > 1.05 ? 1 : 0;
    const u = Math.min(h, w * 0.9);
    const m = Math.min(w, h);
    this.view.set(w, h);
    this.wide = wide;
    this.L0.set(0.62 * w, 0.17 * u, 0.022 * u, wide ? 0.06 * h : 0.12 * h);
    if (wide) {
      this.L2.set(0.26 * w, 0.44 * w, 0.42 * h, -0.24 * h);
      this.L3.set(0.2 * w, 0, 0.25 * w, 0.36 * h);
      this.L4.set(0, 0, 0.31 * m, 0.022 * m);
    } else {
      // portrait: every shape lives in the top third, above the copy
      this.L2.set(0, 0.9 * w, 0.16 * h, 0.25 * h);
      this.L3.set(0, 0.28 * h, 0.42 * w, 0.13 * h);
      this.L4.set(0, 0.25 * h, 0.26 * m, 0.022 * m);
    }
  }

  /** Just above cluster `index`, where its label sits. */
  clusterAnchor(index: number, out: Vector3) {
    const c = this.clusterC[index];
    const L = this.L3;
    return out.set(L.x + c.x * L.z, L.y + (c.y + 0.36) * L.w, 0);
  }
}
