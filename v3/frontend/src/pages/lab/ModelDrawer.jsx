// Model details: everything the main view leaves out. Per-model shares this second, the 5 s mean,
// how the vote is smoothed, and each model's held-out test results (GET /api/results).
import { useEffect, useRef } from 'react';
import { X } from 'lucide-react';
import { useApi } from '../../api.js';
import { HBars } from '../../components/charts/Bars.jsx';
import { argmax, shortClass } from './derive.js';

const pct = (v) => `${Math.round(v * 100)}%`;

/** /api/results names models in full ('SVM (RBF)'); the live vote uses 'SVM'. */
const resultFor = (models, name) => Object.entries(models ?? {}).find(([k]) => k.toLowerCase().startsWith(name.toLowerCase()))?.[1];

function recall(confusion, k) {
  const row = confusion?.[k];
  const n = row?.reduce((a, b) => a + b, 0);
  return n ? row[k] / n : null;
}

export default function ModelDrawer({ engine, onClose }) {
  const close = useRef(null);
  const { data } = useApi('/results');
  const sim = data?.simulator;
  const names = Object.keys(engine.votes);
  const k = argmax(engine.ensemble);
  const shown = engine.classes.map((c, i) => ({ label: shortClass(c), value: engine.ensemble[i], emphasis: i === k }))
    .filter((it) => it.value >= 0.01).sort((a, b) => b.value - a.value);

  useEffect(() => {
    const prev = document.activeElement;
    close.current?.focus();
    const onKey = (e) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => { window.removeEventListener('keydown', onKey); prev?.focus?.(); };
  }, [onClose]);

  return (
    <>
      <div className="scrim" onClick={onClose} />
      <aside className="drawer lab-drawer" role="dialog" aria-modal="true" aria-labelledby="lab-drawer-title">
        <div className="row">
          <h2 className="lab-drawer__title" id="lab-drawer-title">Model details</h2>
          <div className="spacer" />
          <button ref={close} className="btn ghost" onClick={onClose} aria-label="Close model details"><X size={15} /></button>
        </div>

        <section>
          <h3 className="eyebrow">Vote · 5 s mean</h3>
          <p className="lab-drawer__note">The four models' shares are averaged, then over the last 5 s. Classes under 1% are hidden.</p>
          <HBars items={shown} />
        </section>

        <section>
          <h3 className="eyebrow">Each model · this second</h3>
          <table className="data lab-votes">
            <thead><tr><th>Class</th>{names.map((m) => <th key={m} className="num">{m}</th>)}</tr></thead>
            <tbody>
              {engine.classes.map((c, i) => (
                <tr key={c}>
                  <td>{shortClass(c)}</td>
                  {names.map((m) => {
                    const p = engine.votes[m];
                    return <td key={m} className={`num${argmax(p) === i ? ' lab-votes__pick' : ''}`}>{pct(p[i])}</td>;
                  })}
                </tr>
              ))}
            </tbody>
          </table>
          <p className="lab-drawer__note">Unsmoothed: one second of vibration each. Each model's pick is in bold.</p>
        </section>

        <section>
          <h3 className="eyebrow">Held-out test · simulator</h3>
          {!sim ? <p className="muted">Loading results…</p> : (
            <>
              <table className="data">
                <thead><tr><th>Model</th><th className="num">Accuracy</th><th className="num">Macro F1</th><th className="num">Recall · {shortClass(engine.classes[k])}</th></tr></thead>
                <tbody>
                  {names.map((m) => {
                    const r = resultFor(sim.models, m);
                    const rc = r && recall(r.confusion, k);
                    return (
                      <tr key={m}><td>{m}</td>
                        <td className="num">{r ? pct(r.accuracy) : '–'}</td>
                        <td className="num">{r ? r.macro_f1.toFixed(2) : '–'}</td>
                        <td className="num">{rc == null ? '–' : pct(rc)}</td></tr>
                    );
                  })}
                </tbody>
              </table>
              <p className="lab-drawer__note">{sim.n_test} test windows, {sim.split}. Not measured on this car.</p>
            </>
          )}
        </section>
      </aside>
    </>
  );
}
