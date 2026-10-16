import Lenis from 'lenis';
import { ScrollTrigger } from 'gsap/ScrollTrigger';

/** A gate sees every wheel/touch event before Lenis; 'consume' cancels it and Lenis ignores it. */
export type ScrollGate = (dx: number, dy: number, event: Event) => 'pass' | 'consume';

/**
 * How long each section holds the screen (vh of scroll) before the cut to the next one. The
 * Sensor Array holds for its 8 cards, 35vh apart (StepSection); the last section holds to the end.
 */
export const HOLD_VH = [60, 7 * 35, 60, 80, 40];
/** Scroll length of each cut between two sections (vh). */
export const CUT_VH = 70;

/**
 * Smooth scroll (Lenis) and where we are in the story. The page is a timeline: each section holds
 * the screen for its hold length, then a 70vh cut hands over to the next one (the seam sweeps up
 * the screen, see seam/Seam.ts). Section panels are fixed layers; the `[data-section]` elements
 * are only scroll spacers, sized here from the timeline (hold + cut, the last one hold + 100vh).
 *   current: the section that holds (or the outgoing one during a cut)
 *   boundary: during a cut, its outgoing section (-1 otherwise); t: 0..1 through the cut
 *   sectionFloat = current + t, secA/secB/morph: the same, for the shapes that still morph
 * Inside a hold, `local(i)` gives 0..1 progress through it.
 */
export class ScrollState {
  readonly lenis: Lenis;
  /** 0..1 over the whole page. */
  progress = 0;
  sectionFloat = 0;
  secA = 0;
  secB = 0;
  morph = 0;
  current = 0;
  boundary = -1;
  /** 0..1 through the current cut. */
  t = 0;

  private sections: HTMLElement[];
  /** Hold start and length per section, and the cut length (scroll px). */
  private holdStart: Float32Array;
  private holdLen: Float32Array;
  private cut = 0;
  private y = 0;
  private ro: ResizeObserver;
  private readonly gates: ScrollGate[] = [];
  /** Viewport height for layout, updated only when the width changes (iOS toolbars don't count). */
  private vh = window.innerHeight;
  private vw = window.innerWidth;

  constructor(sections: HTMLElement[], reduced: boolean) {
    this.sections = sections;
    const n = Math.max(1, sections.length);
    this.holdStart = new Float32Array(n);
    this.holdLen = new Float32Array(n);
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

  /** Lay out the timeline and size the spacers (only when the width changes, or on a resize). */
  measure = () => {
    if (window.innerWidth !== this.vw) {
      this.vw = window.innerWidth;
      this.vh = window.innerHeight;
    }
    const vh = this.vh / 100;
    const n = this.sections.length;
    this.cut = CUT_VH * vh;
    let y = 0;
    for (let i = 0; i < n; i++) {
      const hold = (HOLD_VH[i] ?? 60) * vh;
      this.holdStart[i] = y;
      this.holdLen[i] = hold;
      const h = i < n - 1 ? hold + this.cut : hold + this.vh;
      const px = `${Math.round(h)}px`;
      if (this.sections[i].style.height !== px) this.sections[i].style.height = px;
      y += hold + this.cut;
    }
  };

  /** Scroll position where section i starts holding the screen. */
  holdStartOf(i: number) {
    return this.holdStart[i];
  }

  /** 0..1 progress through section i's hold. */
  local(i: number) {
    const len = this.holdLen[i];
    if (len <= 0) return this.y >= this.holdStart[i] ? 1 : 0;
    const t = (this.y - this.holdStart[i]) / len;
    return t < 0 ? 0 : t > 1 ? 1 : t;
  }

  /** True while section i holds the screen. */
  inHold(i: number) {
    return this.y >= this.holdStart[i] - 1 && this.y <= this.holdStart[i] + this.holdLen[i] + 1;
  }

  /** Scroll position at fraction `t` (0..1) of section i's hold. */
  scrollForLocal(i: number, t: number) {
    return this.holdStart[i] + this.holdLen[i] * t;
  }

  update() {
    const y = (this.y = this.lenis.animatedScroll);
    const limit = this.lenis.limit;
    this.progress = limit > 0 ? y / limit : 0;
    const n = this.sections.length;
    let i = 0;
    while (i < n - 1 && y >= this.holdStart[i + 1]) i++;
    const holdEnd = this.holdStart[i] + this.holdLen[i];
    let t = 0;
    if (i < n - 1 && y > holdEnd) t = Math.min(1, (y - holdEnd) / this.cut);
    this.current = i;
    this.boundary = t > 0 ? i : -1;
    this.t = t;
    this.secA = i;
    this.secB = Math.min(i + 1, n - 1);
    this.morph = t * t * (3 - 2 * t);
    this.sectionFloat = i + this.morph;
  }

  private disposed = false;

  dispose() {
    if (this.disposed) return;
    this.disposed = true;
    this.ro.disconnect();
    this.lenis.destroy();
  }
}
