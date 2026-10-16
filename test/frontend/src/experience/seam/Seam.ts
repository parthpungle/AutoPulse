/**
 * The "cut" between two sections: one straight seam, rising slightly to the right, that sweeps up
 * the screen as you scroll. Above it the outgoing section, below it the incoming one, both live;
 * no glow and no fade. Right above the seam a band of horizontal strips tears: some strips shift
 * sideways, break into blocks and split their colours, and now and then a strip of the incoming
 * section shows through. Fully reversible.
 *
 * Measured from the reference recording (a 1245 x 740 capture): the seam rises ~0.19 of the
 * screen height across its width (~7 degrees), the torn band is ~0.075 of the height, strips are
 * 4-13 px tall, letters break into ~6 px blocks.
 *
 * This is the single source of truth: the composite shader (strips as a uniform array) and the
 * DOM clip polygons are built from the same numbers, so GL and DOM always cut in the same place.
 * All lengths are CSS px, y pointing down, unless named UV.
 */
export const SEAM = {
  /** Rise across the full width, as a fraction of the screen height. */
  tilt: 0.19,
  /** Height of the torn band above the seam, as a fraction of the screen height. */
  band: 0.075,
  /** Strip height range, as a fraction of the screen height. */
  stripMin: 0.0055,
  stripMax: 0.018,
  /** Share of strips that shift at any moment. */
  density: 0.55,
  /** Largest sideways shift, as a fraction of the screen width (at the seam; less up the band). */
  shift: 0.035,
  /** RGB split, as a fraction of the screen width. */
  chroma: 0.004,
  /** Chance that a strip near the seam shows the incoming section instead. */
  bleed: 0.12,
  /** Block size of the mosaic in shifted strips, as a fraction of the screen width. */
  mosaic: 0.0055,
  /** How often the strip table changes (Hz). */
  rate: 24,
  /** Camera / panel drift during a transition, as a fraction of the view height. */
  drift: 0.12,
};

export const MAX_STRIPS = 16;

export class Seam {
  /** Progress 0..1: 0 = seam below the screen (all outgoing), 1 = above it (all incoming). */
  t = 0;
  /** Seam y at the left and right edges (CSS px from the top). */
  l = 0;
  r = 0;
  /** Screen size (CSS px). */
  w = 1;
  h = 1;
  /**
   * Strips, bottom (at the seam) to top: for each, x = top edge above the seam (px), y = sideways
   * shift (px), z = 1 when the incoming section bleeds through, w = RGB split (px).
   */
  readonly strips = new Float32Array(MAX_STRIPS * 4);
  count = 0;
  private clock = -1;
  private seed = 1;

  /** Seam position for progress t. The margin makes t = 0 and t = 1 fully clean. */
  set(t: number, w: number, h: number) {
    this.t = t;
    this.w = w;
    this.h = h;
    const m = h * (SEAM.tilt / 2 + SEAM.band + 0.02);
    const c = h + m + (-m - (h + m)) * t;
    this.l = c + (h * SEAM.tilt) / 2;
    this.r = c - (h * SEAM.tilt) / 2;
  }

  /** Seam y at x (CSS px). */
  yAt(x: number) {
    return this.l + ((this.r - this.l) * x) / this.w;
  }

  /** True while the band crosses the screen (anything to tear). */
  get active() {
    return this.t > 0 && this.t < 1;
  }

  /** Re-roll the strip table `SEAM.rate` times a second (deterministic per tick, so it's testable). */
  update(time: number) {
    const tick = Math.floor(time * SEAM.rate);
    if (tick === this.clock) return;
    this.clock = tick;
    this.seed = (tick * 2654435761) >>> 0;
    const h = this.h;
    const band = SEAM.band * h;
    let y = 0;
    let k = 0;
    while (y < band && k < MAX_STRIPS) {
      const sh = Math.min(band - y, h * (SEAM.stripMin + (SEAM.stripMax - SEAM.stripMin) * this.rand()));
      y += sh;
      const g = 1 - (y - sh * 0.5) / band; // 1 at the seam, 0 at the top of the band
      const on = this.rand() < SEAM.density;
      const o = k * 4;
      this.strips[o] = y;
      this.strips[o + 1] = on ? (this.rand() * 2 - 1) * SEAM.shift * this.w * g : 0;
      this.strips[o + 2] = g > 0.55 && this.rand() < SEAM.bleed ? 1 : 0;
      this.strips[o + 3] = on ? SEAM.chroma * this.w * g : 0;
      k++;
    }
    this.count = k;
  }

  private rand() {
    // mulberry32
    let t = (this.seed += 0x6d2b79f5);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }

  /**
   * Clip polygon for a panel on one side of the seam, in the panel's own coordinates (it is
   * translated by `dy` px). Each bleed strip is a band parallel to the seam, drawn as its own loop
   * with the even-odd rule: cut out of the outgoing side, added to the incoming side.
   */
  polygon(side: 'above' | 'below', dy: number): string {
    const W = this.w;
    const H = this.h;
    if (this.t <= 0) return side === 'above' ? 'none' : HIDDEN;
    if (this.t >= 1) return side === 'below' ? 'none' : HIDDEN;
    const L = this.l - dy;
    const R = this.r - dy;
    const pts =
      side === 'above'
        ? [p(0, -2 * H), p(W, -2 * H), p(W, R), p(0, L)]
        : [p(0, L), p(W, R), p(W, 2 * H), p(0, 2 * H), p(0, L)];
    let prev = 0;
    for (let k = 0; k < this.count; k++) {
      const top = this.strips[k * 4];
      if (this.strips[k * 4 + 2] > 0.5) pts.push(p(0, L - prev), p(W, R - prev), p(W, R - top), p(0, L - top), p(0, L - prev), p(0, L));
      prev = top;
    }
    return `polygon(evenodd, ${pts.join(', ')})`;
  }
}

const HIDDEN = 'inset(0 0 100% 0)';

function p(x: number, y: number) {
  return `${Math.round(x * 10) / 10}px ${Math.round(y * 10) / 10}px`;
}
