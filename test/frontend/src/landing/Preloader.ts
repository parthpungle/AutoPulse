import { gsap } from 'gsap';
import { SplitText } from 'gsap/SplitText';

gsap.registerPlugin(SplitText);

const MIN_MS = 1100;

/**
 * Drives the static preloader in index.html. The counter follows real progress (fonts, GPU tier,
 * target generation, shader pre-warm, warm frames), eases toward it and never goes backwards.
 */
export class Preloader {
  readonly done: Promise<void>;
  private readonly el: HTMLElement | null;
  private readonly count: HTMLElement | null;
  private readonly bar: HTMLElement | null;
  private fonts = 0;
  private engine = 0;
  private shown = 0;
  private last = -1;
  private readonly start = performance.now();
  private resolve!: () => void;
  private finished = false;

  constructor() {
    this.el = document.getElementById('tt-preloader');
    this.count = document.getElementById('tt-pre-count');
    this.bar = document.getElementById('tt-pre-bar');
    this.done = new Promise((r) => (this.resolve = r));
    gsap.ticker.add(this.tick);
  }

  setFonts(v: number) {
    this.fonts = Math.max(this.fonts, v);
  }

  setEngine(v: number) {
    this.engine = Math.max(this.engine, v);
  }

  private tick = () => {
    const real = 0.15 * this.fonts + 0.85 * this.engine;
    const target = Math.min(real, (performance.now() - this.start) / MIN_MS);
    this.shown += (target - this.shown) * 0.14;
    if (target - this.shown < 0.003) this.shown = target;
    const n = Math.floor(this.shown * 100 + 1e-6);
    if (n !== this.last) {
      this.last = n;
      if (this.count) this.count.textContent = String(n).padStart(3, '0');
      if (this.bar) this.bar.style.transform = `scaleX(${this.shown.toFixed(3)})`;
    }
    if (!this.finished && real >= 1 && this.shown >= 1) {
      this.finished = true;
      gsap.ticker.remove(this.tick);
      this.resolve();
    }
  };

  /** Wordmark characters slide out, then the overlay goes; the shader wipe takes over. */
  async exit(reduced: boolean) {
    const el = this.el;
    if (!el) return;
    const mark = el.querySelector<HTMLElement>('.tt-pre__mark');
    const foot = el.querySelector<HTMLElement>('.tt-pre__foot');
    const bar = el.querySelector<HTMLElement>('.tt-pre__bar');
    if (reduced || !mark) {
      await gsap.to(el, { opacity: 0, duration: 0.4 });
    } else {
      const split = SplitText.create(mark, { type: 'chars', mask: 'chars' });
      const tl = gsap.timeline();
      tl.to(split.chars, { yPercent: -110, duration: 0.5, ease: 'expo.in', stagger: 0.022 }, 0);
      tl.to([foot, bar], { opacity: 0, duration: 0.3, ease: 'power1.out' }, 0.1);
      await tl;
    }
    el.remove();
  }

  dispose() {
    gsap.ticker.remove(this.tick);
  }
}
