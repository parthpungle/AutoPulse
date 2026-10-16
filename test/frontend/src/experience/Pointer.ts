/**
 * Pointer in normalised screen space (0..1, y up) plus a smoothed velocity. Mouse uses pointer
 * events; touch uses touchmove, which keeps firing during native scroll, so a finger stirs the
 * fluid while it scrolls. After a few idle seconds a faint "ghost" pointer drifts on a Lissajous
 * path so the field never goes still.
 */
export class Pointer {
  /** Fluid splat for this frame (consumed by the engine). */
  splatX = 0.5;
  splatY = 0.5;
  splatDX = 0;
  splatDY = 0;
  splatStrength = 0;

  /** Smoothed -1..1 position for camera parallax. */
  nx = 0;
  ny = 0;
  /** Smoothed speed in screen heights per second. */
  speed = 0;

  ghost = true;

  /** Raw pointer position, 0..1 (y up). */
  x = 0.5;
  y = 0.5;
  private px = 0.5;
  private py = 0.5;
  private gx = 0.5;
  private gy = 0.5;
  private ghostMix = 0;
  private lastMove = -1e9;
  private fresh = true;
  private aspect = 1;

  constructor() {
    window.addEventListener('pointermove', this.onPointer, { passive: true });
    window.addEventListener('touchstart', this.onTouchStart, { passive: true });
    window.addEventListener('touchmove', this.onTouch, { passive: true });
  }

  setAspect(a: number) {
    this.aspect = a;
  }

  private set(clientX: number, clientY: number) {
    this.x = clientX / window.innerWidth;
    this.y = 1 - clientY / window.innerHeight;
    if (this.fresh) {
      this.px = this.x;
      this.py = this.y;
      this.fresh = false;
    }
    this.lastMove = performance.now();
  }

  private onPointer = (e: PointerEvent) => {
    if (e.pointerType === 'touch') return;
    this.set(e.clientX, e.clientY);
  };

  private onTouchStart = (e: TouchEvent) => {
    const t = e.touches[0];
    if (!t) return;
    this.fresh = true;
    this.set(t.clientX, t.clientY);
  };

  private onTouch = (e: TouchEvent) => {
    const t = e.touches[0];
    if (t) this.set(t.clientX, t.clientY);
  };

  update(dt: number, time: number) {
    const dx = this.x - this.px;
    const dy = this.y - this.py;
    this.px = this.x;
    this.py = this.y;

    const idle = performance.now() - this.lastMove > 3000;
    this.ghostMix += ((idle && this.ghost ? 1 : 0) - this.ghostMix) * Math.min(1, dt * 0.8);

    if (dx !== 0 || dy !== 0) {
      this.splatX = this.x;
      this.splatY = this.y;
      this.splatDX = dx;
      this.splatDY = dy;
      this.splatStrength = 1;
    } else if (this.ghostMix > 0.01) {
      const gx = 0.5 + 0.32 * Math.sin(time * 0.29) * Math.cos(time * 0.11);
      const gy = 0.5 + 0.26 * Math.sin(time * 0.41 + 1.3);
      this.splatX = gx;
      this.splatY = gy;
      this.splatDX = gx - this.gx;
      this.splatDY = gy - this.gy;
      this.splatStrength = 0.45 * this.ghostMix;
      this.gx = gx;
      this.gy = gy;
    } else {
      this.splatStrength = 0;
    }
    if (this.ghostMix <= 0.01) {
      this.gx = this.x;
      this.gy = this.y;
    }

    const inst = dt > 0 ? Math.hypot(dx * this.aspect, dy) / dt : 0;
    this.speed += (inst - this.speed) * Math.min(1, dt * 6);
    const k = Math.min(1, dt * 2.5);
    this.nx += ((this.x * 2 - 1) - this.nx) * k;
    this.ny += ((this.y * 2 - 1) - this.ny) * k;
  }

  dispose() {
    window.removeEventListener('pointermove', this.onPointer);
    window.removeEventListener('touchstart', this.onTouchStart);
    window.removeEventListener('touchmove', this.onTouch);
  }
}
