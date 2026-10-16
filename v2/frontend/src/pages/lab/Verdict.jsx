// 01 / Verdict: the engine verdict, shown once on the page in large type, with why it is believable
// (model agreement this second, persistence over the last 5 s, how long it has held) and what to do.
import { Status } from '../../components/ui.jsx';
import { engineAlert } from './labStore.js';
import { agreement, duration, onset, persistence } from './derive.js';

const TONE = { critical: 'var(--p1)', warning: 'var(--p2)' };     // alarm colour only for an alarm

export default function Verdict({ latest, frames }) {
  const { engine, row, alerts } = latest;
  const fault = engine.fault ?? 'healthy';
  const isFault = fault !== 'healthy';
  const { agree, total } = agreement(engine);
  const { hits, of } = persistence(frames, fault);
  const start = onset(frames, fault);
  const held = start ? row.clock - start.clock + 1 : null;
  const alert = engineAlert(alerts);

  const credibility = [
    isFault ? `${agree}/${total} models agree this second` : `${agree}/${total} models pick ${engine.status === 'info' ? 'no fault' : 'healthy'} this second`,
    of > 0 && (isFault ? `fault in ${hits} of the last ${of} s` : `no fault confirmed in ${hits} of the last ${of} s`),
    // 'early': the run reaches the oldest second this browser has kept, so it may be older still
    held != null && isFault && `confirmed for ${start.early ? 'at least ' : ''}${duration(held)}`,
  ].filter(Boolean);

  return (
    <section className="panel panel-pad lab-verdict" aria-labelledby="lab-verdict-title">
      <div className="row">
        <h2 className="eyebrow lab-eyebrow" id="lab-verdict-title"><span className="num">01</span> / Verdict · last 5 s</h2>
        <div className="spacer" />
        <Status status={engine.status} />
      </div>
      <p className="lab-verdict__label" style={TONE[engine.status] ? { color: TONE[engine.status] } : undefined} aria-live="polite">
        {engine.label}
      </p>
      <p className="lab-verdict__why">{credibility.join(' · ')}</p>
      {alert?.actions?.[0] && (
        <p className="lab-verdict__act"><span className="label">Do now</span>{alert.actions[0]}</p>
      )}
      {!isFault && engine.status === 'ok' && (
        <p className="lab-verdict__act lab-verdict__act--quiet">Nothing to do. The models and this car's own normal both read healthy.</p>
      )}
    </section>
  );
}
