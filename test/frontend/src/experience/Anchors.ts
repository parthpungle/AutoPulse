import { Vector3 } from 'three';
import type { Camera } from 'three';

export interface Anchor {
  el: HTMLElement;
  section: number;
  /** World position at z = 0, refreshed on resize. */
  world: Vector3;
  resolve: (out: Vector3) => Vector3;
  x: number;
  y: number;
  o: number;
}

/**
 * Pins DOM labels to points on the particle shapes. Only writes styles when a value changes, and
 * only for labels whose section is near.
 */
export class Anchors {
  private items: Anchor[] = [];
  private readonly v = new Vector3();

  add(el: HTMLElement, section: number, resolve: (out: Vector3) => Vector3) {
    const a: Anchor = { el, section, world: new Vector3(), resolve, x: -1e4, y: -1e4, o: -1 };
    resolve(a.world);
    this.items.push(a);
  }

  clear() {
    this.items.length = 0;
  }

  refresh() {
    for (const a of this.items) a.resolve(a.world);
  }

  update(camera: Camera, width: number, height: number, sectionFloat: number) {
    for (let i = 0; i < this.items.length; i++) {
      const a = this.items[i];
      const d = Math.abs(sectionFloat - a.section);
      const o = d > 0.5 ? 0 : 1 - d / 0.5;
      const oq = Math.round(o * 50) / 50;
      if (oq !== a.o) {
        a.o = oq;
        a.el.style.opacity = String(oq);
        a.el.style.visibility = oq > 0 ? 'visible' : 'hidden';
      }
      if (oq === 0) continue;
      this.v.copy(a.world).project(camera);
      const x = (this.v.x * 0.5 + 0.5) * width;
      const y = (-this.v.y * 0.5 + 0.5) * height;
      if (Math.abs(x - a.x) > 0.5 || Math.abs(y - a.y) > 0.5) {
        a.x = x;
        a.y = y;
        a.el.style.transform = `translate3d(${x.toFixed(1)}px, ${y.toFixed(1)}px, 0)`;
      }
    }
  }
}
