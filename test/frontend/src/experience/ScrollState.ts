import Lenis from 'lenis';
import { ScrollTrigger } from 'gsap/ScrollTrigger';

/**
 * Smooth scroll (Lenis) and where we are in the story. Shapes hold while a section's centre is
 * near the viewport centre and morph in between, with ease-in-out per section:
 *   sectionFloat = i + smoothstep(0.25, 0.75, raw)
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
  private centres: Float32Array;
  private ro: ResizeObserver;

  constructor(sections: HTMLElement[], reduced: boolean) {
    this.sections = sections;
    this.centres = new Float32Array(Math.max(1, sections.length));
    this.lenis = new Lenis({ autoRaf: false, lerp: reduced ? 1 : 0.085, smoothWheel: !reduced, wheelMultiplier: 0.9 });
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

  measure = () => {
    const vh = window.innerHeight;
    const y = window.scrollY;
    const maxCentre = Math.max(vh * 0.5, document.documentElement.scrollHeight - vh * 0.5);
    for (let i = 0; i < this.sections.length; i++) {
      const r = this.sections[i].getBoundingClientRect();
      this.centres[i] = Math.min(r.top + y + r.height * 0.5, maxCentre);
    }
    if (this.sections.length) this.centres[0] = Math.min(this.centres[0], vh * 0.5);
  };

  update() {
    const vh = window.innerHeight;
    const y = this.lenis.animatedScroll;
    const limit = this.lenis.limit;
    this.progress = limit > 0 ? y / limit : 0;
    const centre = y + vh * 0.5;
    const n = this.sections.length;
    let i = 0;
    while (i < n - 2 && centre >= this.centres[i + 1]) i++;
    const a = this.centres[i];
    const b = this.centres[Math.min(i + 1, n - 1)];
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
