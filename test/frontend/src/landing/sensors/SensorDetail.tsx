import { useEffect, useRef } from 'react';
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

/** Fields shown before "Reveals"; the rest follow it (brief §6.3 order). */
const BEFORE_REVEALS = new Set(['Hears', 'Signal', 'Mounted', 'What it is', 'Rates', 'Role']);

/**
 * The sensor detail dialog: a frosted panel from the right (bottom sheet on phones) with every
 * field of the sensor, fault chips and a live mini trace. Esc, the close button or a click on the
 * scene closes it; focus is trapped inside while it is open.
 */
export function SensorDetail({ engine, index, open, onClose, state, onState }: Props) {
  const s = SENSORS[index];
  const panel = useRef<HTMLDivElement>(null);
  const closeBtn = useRef<HTMLButtonElement>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  const trace = useRef<MiniTrace | null>(null);
  const restore = useRef<HTMLElement | null>(null);

  // live trace: only runs while the panel is open
  useEffect(() => {
    if (!engine || !canvas.current) return;
    // the canvas is never conditionally rendered, but recreate the trace if it ever changes
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

  // focus: into the dialog on open, back where it was on close; Tab stays inside; Esc closes
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
      const items = panel.current.querySelectorAll<HTMLElement>('button, [href], [tabindex]:not([tabindex="-1"])');
      if (!items.length) return;
      const first = items[0];
      const last = items[items.length - 1];
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('keydown', onKey);
      restore.current?.focus?.({ preventScroll: true });
    };
  }, [open, onClose]);

  const before = s.fields.filter((f) => BEFORE_REVEALS.has(f.label));
  const after = s.fields.filter((f) => !BEFORE_REVEALS.has(f.label));

  return (
    <div className={`tt-detail${open ? ' is-open' : ''}`} inert={!open} data-ui>
      <div className="tt-detail__scrim" onClick={onClose} aria-hidden="true" />
      <div
        ref={panel}
        className="tt-detail__panel"
        role="dialog"
        aria-modal="true"
        aria-labelledby="tt-detail-title"
        data-lenis-prevent
        style={{ '--c': s.color } as CSSProperties}
      >
        <button ref={closeBtn} type="button" className="tt-detail__close" onClick={onClose} aria-label="Close sensor details">
          ✕
        </button>
        <p className="tt-detail__code">{s.code}</p>
        <h3 className="tt-detail__title" id="tt-detail-title">
          {s.title}
        </h3>

        <figure className="tt-detail__trace">
          <canvas ref={canvas} aria-label={`Live synthetic ${s.title} signal`} role="img" />
          <figcaption>
            <span>Live trace · synthetic</span>
            <span>{windowLabel(index)}</span>
          </figcaption>
        </figure>
        <div className="tt-detail__states" role="group" aria-label="Engine state">
          {STATE_KEYS.map((k) => (
            <button key={k} type="button" className="tt-pill tt-pill--sm" aria-pressed={state === k} onClick={() => onState(k)}>
              <i aria-hidden="true" />
              {RECOGNITION.states[k].label}
            </button>
          ))}
        </div>

        <dl className="tt-detail__fields">
          {before.map((f) => (
            <div key={f.label}>
              <dt>{f.label}</dt>
              <dd>{f.text}</dd>
            </div>
          ))}
          {s.reveals.chips.length > 0 && (
            <div>
              <dt>Reveals</dt>
              <dd>
                <ul className="tt-chips">
                  {s.reveals.chips.map((c) => (
                    <li key={c}>{c}</li>
                  ))}
                </ul>
                {s.reveals.lines.map((l) => (
                  <p key={l}>{l}</p>
                ))}
              </dd>
            </div>
          )}
          {after.map((f) => (
            <div key={f.label}>
              <dt>{f.label}</dt>
              <dd className={f.label === 'OBD-II PID' ? 'tt-mono-val' : undefined}>{f.text}</dd>
            </div>
          ))}
        </dl>
      </div>
    </div>
  );
}
