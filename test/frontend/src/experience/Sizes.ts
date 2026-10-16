/**
 * Canvas size and device pixel ratio. The canvas is 100lvh tall (CSS), so a mobile URL bar
 * collapsing never resizes the render targets.
 */
export class Sizes {
  width = 1;
  height = 1;
  dpr = 1;
  private maxDpr: number;
  private dprQuery: MediaQueryList | null = null;
  private readonly onChange: () => void;
  private readonly el: HTMLElement;

  constructor(el: HTMLElement, maxDpr: number, onChange: () => void) {
    this.el = el;
    this.maxDpr = maxDpr;
    this.onChange = onChange;
    this.measure();
    window.addEventListener('resize', this.handle);
    this.watchDpr();
  }

  setMaxDpr(v: number) {
    this.maxDpr = v;
    this.handle();
  }

  private measure() {
    this.width = Math.max(1, this.el.clientWidth || window.innerWidth);
    this.height = Math.max(1, this.el.clientHeight || window.innerHeight);
    this.dpr = Math.min(window.devicePixelRatio || 1, this.maxDpr);
  }

  private watchDpr() {
    this.dprQuery?.removeEventListener('change', this.onDpr);
    this.dprQuery = matchMedia(`(resolution: ${window.devicePixelRatio}dppx)`);
    this.dprQuery.addEventListener('change', this.onDpr);
  }

  private onDpr = () => {
    this.watchDpr();
    this.handle();
  };

  private handle = () => {
    const w = this.width;
    const h = this.height;
    const d = this.dpr;
    this.measure();
    if (w !== this.width || h !== this.height || d !== this.dpr) this.onChange();
  };

  dispose() {
    window.removeEventListener('resize', this.handle);
    this.dprQuery?.removeEventListener('change', this.onDpr);
  }
}
