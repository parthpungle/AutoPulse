import { SEAM } from './Seam';
import type { Seam } from './Seam';

const HIDDEN = 'inset(0 0 100% 0)';
/** DOM pieces that tear with the band (lines of text and small controls). */
const TEAR = '.tt-eyebrow, .tt-lede, .tt-line, .tt-h3, .tt-btn, .tt-pill, .tt-stat, .tt-states li, .tt-model, .tt-index__head, .tt-index__list li, .tt-hero__meta span, .tt-cta .tt-h2 > span';

interface PanelStyle {
  clip: string;
  transform: string;
  opacity: string;
}

/**
 * The DOM side of the cut. Every section's panel is a fixed layer; outside a cut only the
 * current one shows. During a cut the outgoing panel is clipped to above the seam and drifts up,
 * the incoming one is clipped to below it and rises into place, both with the same polygons as
 * the GL seam (bleed strips included). Hidden panels are clipped away rather than hidden, so they
 * stay in the accessibility tree; a clip also stops clicks. Reduced motion: a 300 ms crossfade
 * (CSS) once the scroll passes the middle of the cut.
 * Styles are written only when they change.
 */
export class Panels {
  private readonly panels: HTMLElement[];
  /** Layers that belong to a section but don't drift (Recognition's cluster labels). */
  private readonly extras: { el: HTMLElement; section: number }[];
  private readonly last: PanelStyle[];
  private readonly lastExtra: string[];
  /** Elements currently shifted by the band. */
  private readonly tearing = new Set<HTMLElement>();

  constructor(panels: HTMLElement[], extras: { el: HTMLElement; section: number }[]) {
    this.panels = panels;
    this.extras = extras;
    this.last = panels.map(() => ({ clip: '', transform: '', opacity: '' }));
    this.lastExtra = extras.map(() => '');
  }

  update(current: number, boundary: number, t: number, seam: Seam, vh: number, reduced: boolean) {
    const n = this.panels.length;
    this.tear(boundary >= 0 && !reduced ? this.panels[boundary] : null, seam);
    for (let i = 0; i < n; i++) {
      let clip = HIDDEN;
      let transform = 'none';
      let opacity = '1';
      if (reduced) {
        // crossfade: both panels of a cut stay unclipped; the one past the midpoint is opaque
        const involved = boundary >= 0 ? i === boundary || i === boundary + 1 : i === current;
        if (involved) {
          clip = 'none';
          const shown = boundary >= 0 ? (t < 0.5 ? boundary : boundary + 1) : current;
          opacity = i === shown ? '1' : '0';
        }
      } else if (boundary < 0) {
        if (i === current) clip = 'none';
      } else if (i === boundary) {
        const dy = -SEAM.drift * vh * t;
        clip = seam.polygon('above', dy);
        transform = `translate3d(0, ${dy.toFixed(1)}px, 0)`;
      } else if (i === boundary + 1) {
        const dy = SEAM.drift * vh * (1 - t);
        clip = seam.polygon('below', dy);
        transform = `translate3d(0, ${dy.toFixed(1)}px, 0)`;
      }
      this.apply(i, clip, transform, opacity);
    }
    for (let k = 0; k < this.extras.length; k++) {
      const { el, section } = this.extras[k];
      let clip = HIDDEN;
      if (boundary < 0) {
        if (section === current) clip = 'none';
      } else if (reduced) {
        if (section === boundary || section === boundary + 1) clip = 'none';
      } else if (section === boundary) {
        clip = seam.polygon('above', 0);
      } else if (section === boundary + 1) {
        clip = seam.polygon('below', 0);
      }
      if (clip !== this.lastExtra[k]) {
        this.lastExtra[k] = clip;
        el.style.clipPath = clip;
      }
    }
  }

  private apply(i: number, clip: string, transform: string, opacity: string) {
    const el = this.panels[i];
    const last = this.last[i];
    if (clip !== last.clip) {
      last.clip = clip;
      el.style.clipPath = clip;
    }
    if (transform !== last.transform) {
      last.transform = transform;
      el.style.transform = transform;
    }
    if (opacity !== last.opacity) {
      last.opacity = opacity;
      el.style.opacity = opacity;
    }
  }

  /**
   * The outgoing panel's text and controls tear like the GL layer: while an element sits in the
   * band above the seam it shifts sideways by its strip's offset (the same strip table as the
   * composite) with a little RGB split; the jagged clip polygon chops it at the seam.
   */
  private tear(panel: HTMLElement | null, seam: Seam | null) {
    const now = new Set<HTMLElement>();
    if (panel && seam) {
      const band = (seam.h * SEAM.band);
      for (const el of panel.querySelectorAll<HTMLElement>(TEAR)) {
        const r = el.getBoundingClientRect();
        if (r.height === 0) continue;
        const cy = r.top + r.height / 2;
        const d = seam.yAt(r.left + r.width / 2) - cy; // px above the seam
        if (d < -r.height / 2 || d > band + r.height / 2) continue;
        let shift = 0;
        let split = 0;
        for (let k = 0; k < seam.count; k++) {
          if (Math.max(0, d) < seam.strips[k * 4]) {
            shift = seam.strips[k * 4 + 1];
            split = seam.strips[k * 4 + 3];
            break;
          }
        }
        if (shift === 0 && split === 0) continue;
        now.add(el);
        el.style.setProperty('--gx', `${shift.toFixed(1)}px`);
        el.style.setProperty('--gc', `${Math.max(1, split * 0.5).toFixed(1)}px`);
        el.classList.add('is-tearing');
      }
    }
    for (const el of this.tearing) {
      if (now.has(el)) continue;
      el.classList.remove('is-tearing');
      el.style.removeProperty('--gx');
      el.style.removeProperty('--gc');
    }
    this.tearing.clear();
    for (const el of now) this.tearing.add(el);
  }

  /** Which section's panel holds an element (-1: none). */
  sectionOf(el: Element | null) {
    for (let i = 0; i < this.panels.length; i++) if (el && this.panels[i].contains(el)) return i;
    return -1;
  }

  /** Back to plain document styles (no clip, no drift). */
  reset() {
    this.tear(null, null);
    for (const el of this.panels) {
      el.style.clipPath = '';
      el.style.transform = '';
      el.style.opacity = '';
    }
    for (const { el } of this.extras) el.style.clipPath = '';
  }
}
