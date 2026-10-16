import { useEffect, useId, useRef, useState } from 'react';
import type { CSSProperties } from 'react';
import { SENSORS } from '../../content/sensors';
import type { Experience as Engine } from '../../experience/Experience';
import { RECOGNITION, STATE_KEYS } from '../content';
import type { StateKey } from '../content';
import { MiniTrace, windowLabel } from './MiniTrace';

interface Props {
  engine: Engine | null;
  index: number;
  open: boolean;
  onClose: () => void;
  /** Global engine state (shared with the Recognition section). */
  state: StateKey | null;
  onState: (k: StateKey) => void;
}

/**
 * The expanded sensor card. There is no popup: the active glass card itself turns to face the
 * viewer and grows onto this panel's box (the engine reads it every frame), and this transparent
 * HTML layer carries the readable content on the glass. Level 1 is the plain sentence, a live
 * trace with the state pills and the fault chips; "Technical details" (level 2) opens the full
 * checked copy and makes the card taller.
 *
 * Also hosts the "Tap for details" hint, which the engine pins under the active card.
 * Esc, the close button or a click outside the card closes it; focus is trapped inside.
 */
export function SensorCardDetail({ engine, index, open, onClose, state, onState }: Props) {
  const s = SENSORS[index];
  const panel = useRef<HTMLDivElement>(null);
  const hint = useRef<HTMLDivElement>(null);
  const body = useRef<HTMLDivElement>(null);
  const closeBtn = useRef<HTMLButtonElement>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  const trace = useRef<MiniTrace | null>(null);
  const restore = useRef<HTMLElement | null>(null);
  const [tech, setTech] = useState(false);
  const ids = useId();
  const titleId = `${ids}-title`;
  const techId = `${ids}-tech`;

  useEffect(() => {
    if (!engine) return;
    engine.bindCardUI(panel.current, hint.current);
    return () => engine.bindCardUI(null, null);
  }, [engine]);

  // every opening starts at level 1
  useEffect(() => {
    if (!open) setTech(false);
    else body.current?.scrollTo({ top: 0 });
  }, [open]);

  // live trace: only runs while the card is open
  useEffect(() => {
    if (!engine || !canvas.current) return;
    if (!trace.current || trace.current.element !== canvas.current) {
      trace.current?.stop();
      trace.current = new MiniTrace(canvas.current, engine.signals);
    }
    const t = trace.current;
    t.set(index, s.color);
    if (open) t.start();
    else t.stop();
    return () => t.stop();
  }, [engine, index, open, s.color]);

  // focus: into the card on open, back where it was on close; Tab stays inside; Esc closes
  useEffect(() => {
    if (!open) return;
    restore.current = document.activeElement as HTMLElement | null;
    closeBtn.current?.focus({ preventScroll: true });
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        onClose();
        return;
      }
      if (e.key !== 'Tab' || !panel.current) return;
      const items = Array.from(panel.current.querySelectorAll<HTMLElement>('button, [href], [tabindex]:not([tabindex="-1"])')).filter((el) => el.offsetParent !== null);
      if (!items.length) return;
      // cycle by hand: Safari leaves buttons out of the Tab order by default and doesn't focus
      // them on click, so the browser's own Tab would drop out of the card
      e.preventDefault();
      const n = items.length;
      const step = e.shiftKey ? n - 1 : 1;
      let i = items.indexOf(document.activeElement as HTMLElement);
      if (i < 0) i = e.shiftKey ? 0 : n - 1; // from outside: first (or last) item
      items[(i + step) % n].focus();
    };
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('keydown', onKey);
      restore.current?.focus?.({ preventScroll: true });
    };
  }, [open, onClose]);

  // opening the technical details: bring them into view once the card has grown
  useEffect(() => {
    if (!tech) return;
    const id = window.setTimeout(() => {
      const list = document.getElementById(techId);
      const b = body.current;
      if (!list || !b) return;
      const over = list.getBoundingClientRect().bottom - b.getBoundingClientRect().bottom;
      if (over > 0) b.scrollBy({ top: over + 8, behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' });
    }, 480);
    return () => window.clearTimeout(id);
  }, [tech, techId]);

  return (
    <div className={`tt-cardx${open ? ' is-open' : ''}`} data-ui>
      <div className="tt-cardhint" ref={hint} aria-hidden="true">
        Tap for details <span>→</span>
      </div>
      <div className="tt-cardx__scrim" onClick={onClose} aria-hidden="true" />
      <div
        ref={panel}
        className={`tt-cardx__panel${tech ? ' is-tech' : ''}`}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        inert={!open}
        style={{ '--c': s.color } as CSSProperties}
      >
        <div className="tt-cardx__body" ref={body} data-lenis-prevent>
          <div className="tt-cardx__head">
            <p className="tt-cardx__code">{s.code}</p>
            <h3 className="tt-cardx__title" id={titleId}>
              {s.title}
            </h3>
            <button ref={closeBtn} type="button" className="tt-cardx__close" onClick={onClose} aria-label="Close sensor details">
              ✕
            </button>
          </div>
          <p className="tt-cardx__plain">{s.plainSentence}</p>

          <figure className="tt-cardx__trace">
            <canvas ref={canvas} aria-label={`Live synthetic ${s.title} signal`} role="img" />
            <figcaption>
              <span>Live trace · synthetic</span>
              <span>{windowLabel(index)}</span>
            </figcaption>
          </figure>
          <div className="tt-cardx__states" role="group" aria-label="Engine state">
            {STATE_KEYS.map((k) => (
              <button key={k} type="button" className="tt-pill tt-pill--sm" aria-pressed={state === k} onClick={() => onState(k)}>
                <i aria-hidden="true" />
                {RECOGNITION.states[k].label}
              </button>
            ))}
          </div>

          {s.catches.length > 0 && (
            <div className="tt-cardx__catches">
              <p className="tt-cardx__label">Catches</p>
              <ul className="tt-chips">
                {s.catches.map((c) => (
                  <li key={c}>{c}</li>
                ))}
              </ul>
            </div>
          )}

          <div className="tt-cardx__foot">
            <button type="button" className="tt-cardx__more" aria-expanded={tech} aria-controls={techId} onClick={() => setTech((v) => !v)}>
              Technical details <span aria-hidden="true">▾</span>
            </button>
          </div>
          <dl className="tt-cardx__tech" id={techId} hidden={!tech}>
            {s.technical.map((f) => (
              <div key={f.label}>
                <dt>{f.label}</dt>
                <dd className={f.label === 'OBD-II PID' || f.label === 'Sample rate' ? 'tt-mono-val' : undefined}>{f.text}</dd>
              </div>
            ))}
          </dl>
        </div>
      </div>
    </div>
  );
}
