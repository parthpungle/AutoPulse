import { gsap } from 'gsap';

const INTERACTIVE = 'a, button, [data-cursor]';

/** Small ring that trails the pointer and grows over links and buttons. Mouse/pen only. */
export class Cursor {
  private readonly el: HTMLDivElement | null = null;
  private x = -100;
  private y = -100;
  private tx = -100;
  private ty = -100;
  private s = 1;
  private ts = 1;
  private last = '';

  constructor() {
    if (!matchMedia('(hover: hover) and (pointer: fine)').matches) return;
    const el = document.createElement('div');
    el.className = 'tt-cursor';
    el.setAttribute('aria-hidden', 'true');
    document.body.appendChild(el);
    this.el = el;
    document.documentElement.classList.add('has-cursor');
    window.addEventListener('pointermove', this.onMove, { passive: true });
    document.addEventListener('pointerover', this.onOver, { passive: true });
    document.documentElement.addEventListener('pointerleave', this.onLeave);
    gsap.ticker.add(this.tick);
  }

  private onMove = (e: PointerEvent) => {
    if (e.pointerType === 'touch') return;
    this.tx = e.clientX;
    this.ty = e.clientY;
    if (this.x < -50) {
      this.x = this.tx;
      this.y = this.ty;
    }
    this.el?.classList.add('is-visible');
  };

  private onOver = (e: PointerEvent) => {
    const hit = (e.target as Element | null)?.closest?.(INTERACTIVE);
    this.ts = hit ? 1.9 : 1;
    this.el?.classList.toggle('is-active', !!hit);
  };

  private onLeave = () => this.el?.classList.remove('is-visible');

  private tick = () => {
    if (!this.el) return;
    // at rest: no string building, no style writes
    if (Math.abs(this.tx - this.x) < 0.05 && Math.abs(this.ty - this.y) < 0.05 && Math.abs(this.ts - this.s) < 0.001) return;
    this.x += (this.tx - this.x) * 0.22;
    this.y += (this.ty - this.y) * 0.22;
    this.s += (this.ts - this.s) * 0.18;
    const t = `translate3d(${this.x.toFixed(1)}px, ${this.y.toFixed(1)}px, 0) scale(${this.s.toFixed(3)})`;
    if (t !== this.last) {
      this.last = t;
      this.el.style.transform = t;
    }
  };

  dispose() {
    gsap.ticker.remove(this.tick);
    window.removeEventListener('pointermove', this.onMove);
    document.removeEventListener('pointerover', this.onOver);
    document.documentElement.removeEventListener('pointerleave', this.onLeave);
    document.documentElement.classList.remove('has-cursor');
    this.el?.remove();
  }
}
