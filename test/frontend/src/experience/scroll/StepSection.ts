import { gsap } from 'gsap';
import type { ScrollState } from '../ScrollState';

/** What a stepped section does with one wheel or touch event. */
export type Gesture = 'pass' | 'consume';

/** One gesture-log entry (?debug), for replaying real trackpad / mouse / phone traces. */
export interface GestureLog {
  t: number;
  type: string;
  dx: number;
  dy: number;
  decision: string;
  index: number;
}

const STEP_TIME = 0.42;
/** A gesture ends after this much silence. */
const QUIET_MS = 250;
/** A new gesture can't start sooner than this after a step... */
const REARM_MS = 280;
/** ...unless the deltas jump this far above their recent minimum (a new flick over the inertia). */
const REARM_RISE = 1.5;
const REARM_MIN = 15;
/** How long native scrolling (scrollbar drag, find-in-page) must rest before the page snaps. */
const NATIVE_IDLE_MS = 120;
const TOUCH_STEP_PX = 40;

/**
 * A pinned section that moves in discrete steps (the Sensor Array's cards, later the pipeline's
 * stages). One wheel gesture, swipe or key press is one step:
 *  - `index` changes the moment a gesture lands; `value` (visuals only) tweens to it, 420 ms
 *    expo.out. That tween is the only smoothing on the way: inside the section the page scroll
 *    jumps straight to the step's position, so the scrollbar and progress readouts stay true.
 *  - Wheel and touch arrive through the Lenis gate (ScrollState.addGate), before Lenis sees them.
 *    Trackpad inertia keeps sending events for a second or more, so after a step the section
 *    locks until the deltas go quiet (250 ms), or until they rise again (a second flick).
 *  - Past the first or last step a gesture passes through and the page scrolls on. A gesture that
 *    would carry the page into the section stops exactly at its start (or end, from below), so
 *    the first card is already in place when the section pins.
 *  - Native scrolling that bypasses the gate (scrollbar drag, find-in-page, Home/End) maps to the
 *    nearest step, and the page snaps to it once that scrolling rests.
 */
export class StepSection {
  /** The active step. */
  index = 0;
  /** Tweened position, 0..count-1 (drives the visuals). */
  value = 0;
  /** Off while the page scroll is locked (a card is expanded). */
  enabled = true;
  readonly count: number;
  /** ?debug: recent gesture decisions. */
  readonly log: GestureLog[] = [];
  logging = false;
  onChange: ((i: number) => void) | null = null;

  private readonly scroll: ScrollState;
  private readonly section: number;
  private reduced: boolean;
  private locked = false;
  private lockDir = 0;
  private lastEvent = 0;
  private lastStep = 0;
  private readonly recent: { t: number; d: number }[] = [];
  private touchAcc = 0;
  private touchStepped = false;
  private touchMode: 'none' | 'capture' | 'pass' = 'none';
  private lastNative = 0;

  constructor(scroll: ScrollState, section: number, count: number, reduced: boolean) {
    this.scroll = scroll;
    this.section = section;
    this.count = count;
    this.reduced = reduced;
    scroll.addGate(this.consume);
    scroll.lenis.on('scroll', this.onScroll);
  }

  setReduced(reduced: boolean) {
    this.reduced = reduced;
  }

  /** The active step (alias used by the Sensor Array code). */
  get active() {
    return this.index;
  }

  /** Scroll positions of the first and last step. */
  get start() {
    return this.scroll.scrollForLocal(this.section, 0);
  }

  get end() {
    return this.scroll.scrollForLocal(this.section, 1);
  }

  /** Page scroll position of step i. */
  posFor(i: number) {
    const s = this.start;
    return s + ((this.end - s) * i) / (this.count - 1);
  }

  /** True while the page is inside this section's hold. */
  get captured() {
    const t = this.scroll.lenis.targetScroll;
    return t >= this.start - 1 && t <= this.end + 1;
  }

  /** Go to step i: one tween on `value`, and the page jumps to the matching scroll position. */
  go(i: number, sync = true) {
    const k = Math.max(0, Math.min(this.count - 1, i));
    if (k !== this.index) {
      this.index = k;
      this.onChange?.(k);
    }
    if (this.reduced) {
      gsap.killTweensOf(this);
      this.value = k;
    } else if (this.value !== k) {
      gsap.to(this, { value: k, duration: STEP_TIME, ease: 'expo.out', overwrite: true });
    }
    if (sync) this.scroll.lenis.scrollTo(this.posFor(k), { immediate: true, force: true, userData: { tt: 'step' } });
  }

  /** Jump straight to step i (no tween), e.g. when the section is entered. */
  private place(i: number) {
    gsap.killTweensOf(this);
    this.index = i;
    this.value = i;
    this.onChange?.(i);
  }

  /** Lenis gate: decide what one wheel/touch event does. */
  private consume = (dx: number, dy: number, event: Event): Gesture => {
    if (!this.enabled) return 'pass';
    const type = event.type;
    const touch = type.startsWith('touch');
    const d = Math.abs(dx) > Math.abs(dy) ? dx : dy;
    const now = performance.now();
    const decision = touch ? this.touchGesture(type, d) : this.wheelGesture(d, now);
    if (this.logging) {
      this.log.push({ t: Math.round(now), type, dx: Math.round(dx * 10) / 10, dy: Math.round(dy * 10) / 10, decision, index: this.index });
      if (this.log.length > 2000) this.log.splice(0, 500);
    }
    return decision === 'pass' ? 'pass' : 'consume';
  };

  private wheelGesture(d: number, now: number): string {
    const quiet = now - this.lastEvent;
    this.lastEvent = now;
    // the recent deltas, to tell a fresh flick from inertia
    this.recent.push({ t: now, d: Math.abs(d) });
    while (this.recent.length && now - this.recent[0].t > 120) this.recent.shift();
    if (d === 0) return this.captured ? 'block' : 'pass';

    const lenis = this.scroll.lenis;
    const t = lenis.targetScroll;
    const s0 = this.start;
    const s1 = this.end;
    if (!this.captured) {
      // entering: stop exactly at the section's start (or end, from below)
      if (t < s0 && t + d >= s0) return this.enter(s0, 0, d, now);
      if (t > s1 && t + d <= s1) return this.enter(s1, this.count - 1, d, now);
      return 'pass';
    }

    if (this.locked) {
      let min = Infinity;
      for (const r of this.recent) if (r.t < now && r.d < min) min = r.d;
      const rising = min < Infinity && Math.abs(d) > REARM_RISE * min && Math.abs(d) > REARM_MIN;
      const flipped = Math.sign(d) !== this.lockDir;
      if (quiet > QUIET_MS || (now - this.lastStep >= REARM_MS && (rising || flipped))) this.locked = false;
      else return 'block';
    }
    const next = this.index + Math.sign(d);
    // past the ends the page scrolls on
    if (next < 0 || next >= this.count) return 'pass';
    this.locked = true;
    this.lockDir = Math.sign(d);
    this.lastStep = now;
    this.go(next);
    return 'step';
  }

  private enter(y: number, i: number, d: number, now: number) {
    this.place(i);
    this.scroll.lenis.scrollTo(y, { programmatic: false, force: true });
    this.locked = true;
    this.lockDir = Math.sign(d);
    this.lastStep = now;
    return 'enter';
  }

  /** Touch (smooth touch is on for coarse pointers): one swipe of 40 px is one step. */
  private touchGesture(type: string, d: number): string {
    if (type === 'touchstart') {
      // never cancel a touchstart: taps on the cards must still click
      this.touchAcc = 0;
      this.touchStepped = false;
      this.touchMode = 'none';
      return 'pass';
    }
    if (this.touchMode === 'pass') return 'pass';
    if (type === 'touchend') {
      // swallow the inertia of a swipe we used
      const used = this.touchMode === 'capture';
      this.touchMode = 'none';
      return used ? 'block' : 'pass';
    }
    if (this.touchMode === 'none') {
      if (!this.captured) {
        const t = this.scroll.lenis.targetScroll;
        if ((t < this.start && t + d >= this.start) || (t > this.end && t + d <= this.end)) {
          this.touchMode = 'capture';
          this.touchStepped = true;
          return this.enter(t < this.start ? this.start : this.end, t < this.start ? 0 : this.count - 1, d, performance.now());
        }
        return 'pass';
      }
      const next = this.index + Math.sign(d);
      if (d !== 0 && (next < 0 || next >= this.count)) {
        this.touchMode = 'pass';
        return 'pass';
      }
      this.touchMode = 'capture';
    }
    this.touchAcc += d;
    if (!this.touchStepped && Math.abs(this.touchAcc) > TOUCH_STEP_PX) {
      this.touchStepped = true;
      this.go(this.index + Math.sign(this.touchAcc));
      return 'step';
    }
    return 'block';
  }

  /** Scrolling that isn't a step (scrollbar drag, find-in-page, links into the section): follow it,
   *  and snap once native scrolling rests. */
  private onScroll = () => {
    const lenis = this.scroll.lenis;
    if ((lenis.userData as { tt?: string } | undefined)?.tt === 'step' || !this.enabled) return;
    const y = lenis.animatedScroll;
    if (y < this.start - 1 || y > this.end + 1) return;
    if (lenis.isScrolling === 'native') this.lastNative = performance.now();
    const i = Math.round((y - this.start) / ((this.end - this.start) / (this.count - 1)));
    if (i !== this.index) this.go(i, false);
  };

  /** Snap the page once native scrolling inside the section has come to rest. */
  update() {
    if (!this.lastNative || performance.now() - this.lastNative < NATIVE_IDLE_MS || this.scroll.lenis.isScrolling) return;
    this.lastNative = 0;
    if (this.captured && Math.abs(this.scroll.lenis.animatedScroll - this.posFor(this.index)) > 1) this.go(this.index);
  }

  /** Step by `dir` if that stays inside the section (keys); false at the ends. */
  step(dir: number) {
    const next = this.index + dir;
    if (!this.enabled || !this.captured || next < 0 || next >= this.count) return false;
    this.go(next);
    return true;
  }

  dispose() {
    gsap.killTweensOf(this);
    this.scroll.removeGate(this.consume);
    this.scroll.lenis.off('scroll', this.onScroll);
  }
}
