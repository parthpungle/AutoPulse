import { useCallback, useEffect, useRef, useState } from 'react';
import type { MouseEvent } from 'react';
import { gsap } from 'gsap';
import type { Experience as Engine } from '../experience/Experience';
import { CLUSTERS } from '../experience/sim/Targets';
import { Experience } from './Experience';
import { Cursor } from './Cursor';
import { Preloader } from './Preloader';
import { heroIntro, setupReveals } from './reveals';
import { CTA, DASHBOARD_URL, EVENT, GITHUB_URL, HERO, NAV_LABELS, RECOGNITION, SIGNALS, SIGNATURES, STATE_KEYS, TEAM_NAME } from './content';
import type { StateKey } from './content';

const AUTO_CYCLE_MS = 3500;

function loadFonts() {
  if (!document.fonts?.load) return Promise.resolve();
  return Promise.all([
    document.fonts.load('500 64px "Space Grotesk"'),
    document.fonts.load('300 16px "Space Grotesk"'),
    document.fonts.load('500 12px "JetBrains Mono"'),
    document.fonts.load('400 12px "JetBrains Mono"'),
  ]).then(() => undefined, () => undefined);
}

function Wordmark() {
  return (
    <>
      <b>TORQUE</b>TWIN
    </>
  );
}

export function Landing() {
  const [engine, setEngine] = useState<Engine | null>(null);
  const [section, setSection] = useState(0);
  const [active, setActive] = useState<StateKey | null>(null);
  const root = useRef<HTMLDivElement>(null);
  const pre = useRef<Preloader | null>(null);
  const picked = useRef(false);
  const signalTags = useRef<(HTMLDivElement | null)[]>([]);
  const clusterTags = useRef<(HTMLDivElement | null)[]>([]);

  if (!pre.current) pre.current = new Preloader();

  const onProgress = useCallback((p: number) => pre.current?.setEngine(p), []);
  const onSection = useCallback((i: number) => setSection(i), []);

  // fonts count toward the preloader; the cursor lives for the page's lifetime
  useEffect(() => {
    loadFonts().then(() => pre.current?.setFonts(1));
    const cursor = new Cursor();
    return () => {
      cursor.dispose();
      pre.current?.dispose();
    };
  }, []);

  // engine ready -> preloader out -> wipe + hero entrance -> scroll reveals
  useEffect(() => {
    const el = root.current;
    if (!engine || !el) return;
    let cancelled = false;
    let undoDebug: (() => void) | null = null;
    const ctx = gsap.context(() => {}, el);
    const reduced = engine.reduced;

    (async () => {
      let ok = true;
      try {
        await engine.ready;
      } catch {
        ok = false;
        pre.current?.setEngine(1);
      }
      if (cancelled) return;
      if (ok) {
        signalTags.current.forEach((t, i) => t && engine.anchorSignal(t, i));
        clusterTags.current.forEach((t, i) => t && engine.anchorCluster(t, i));
      }
      await pre.current?.done;
      if (cancelled) return;
      await pre.current?.exit(reduced);
      if (cancelled) return;
      ctx.add(() => {
        heroIntro(el, reduced, ok && !reduced ? 0.35 : 0);
        document.documentElement.classList.remove('is-loading');
        engine.reveal();
        setupReveals(el, reduced);
      });
      if (ok && new URLSearchParams(location.search).has('debug')) {
        const { mountDebug } = await import('../experience/Debug');
        if (!cancelled) undoDebug = await mountDebug(engine);
      }
    })();

    return () => {
      cancelled = true;
      ctx.revert();
      undoDebug?.();
    };
  }, [engine]);

  const choose = useCallback(
    (key: StateKey | null, byUser: boolean) => {
      if (byUser) picked.current = true;
      setActive(key);
      engine?.setState(key ?? 'baseline');
    },
    [engine],
  );

  // nobody clicked yet: cycle the states while Recognition is on screen, reset when it leaves
  useEffect(() => {
    if (!engine) return;
    const id = window.setInterval(() => {
      if (picked.current) return;
      const near = Math.abs(engine.scroll.sectionFloat - 3) < 0.45;
      if (near) {
        setActive((cur) => {
          const next = STATE_KEYS[(cur ? STATE_KEYS.indexOf(cur) + 1 : 0) % STATE_KEYS.length];
          engine.setState(next);
          return next;
        });
      } else if (engine.state !== 'baseline') {
        setActive(null);
        engine.setState('baseline');
      }
    }, AUTO_CYCLE_MS);
    return () => window.clearInterval(id);
  }, [engine]);

  const goTo = (e: MouseEvent, target: string) => {
    e.preventDefault();
    engine?.scrollTo(target);
  };

  const n = NAV_LABELS.length;
  const activeIndex = active ? STATE_KEYS.indexOf(active) : -1;

  return (
    <div ref={root} style={active === 'healthy' ? { ['--state' as string]: 'var(--cool)' } : undefined}>
      <Experience onCreate={setEngine} onProgress={onProgress} onSection={onSection} />

      <header className="tt-header">
        <a className="tt-wordmark" href="#top" onClick={(e) => goTo(e, '#top')} aria-label="TorqueTwin, back to top">
          <Wordmark />
        </a>
        <div className="tt-header__right">
          <div className="tt-progress" aria-label={`Section ${section + 1} of ${n}: ${NAV_LABELS[section]}`}>
            <span className="tt-progress__ticks" aria-hidden="true">
              {NAV_LABELS.map((l, i) => (
                <i key={l} className={i === section ? 'on' : ''} />
              ))}
            </span>
            <span className="tt-progress__num" aria-hidden="true">
              {String(section + 1).padStart(2, '0')} / {String(n).padStart(2, '0')}
            </span>
          </div>
          <a className="tt-navlink" href={DASHBOARD_URL}>
            Dashboard
          </a>
        </div>
      </header>

      <div className="tt-anchors" aria-hidden="true">
        {SIGNALS.channels.map((c, i) => (
          <div key={c.key} className="tt-tag tt-tag--signal" ref={(el) => void (signalTags.current[i] = el)}>
            <span>{c.tag}</span>
          </div>
        ))}
        {CLUSTERS.map((c, i) => (
          <div key={c.key} className={`tt-tag tt-tag--cluster${activeIndex === i ? ' on' : ''}`} ref={(el) => void (clusterTags.current[i] = el)}>
            <span>{c.label}</span>
          </div>
        ))}
      </div>

      <main className="tt-main">
        <section className="tt-sec tt-sec--hero" data-section="0" id="top" aria-label="Introduction">
          <div className="tt-sec__inner">
            <div className="tt-hero">
              <p className="tt-eyebrow" data-hero>
                <b>●</b> {HERO.eyebrow}
              </p>
              <h1 className="tt-h1" data-hero-title>
                {HERO.title.map((t) => (
                  <span key={t}>{t}</span>
                ))}
              </h1>
              <p className="tt-lede" data-hero>
                {HERO.sub}
              </p>
              <div className="tt-actions" data-hero>
                <a className="tt-btn tt-btn--primary" href={DASHBOARD_URL}>
                  {HERO.primary} <span className="tt-btn__arrow">→</span>
                </a>
                <a className="tt-btn tt-btn--ghost" href="#signals" onClick={(e) => goTo(e, '#signals')}>
                  {HERO.secondary} <span className="tt-btn__arrow">↓</span>
                </a>
              </div>
            </div>
            <div className="tt-hero__meta tt-mono" data-hero aria-hidden="true">
              <span>
                <i /> Live signal
              </span>
              <span>Move the cursor through it</span>
            </div>
          </div>
        </section>

        <section className="tt-sec" data-section="1" id="signals" aria-labelledby="signals-title">
          <div className="tt-sec__inner">
            <div className="tt-copy">
              <p className="tt-eyebrow" data-reveal="chars">
                {SIGNALS.eyebrow}
              </p>
              <h2 className="tt-h2" id="signals-title" data-reveal="lines">
                {SIGNALS.title}
              </h2>
              <ul className="tt-channels" data-reveal="stagger">
                {SIGNALS.channels.map((c) => (
                  <li key={c.key} className="tt-channel">
                    <span className="tt-channel__label">{c.label}</span>
                    <p>{c.text}</p>
                  </li>
                ))}
              </ul>
            </div>
          </div>
        </section>

        <section className="tt-sec" data-section="2" id="signatures" aria-labelledby="signatures-title">
          <div className="tt-sec__inner">
            <div className="tt-copy">
              <p className="tt-eyebrow" data-reveal="chars">
                {SIGNATURES.eyebrow}
              </p>
              <h2 className="tt-h2 tt-h2--wide" id="signatures-title" data-reveal="lines">
                {SIGNATURES.title}
              </h2>
              <p className="tt-lede" data-reveal="fade">
                {SIGNATURES.body}
              </p>
              <dl className="tt-stats" data-reveal="stagger">
                {SIGNATURES.stats.map((s) => (
                  <div key={s.label} className="tt-stat">
                    <dt className="tt-stat__label">{s.label}</dt>
                    <dd className="tt-stat__value" style={{ margin: 0 }}>
                      {s.value}
                    </dd>
                  </div>
                ))}
              </dl>
            </div>
          </div>
        </section>

        <section className="tt-sec" data-section="3" id="recognition" aria-labelledby="recognition-title">
          <div className="tt-sec__inner">
            <div className="tt-copy">
              <p className="tt-eyebrow" data-reveal="chars">
                {RECOGNITION.eyebrow}
              </p>
              <h2 className="tt-h2 tt-h2--wide" id="recognition-title" data-reveal="lines">
                {RECOGNITION.title}
              </h2>
              <div className="tt-pills" role="group" aria-label="Engine state" data-reveal="stagger">
                {STATE_KEYS.map((k) => (
                  <button key={k} type="button" className="tt-pill" aria-pressed={active === k} onClick={() => choose(k, true)}>
                    <i aria-hidden="true" />
                    {RECOGNITION.states[k].label}
                  </button>
                ))}
              </div>
              {!active && <p className="tt-hint">{RECOGNITION.hint}</p>}
              <ul className="tt-states" aria-live="polite">
                {STATE_KEYS.map((k) => (
                  <li key={k} className={active === k ? 'on' : ''}>
                    <span>{RECOGNITION.states[k].label}</span>
                    <p>{RECOGNITION.states[k].text}</p>
                  </li>
                ))}
              </ul>
              <p className="tt-model tt-mono" data-reveal="fade">
                <b>{RECOGNITION.stat.value}</b>
                <span>{RECOGNITION.stat.label}</span>
                <span>{RECOGNITION.models}</span>
              </p>
            </div>
          </div>
        </section>

        <section className="tt-sec tt-sec--cta" data-section="4" id="launch" aria-labelledby="cta-title">
          <div className="tt-sec__inner">
            <div className="tt-cta">
              <p className="tt-eyebrow" data-reveal="chars">
                {CTA.eyebrow}
              </p>
              <h2 className="tt-h2" id="cta-title" data-reveal="lines">
                {CTA.title.map((t) => (
                  <span key={t} style={{ display: 'block' }}>
                    {t}
                  </span>
                ))}
              </h2>
              <p className="tt-lede" data-reveal="fade">
                {CTA.sub}
              </p>
              <div className="tt-actions" data-reveal="fade">
                <a className="tt-btn tt-btn--primary tt-btn--lg" href={DASHBOARD_URL}>
                  {CTA.button} <span className="tt-btn__arrow">→</span>
                </a>
              </div>
            </div>
            <footer className="tt-footer tt-mono">
              <span className="tt-wordmark">
                <Wordmark />
              </span>
              <span className="tt-footer__mid">
                <span>{TEAM_NAME}</span>
                <span>{EVENT}</span>
              </span>
              <a href={GITHUB_URL} target="_blank" rel="noreferrer">
                GitHub ↗
              </a>
            </footer>
          </div>
        </section>
      </main>
    </div>
  );
}
