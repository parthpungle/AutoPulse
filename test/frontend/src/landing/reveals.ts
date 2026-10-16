import { gsap } from 'gsap';
import { SplitText } from 'gsap/SplitText';

gsap.registerPlugin(SplitText);

const EASE = 'expo.out';

/** Hero entrance, played as the intro wipe uncovers the page. */
export function heroIntro(root: HTMLElement, reduced: boolean, delay = 0) {
  const title = root.querySelector<HTMLElement>('[data-hero-title]');
  const rest = root.querySelectorAll<HTMLElement>('[data-hero]');
  const tl = gsap.timeline({ delay });
  if (reduced || !title) {
    tl.from([title, ...rest], { opacity: 0, duration: 0.5, stagger: 0.05 });
    return tl;
  }
  const split = SplitText.create(title, { type: 'lines', mask: 'lines', linesClass: 'tt-line' });
  tl.from(split.lines, { yPercent: 108, duration: 0.8, ease: EASE, stagger: 0.08 }, 0);
  tl.from(rest, { opacity: 0, y: 18, duration: 0.7, ease: EASE, stagger: 0.07 }, 0.2);
  return tl;
}

/**
 * Section reveals: [data-reveal="lines"] rises line by line, [data-reveal="chars"] types in,
 * [data-reveal="fade"] fades up, [data-reveal="stagger"] brings children in one by one. Short
 * (<= 0.8 s) and staggered. Section panels are fixed layers that the cut uncovers, so the engine
 * says when a section first comes on screen; the returned function plays that section's reveals
 * (once). Call inside a gsap.context so everything reverts on unmount.
 */
export function setupReveals(root: HTMLElement, reduced: boolean): (section: Element) => void {
  const bySection = new Map<Element, (() => void)[]>();
  const played = new Set<Element>();
  const add = (el: Element, play: () => void) => {
    const sec = el.closest('[data-section]') ?? root;
    if (!bySection.has(sec)) bySection.set(sec, []);
    bySection.get(sec)!.push(play);
  };
  const paused = (tw: gsap.core.Tween) => () => void tw.play();

  if (reduced) {
    root.querySelectorAll('[data-reveal]').forEach((el) => add(el, paused(gsap.from(el, { opacity: 0, duration: 0.5, paused: true }))));
  } else {
    root.querySelectorAll<HTMLElement>('[data-reveal="lines"]').forEach((el) => {
      // autoSplit re-splits on resize: keep the latest tween, finished if the section already played
      let tween: gsap.core.Tween | null = null;
      const sec = el.closest('[data-section]') ?? root;
      SplitText.create(el, {
        type: 'lines',
        mask: 'lines',
        linesClass: 'tt-line',
        autoSplit: true,
        onSplit: (self) => {
          tween = gsap.from(self.lines, { yPercent: 108, duration: 0.75, ease: EASE, stagger: 0.07, paused: true });
          if (played.has(sec)) tween.progress(1);
          return tween;
        },
      });
      add(el, () => void tween?.play());
    });
    root.querySelectorAll<HTMLElement>('[data-reveal="chars"]').forEach((el) => {
      const split = SplitText.create(el, { type: 'chars' });
      add(el, paused(gsap.from(split.chars, { opacity: 0, duration: 0.3, ease: 'none', stagger: 0.018, paused: true })));
    });
    root.querySelectorAll<HTMLElement>('[data-reveal="fade"]').forEach((el) => {
      add(el, paused(gsap.from(el, { opacity: 0, y: 22, duration: 0.7, ease: EASE, paused: true })));
    });
    root.querySelectorAll<HTMLElement>('[data-reveal="stagger"]').forEach((el) => {
      add(el, paused(gsap.from(el.children, { opacity: 0, y: 16, duration: 0.6, ease: EASE, stagger: 0.07, paused: true })));
    });
  }

  return (section: Element) => {
    if (played.has(section)) return;
    played.add(section);
    for (const play of bySection.get(section) ?? []) play();
  };
}
