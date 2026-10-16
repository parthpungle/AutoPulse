import type { ScrollState } from '../ScrollState';

/**
 * One float, `value` (0..count-1), drives the whole Sensor Array: helix, camera, sensor focus,
 * streams and DOM. It follows the scroll position inside the pinned section. Every input (wheel,
 * trackpad, touch, index clicks, keys, swipes) goes through `goToCard(i)`, which scrolls the page
 * to that card's position, so scroll and carousel can never disagree. When the scroll comes to
 * rest between two cards it snaps to the nearest one.
 */
export class CarouselState {
  /** Smoothed carousel position (the shaders' uCarousel). */
  value = 0;
  /** Where the scroll says we should be. */
  target = 0;
  /** Nearest card index. */
  active = 0;
  /** True while the pinned section holds the viewport. */
  inSection = false;
  snapEnabled = true;

  private readonly scroll: ScrollState;
  private readonly section: number;
  private readonly count: number;
  private lastMove = 0;
  private snapUntil = 0;

  constructor(scroll: ScrollState, section: number, count: number) {
    this.scroll = scroll;
    this.section = section;
    this.count = count;
    scroll.lenis.on('scroll', this.onScroll);
  }

  private onScroll = () => {
    this.lastMove = performance.now();
  };

  update(dt: number) {
    const sc = this.scroll;
    this.target = sc.local(this.section) * (this.count - 1);
    this.inSection = sc.inHold(this.section);
    this.value += (this.target - this.value) * (1 - Math.exp(-dt * 10));
    if (Math.abs(this.target - this.value) < 1e-4) this.value = this.target;
    const a = Math.round(this.value);
    this.active = a < 0 ? 0 : a >= this.count ? this.count - 1 : a;

    // snap: once the scroll has been still for a moment between two cards, settle on the nearest
    const now = performance.now();
    if (this.snapEnabled && this.inSection && now > this.snapUntil && now - this.lastMove > 140 && !sc.lenis.isScrolling) {
      const nearest = Math.round(this.target);
      if (Math.abs(this.target - nearest) > 0.004) this.goToCard(nearest, 0.55);
    }
  }

  /** Scroll the page to card i (clamped). */
  goToCard(i: number, duration = 1.1) {
    const k = i < 0 ? 0 : i >= this.count ? this.count - 1 : i;
    const y = this.scroll.scrollForLocal(this.section, k / (this.count - 1));
    this.snapUntil = performance.now() + duration * 1000 + 80;
    this.scroll.lenis.scrollTo(y, { duration, easing: (t: number) => 1 - Math.pow(1 - t, 3) });
  }

  dispose() {
    this.scroll.lenis.off('scroll', this.onScroll);
  }
}
