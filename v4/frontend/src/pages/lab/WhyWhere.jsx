// 05 / Why · where · what next: the case in five lines, each linked to the chart that proves it.
// Clicking a line scrolls to that chart and focuses it; "Where in time" also scrubs to the onset.
import { ChevronRight } from 'lucide-react';
import { engineAlert } from './labStore.js';
import { duration, occurrences, onset, ordinal, plainMessage } from './derive.js';
import OpMap from './OpMap.jsx';

function focusOn(id) {
  const el = document.getElementById(id);
  if (!el) return;
  const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;
  el.scrollIntoView({ block: 'center', behavior: reduce ? 'auto' : 'smooth' });
  el.focus({ preventScroll: true });
  el.classList.remove('lab-focus');
  void el.offsetWidth;                                     // restart the one-shot highlight
  el.classList.add('lab-focus');
}

export default function WhyWhere({ latest, frames, rows, ev, where, onInspect }) {
  const { engine, row, alerts } = latest;
  const fault = engine.fault ?? 'healthy';
  const alert = engineAlert(alerts);
  const start = fault !== 'healthy' ? onset(frames, fault) : null;
  const times = fault !== 'healthy' ? occurrences(frames, fault) : 0;

  let why = plainMessage(alert?.message);
  if (!why) why = engine.status === 'info'
    ? 'The sound is outside this car\'s normal, but the models do not name a known fault.'
    : 'Nothing stands out: the models and this car\'s normal both read healthy.';
  let time = 'No fault confirmed in the seconds this page has seen.';
  if (start) {
    time = `Confirmed ${start.early ? 'at least ' : ''}${duration(row.clock - start.clock + 1)} ago`
      + (times > 1 ? `, the ${ordinal(times)} time since this page opened.` : ', first time since this page opened.');
  }
  const next = alert?.actions?.slice(1) ?? [];

  const lines = [
    { k: 'Why', text: why },
    { k: 'Where in frequency', text: ev.freq ?? (ev.readout.value ? `${ev.readout.value} ${ev.readout.text}.` : `Not yet: ${ev.readout.pending}.`), go: () => focusOn('lab-evidence') },
    { k: 'Where in the cycle', text: where.text, go: () => focusOn('lab-cycle') },
    { k: 'Where in time', text: time, go: () => { if (start) onInspect(start.clock); focusOn('lab-timeline'); } },
    { k: 'What next', text: next.length ? next.join(' · ') : (alert?.actions?.[0] ? 'Nothing beyond the action above.' : 'Keep driving; this page keeps watching.') },
  ];

  return (
    <section className="panel panel-pad lab-why" aria-labelledby="lab-why-title">
      <h2 className="eyebrow lab-eyebrow" id="lab-why-title"><span className="num">05</span> / Why · where · what next</h2>
      <div className="lab-why__body">
      <dl className="lab-why__list">
        {lines.map((l) => (
          <div key={l.k} className="lab-why__row">
            <dt>{l.k}</dt>
            <dd>
              {l.go ? (
                <button type="button" className="lab-why__go" onClick={l.go} aria-label={`${l.k}: ${l.text} Show the chart.`}>
                  <span>{l.text}</span><ChevronRight size={16} aria-hidden />
                </button>
              ) : <span>{l.text}</span>}
            </dd>
          </div>
        ))}
      </dl>
      <OpMap rows={rows} frames={frames} alert={alerts} />
      </div>
    </section>
  );
}
