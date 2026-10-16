import Lenis from 'lenis';
import { ScrollTrigger } from 'gsap/ScrollTrigger';

/** A gate sees every wheel/touch event before Lenis; 'consume' cancels it and Lenis ignores it. */
export type ScrollGate = (dx: number, dy: number, event: Event) => 'pass' | 'consume';

/**
 * Smooth scroll (Lenis) and where we are in the story. Each section has a hold range in
 * "viewport centre" coordinates: a point (its centre) for ordinary sections, or the whole pinned
 * span for sticky sections marked `data-pin` (the Sensor Array). Shapes hold inside a range and
 * morph across the gap to the next one, with ease-in-out per section:
 *   sectionFloat = i + smoothstep(0.25, 0.75, raw)
 * Inside a pinned range, `local(i)` gives 0..1 progress through it.
 */
export class ScrollState {
  readonly lenis: Lenis;
  /** 0..1 over the whole page. */
  progress = 0;
  /** Section index plus eased progress to the next one. */
  sectionFloat = 0;
  secA = 0;
  secB = 0;
  morph = 0;
  /** Raw (un-eased) progress between the two section centres, for the composite transition. */
  raw = 0;

  private sections: HTMLElement[];
  private a0: Float32Array;
  private a1: Float32Array;
  private pinned: Uint8Array;
  private centre = 0;
  private ro: ResizeObserver;
  private readonly gates: ScrollGate[] = [];
  /** Viewport height for layout, updated only when the width changes (iOS toolbars don't count). */
  private vh = window.innerHeight;
  private vw = window.innerWidth;

  constructor(sections: HTMLElement[], reduced: boolean) {
    this.sections = sections;
    const n = Math.max(1, sections.length);
    this.a0 = new Float32Array(n);
    this.a1 = new Float32Array(n);
    this.pinned = new Uint8Array(n);
    // touch scrolls through Lenis on phones and tablets: native momentum can't be cancelled on iOS
    // and would carry the page straight through a stepped section
    const coarse = matchMedia('(pointer: coarse)').matches;
    this.lenis = new Lenis({
      autoRaf: false,
      lerp: reduced ? 1 : 0.085,
      smoothWheel: !reduced,
      wheelMultiplier: 0.9,
      syncTouch: coarse,
      virtualScroll: this.gate,
    });
    this.lenis.on('scroll', ScrollTrigger.update);
    this.lenis.stop();
    this.ro = new ResizeObserver(this.measure);
    this.ro.observe(document.body);
    this.measure();
  }

  setReduced(reduced: boolean) {
    this.lenis.options.lerp = reduced ? 1 : 0.085;
    this.lenis.options.smoothWheel = !reduced;
  }

  /** Stepped sections register here (see StepSection). */
  addGate(g: ScrollGate) {
    this.gates.push(g);
  }

  removeGate(g: ScrollGate) {
    const i = this.gates.indexOf(g);
    if (i >= 0) this.gates.splice(i, 1);
  }

  private gate = ({ deltaX, deltaY, event }: { deltaX: number; deltaY: number; event: WheelEvent | TouchEvent }) => {
    if (this.lenis.isStopped || event.ctrlKey) return true;
    const path = event.composedPath();
    for (const n of path) if (n instanceof HTMLElement && n.hasAttribute('data-lenis-prevent')) return true;
    for (const g of this.gates) {
      if (g(deltaX, deltaY, event) === 'consume') {
        if (event.cancelable) event.preventDefault();
        return false;
      }
    }
    return true;
  };

  measure = () => {
    if (window.innerWidth !== this.vw) {
      this.vw = window.innerWidth;
      this.vh = window.innerHeight;
    }
    const vh = this.vh;
    const y = window.scrollY;
    const maxCentre = Math.max(vh * 0.5, document.documentElement.scrollHeight - vh * 0.5);
    for (let i = 0; i < this.sections.length; i++) {
      const el = this.sections[i];
      const r = el.getBoundingClientRect();
      const top = r.top + y;
      const pin = el.hasAttribute('data-pin');
      this.pinned[i] = pin ? 1 : 0;
      if (pin) {
        this.a0[i] = top + vh * 0.5;
        this.a1[i] = Math.max(this.a0[i], top + r.height - vh * 0.5);
      } else {
        this.a0[i] = this.a1[i] = Math.min(top + r.height * 0.5, maxCentre);
      }
    }
    if (this.sections.length) {
      this.a0[0] = Math.min(this.a0[0], vh * 0.5);
      this.a1[0] = Math.max(this.a0[0], Math.min(this.a1[0], this.pinned[0] ? this.a1[0] : vh * 0.5));
    }
  };

  /** 0..1 progress through section i's hold range (only meaningful for pinned sections). */
  local(i: number) {
    const a = this.a0[i];
    const b = this.a1[i];
    if (b <= a) return this.centre >= b ? 1 : 0;
    const t = (this.centre - a) / (b - a);
    return t < 0 ? 0 : t > 1 ? 1 : t;
  }

  /** True while the viewport centre is inside section i's hold range (pinned and on screen). */
  inHold(i: number) {
    return this.centre >= this.a0[i] - 1 && this.centre <= this.a1[i] + 1;
  }

  /** Scroll position at fraction `t` (0..1) of pinned section i. */
  scrollForLocal(i: number, t: number) {
    const vh = this.vh;
    return this.a0[i] + (this.a1[i] - this.a0[i]) * t - vh * 0.5;
  }

  update() {
    const vh = this.vh;
    const y = this.lenis.animatedScroll;
    const limit = this.lenis.limit;
    this.progress = limit > 0 ? y / limit : 0;
    const centre = (this.centre = y + vh * 0.5);
    const n = this.sections.length;
    let i = 0;
    while (i < n - 2 && centre >= this.a0[i + 1]) i++;
    const a = this.a1[i];
    const b = this.a0[Math.min(i + 1, n - 1)];
    let raw = b > a ? (centre - a) / (b - a) : 0;
    raw = raw < 0 ? 0 : raw > 1 ? 1 : raw;
    const t = raw < 0.25 ? 0 : raw > 0.75 ? 1 : (raw - 0.25) / 0.5;
    const eased = t * t * (3 - 2 * t);
    this.raw = raw;
    this.secA = i;
    this.secB = Math.min(i + 1, n - 1);
    this.morph = eased;
    this.sectionFloat = i + eased;
  }

  private disposed = false;

  dispose() {
    if (this.disposed) return;
    this.disposed = true;
    this.ro.disconnect();
    this.lenis.destroy();
  }
}
