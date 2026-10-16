import { gsap } from 'gsap';
import { ScrollTrigger } from 'gsap/ScrollTrigger';
import { SplitText } from 'gsap/SplitText';

gsap.registerPlugin(ScrollTrigger, SplitText);

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
 * Scroll reveals: [data-reveal="lines"] rises line by line, [data-reveal="chars"] types in,
 * [data-reveal="fade"] fades up. Short (<= 0.8 s) and staggered; each plays once on enter.
 * Call inside a gsap.context so everything reverts on unmount.
 */
export function setupReveals(root: HTMLElement, reduced: boolean) {
  const trigger = (el: Element) => ({ trigger: el, start: 'top 82%', once: true });

  if (reduced) {
    root.querySelectorAll('[data-reveal]').forEach((el) => {
      gsap.from(el, { opacity: 0, duration: 0.5, scrollTrigger: trigger(el) });
    });
    return;
  }

  root.querySelectorAll<HTMLElement>('[data-reveal="lines"]').forEach((el) => {
    SplitText.create(el, {
      type: 'lines',
      mask: 'lines',
      linesClass: 'tt-line',
      autoSplit: true,
      onSplit: (self) => gsap.from(self.lines, { yPercent: 108, duration: 0.75, ease: EASE, stagger: 0.07, scrollTrigger: trigger(el) }),
    });
  });

  root.querySelectorAll<HTMLElement>('[data-reveal="chars"]').forEach((el) => {
    const split = SplitText.create(el, { type: 'chars' });
    gsap.from(split.chars, { opacity: 0, duration: 0.3, ease: 'none', stagger: 0.018, scrollTrigger: trigger(el) });
  });

  root.querySelectorAll<HTMLElement>('[data-reveal="fade"]').forEach((el) => {
    gsap.from(el, { opacity: 0, y: 22, duration: 0.7, ease: EASE, scrollTrigger: trigger(el) });
  });

  root.querySelectorAll<HTMLElement>('[data-reveal="stagger"]').forEach((el) => {
    gsap.from(el.children, { opacity: 0, y: 16, duration: 0.6, ease: EASE, stagger: 0.07, scrollTrigger: trigger(el) });
  });

  ScrollTrigger.refresh();
}
