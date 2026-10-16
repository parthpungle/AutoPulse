// 02 / Detectors: the two independent detectors side by side, each against its own threshold, so the
// verdict and the deviation chart can never seem to contradict each other (SIGNATURE_LAB_PLAN.md §1.5).
import { Wrench } from 'lucide-react';
import { contextWords, faultShare } from './derive.js';

/** A labelled 0..max bar with a threshold tick; the fill turns to the excess tone above it. */
function Meter({ value, max, threshold, label, fmt }) {
  const pct = (v) => `${(Math.min(max, Math.max(0, v)) / max) * 100}%`;
  const over = value >= threshold;
  return (
    <div className="lab-meter" role="meter" aria-label={label} aria-valuemin={0} aria-valuemax={max} aria-valuenow={Number(value.toFixed(2))}>
      <div className="lab-meter__track">
        <div className="lab-meter__fill" style={{ width: pct(value), background: over ? 'var(--lab-excess)' : 'var(--trace)' }} />
        <div className="lab-meter__tick" style={{ left: pct(threshold) }} />
      </div>
      <span className="num lab-meter__value">{fmt(value)}<span className="lab-meter__of"> / {fmt(threshold)}</span></span>
    </div>
  );
}

export default function Detectors({ engine, onServiced }) {
  const share = faultShare(engine);
  const dev = engine.anomaly ?? 0;
  const confirmed = engine.fault && engine.fault !== 'healthy';
  const devOver = dev >= engine.threshold;

  let note;
  if (confirmed && !devOver) note = 'The classifier has confirmed a fault while the deviation is below its threshold. They measure different things, so both can be true.';
  else if (!confirmed && engine.status === 'info') note = 'The deviation has been above its threshold for 3 s while the classifier names no fault, so the verdict is an advisory, not an alarm.';
  else if (!confirmed && devOver) note = 'The deviation is above its threshold but the classifier names no fault. If it stays above for 3 s, the verdict becomes an advisory.';
  else if (confirmed) note = 'Both detectors see it: the classifier names the fault and the sound is outside this car\'s normal.';
  else note = 'Both detectors read normal.';

  return (
    <section className="panel panel-pad lab-detectors" aria-labelledby="lab-detectors-title">
      <h2 className="eyebrow lab-eyebrow" id="lab-detectors-title"><span className="num">02</span> / Detectors</h2>

      <div className="lab-det">
        <div className="lab-det__head">
          <b>Classifier</b>
          <span className="muted">raises the alarm</span>
        </div>
        <Meter value={share} max={1} threshold={0.5} label="Classifier: largest fault share" fmt={(v) => v.toFixed(2)} />
        <p className="lab-det__def">Largest fault share of the 4 models' vote, averaged over 5 s. A fault is confirmed at 0.50 or more for 2 s in a row.</p>
      </div>

      <div className="lab-det">
        <div className="lab-det__head">
          <b>Deviation from this car's normal</b>
          <span className="muted">advisory only</span>
        </div>
        <Meter value={dev} max={10} threshold={engine.threshold} label="Deviation from this car's normal" fmt={(v) => v.toFixed(1)} />
        <p className="lab-det__def">
          RMS of the 5 largest feature z-scores against what this car sounded like when healthy (max 10).
          Normal for <b>{contextWords(engine.context).toLowerCase()}</b>, learned from {engine.learned} healthy s.
        </p>
      </div>

      <p className="lab-det__note">{note}</p>
      <button className="btn ghost" onClick={onServiced} title="Forget the learned normal, e.g. after a service">
        <Wrench size={15} />Mark serviced
      </button>
    </section>
  );
}
