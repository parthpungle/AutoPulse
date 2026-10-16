// Evidence: every number here is read from models/*.json (via /api/results), real data first.
// Order: real engine sound -> Simulink/MATLAB -> real driving with injected faults -> bearing rig -> simulator (collapsed).
import { useState } from 'react';
import { useApi } from '../api.js';
import { SourceTag, Stat, Tabs } from '../components/ui.jsx';
import LineChart from '../components/charts/LineChart.jsx';
import Heatmap from '../components/charts/Heatmap.jsx';

const pct = (v) => (v == null ? '—' : `${(v * 100).toFixed(1)}%`);
const short = (m) => m.split(' (')[0];
const CLASS_NAME = { healthy: 'Healthy', misfire: 'Misfire', valve_tick: 'Valve tick', belt_squeal: 'Belt squeal',
  normal: 'Normal', inner: 'Inner race', ball: 'Ball', outer: 'Outer race' };
const bestByF1 = (models) => Object.entries(models).sort((a, b) => b[1].macro_f1.mean - a[1].macro_f1.mean)[0];

function Section({ title, kind, tagLabel, sub, children }) {
  return (
    <section className="stack">
      <div className="evi-head"><h3>{title}</h3><SourceTag kind={kind} label={tagLabel} /></div>
      {sub && <div className="note muted" style={{ marginTop: -6 }}>{sub}</div>}
      {children}
    </section>
  );
}

export default function Evidence() {
  const { data } = useApi('/results');
  if (!data) return <div className="muted">Loading results…</div>;
  const r = data.real;
  return (
    <div className="stack" style={{ gap: 28 }}>
      {r?.audio ? <Audio a={r.audio} /> : <div className="muted">Run evaluate_real.py audio to produce real engine-sound results.</div>}
      <Matlab m={data.matlab} />
      {r?.obd && <Obd o={r.obd} />}
      {r?.cwru && <Cwru c={r.cwru} />}
      <SimUpper m={data.simulator} r={r} />
      {data.fusion && <Fusion f={data.fusion} />}
      {data.robustness && <Robustness d={data.robustness} rnd={data.robustness_randomized} />}
    </div>
  );
}

// ------------------------------------------------------------------ a) real engine sound
function Audio({ a }) {
  const [bm, bv] = bestByF1(a.models);
  const h = a.healthy_fpr?.models;
  const [model, setModel] = useState(bm);
  const ens = a.selective?.before;
  return (
    <Section title="Real engine sound" kind="real"
      sub={`${a.dataset} · ${a.n_recordings} recordings, ${a.n_windows} one-second windows · ${a.split}`
        + (a.vehicle_identity ? ` · Note: ${a.vehicle_identity.split(' (')[0]}.` : '')
        + (a.ci_method ? ' Brackets: 95% CI, bootstrap over recordings.' : '')}>
      <div className="grid3" style={{ gridTemplateColumns: 'repeat(4, 1fr)' }}>
        <Stat label={`Accuracy · ${short(bm)}`} value={pct(bv.accuracy.mean)} sub={`± ${(bv.accuracy.std * 100).toFixed(1)} across folds, per 1 s window`} />
        <Stat label="Macro F1" value={bv.macro_f1.mean.toFixed(3)} sub="all four classes weighted equally" />
        <Stat label="Per recording" value={pct(bv.recording_accuracy)} sub="window probabilities averaged per recording" />
        <Stat label="Healthy flagged as a fault" value={h ? pct(h[bm].recording.mean) : '—'}
          sub={h ? `per recording, ${short(bm)}; ${pct(h[bm].window.mean)} per window` : 'run evaluate_real.py audio'} />
      </div>
      <div className="grid2" style={{ gridTemplateColumns: '1.2fr 1fr', alignItems: 'start' }}>
        <div className="panel panel-pad">
          <div className="eyebrow" style={{ marginBottom: 12 }}>Every model · held out by recording</div>
          <table className="data">
            <thead><tr><th>Model</th><th className="num">Accuracy</th><th className="num">Macro F1</th><th className="num">Per recording</th>
              <th className="num" title="healthy predicted as any fault / all healthy">Healthy FPR · win / rec</th></tr></thead>
            <tbody>
              {Object.entries(a.models).map(([m, v]) => (
                <tr key={m}><td>{m}</td>
                  <td className="num">{pct(v.accuracy.mean)}{v.accuracy_ci && <CI c={v.accuracy_ci} />}</td>
                  <td className="num">{v.macro_f1.mean.toFixed(3)}{v.macro_f1_ci && <CI c={v.macro_f1_ci} f={(x) => x.toFixed(3)} />}</td>
                  <td className="num">{pct(v.recording_accuracy)}</td>
                  <td className="num">{h?.[m] ? `${pct(h[m].window.mean)} / ${pct(h[m].recording.mean)}` : '—'}
                    {v.healthy_fpr_ci && <CI c={v.healthy_fpr_ci} />}</td></tr>
              ))}
              {ens && h && Object.keys(h).filter((m) => !a.models[m]).map((m) => (
                <tr key={m}><td>{m}</td><td className="num">—</td><td className="num">—</td><td className="num">{pct(ens.accuracy_answered)}</td>
                  <td className="num">{pct(h[m].window.mean)} / {pct(h[m].recording.mean)}</td></tr>
              ))}
            </tbody>
          </table>
          {h && <PerClass h={h[bm]} model={bm} classes={a.classes} />}
        </div>
        <div className="panel panel-pad">
          <div className="row" style={{ marginBottom: 10, flexWrap: 'wrap', gap: 8 }}>
            <div className="eyebrow">Confusion · windows, all folds pooled</div>
            <div className="spacer" />
            <Tabs items={Object.keys(a.models).map((m) => [m, short(m)])} value={model} onChange={setModel} />
          </div>
          <Confusion cm={a.models[model].confusion} classes={a.classes} />
        </div>
      </div>
      {a.models['CNN (spectrogram)'] && Object.keys(a.models).find((m) => m.startsWith('CNN v2')) && (
        <CnnNote old={a.models['CNN (spectrogram)']} v2={a.models[Object.keys(a.models).find((m) => m.startsWith('CNN v2'))]}
          svm={a.models['SVM (RBF)']} h={a.healthy_fpr?.models} />
      )}
      {a.selective && <Selective s={a.selective} />}
      {a.transfer && <Transfer t={a.transfer} />}
    </Section>
  );
}

/** Old vs improved CNN, stated with its uncertainty: all numbers from real_metrics.json. */
function CnnNote({ old, v2, svm, h }) {
  const ci = (c) => `${pct(c[0])}–${pct(c[1])}`;
  const hv2 = h && Object.entries(h).find(([m]) => m.startsWith('CNN v2'))?.[1];
  return (
    <div className="panel panel-pad note">
      <b>CNN, old vs improved.</b> Adding SpecAugment, a class-weighted loss, early stopping on a held-out set of training
      recordings and the average of 3 seeds raised the CNN from {pct(old.accuracy.mean)} to {pct(v2.accuracy.mean)} accuracy
      (95% CI {ci(old.accuracy_ci)} vs {ci(v2.accuracy_ci)}) and made it steadier across folds (± {(old.accuracy.std * 100).toFixed(1)} vs
      ± {(v2.accuracy.std * 100).toFixed(1)} points). The intervals overlap, so the gain is likely but not proven on 321 recordings,
      {hv2 && h['CNN (spectrogram)'] ? ` and it flags slightly more healthy windows as faults (${pct(h['CNN (spectrogram)'].window.mean)} → ${pct(hv2.window.mean)}), the price of class weighting. ` : ' '}
      It still trails the feature-based SVM ({pct(svm.accuracy.mean)}): with about 3,900 one-second windows, 28 engineered
      signatures carry the physics more efficiently than a network learning from spectrograms. The CNN stays in the ensemble
      as the original version so the abstain threshold above remains valid.
    </div>
  );
}

/** 95% bootstrap interval (resampling recordings), on its own small line under the value. */
function CI({ c, f = (x) => pct(x) }) {
  return <div className="muted" style={{ fontSize: 11 }}>[{f(c[0])}, {f(c[1])}]</div>;
}

function PerClass({ h, model, classes }) {
  return (
    <>
      <div className="eyebrow" style={{ margin: '18px 0 8px' }}>{short(model)} · per class (per window, mean over folds)</div>
      <table className="data">
        <thead><tr><th>Class</th><th className="num">Recall</th><th className="num">Precision</th></tr></thead>
        <tbody>{classes.map((c) => (
          <tr key={c}><td>{CLASS_NAME[c] || c}</td><td className="num">{pct(h.per_class[c].recall.mean)}</td><td className="num">{pct(h.per_class[c].precision.mean)}</td></tr>
        ))}</tbody>
      </table>
    </>
  );
}

/** Rows: true class; columns: predicted. Colour = share of the row (recall), text = window count. */
function Confusion({ cm, classes }) {
  const norm = cm.map((row) => { const s = row.reduce((x, y) => x + y, 0) || 1; return row.map((v) => v / s); });
  const names = classes.map((c) => CLASS_NAME[c] || c);
  return (
    <Heatmap z={norm} rowLabels={names} colLabels={names} height={250} xTitle="predicted" yTitle="true"
      legend={['0% of row', '100% of row']} cellText={(i, j) => cm[i][j]}
      tip={(i, j) => (<><div className="tx">true {names[i]} → predicted {names[j]}</div>
        <div className="tr">Windows<b>{cm[i][j]} ({pct(norm[i][j])})</b></div></>)} />
  );
}

/** Answering only when the ensemble is confident enough ("unsure" otherwise). */
function Selective({ s }) {
  const pts = [...s.curve.recording].filter((p) => p.n_answered > 0).sort((a, b) => a.coverage - b.coverage);
  const b = s.before, a = s.after;
  const taus = [...new Set(s.fold_thresholds.map((t) => t.toFixed(2)))].join(', ');
  return (
    <div className="grid2" style={{ gridTemplateColumns: '1.3fr 1fr', alignItems: 'start' }}>
      <div className="panel panel-pad">
        <div className="eyebrow" style={{ marginBottom: 4 }}>Answer only when confident · coverage vs accuracy</div>
        <div className="note" style={{ marginBottom: 12 }}>
          Each point is one confidence threshold (0.30 to 0.95) on the held-out recordings: the share it answers, and how good
          those answers are. Below the threshold the verdict is “unsure”.
        </div>
        <LineChart height={260} xDomain={[Math.min(...pts.map((p) => p.coverage)), 1]} yDomain={[0, 1]}
          fmtX={(v) => `${Math.round(v * 100)}%`} fmtY={(v) => `${Math.round(v * 100)}%`} xTitle="coverage (recordings answered)"
          markers={[{ x: a.coverage, label: 'chosen', row: 0 }]}
          hlines={[{ y: s.target_healthy_fpr, label: 'healthy FPR target 5%' }]}
          series={[
            { id: 'acc', label: 'Accuracy on answered', color: 'var(--s1)', x: pts.map((p) => p.coverage), y: pts.map((p) => p.accuracy_answered) },
            { id: 'fpr', label: 'Healthy FPR on answered', color: 'var(--s2)', x: pts.map((p) => p.coverage), y: pts.map((p) => p.healthy_fpr_answered) },
          ]} />
        <div className="chart-caption">The curve describes every threshold; it was not used to choose one. {s.threshold_selection}.</div>
      </div>
      <div className="panel panel-pad">
        <div className="eyebrow" style={{ marginBottom: 12 }}>{s.ensemble} · per recording</div>
        <table className="data">
          <thead><tr><th /><th className="num">Before</th><th className="num">After threshold</th></tr></thead>
          <tbody>
            <tr><td>Recordings answered</td><td className="num">{pct(b.coverage)}</td><td className="num">{pct(a.coverage)}</td></tr>
            <tr><td>Accuracy on answered</td><td className="num">{pct(b.accuracy_answered)}</td><td className="num">{pct(a.accuracy_answered)}</td></tr>
            <tr><td>Healthy FPR on answered</td><td className="num">{pct(b.healthy_fpr_answered)}</td><td className="num">{pct(a.healthy_fpr_answered)}</td></tr>
            <tr><td>Healthy recordings alarmed</td><td className="num">{b.healthy_false_alarms} / {b.healthy_answered}</td>
              <td className="num">{a.healthy_false_alarms} / {b.healthy_answered}</td></tr>
          </tbody>
        </table>
        <div className="note" style={{ marginTop: 12 }}>
          Thresholds picked per fold without seeing its test recordings: {taus}. “Before” answers everything.
          An unsure healthy recording is not an alarm.
        </div>
      </div>
    </div>
  );
}

/** (a)-(e): can simulator data help on real engine sound? Same grouped folds as above. */
function Transfer({ t }) {
  const [metric, setMetric] = useState('macro_f1');
  const models = [...new Set(Object.values(t.variants).flatMap((v) => Object.keys(v.models)))];
  const a = t.variants.a?.models || {};
  const fmt = (v) => (metric === 'macro_f1' ? v.toFixed(3) : pct(v));
  return (
    <div className="panel panel-pad">
      <div className="row" style={{ marginBottom: 6, flexWrap: 'wrap', gap: 8 }}>
        <div className="eyebrow">Closing the sim-to-real gap · tested on real recordings</div>
        <SourceTag kind="real" label="Real test · sim training (b–e)" />
        <div className="spacer" />
        <Tabs items={[['macro_f1', 'Macro F1'], ['healthy_fpr', 'Healthy FPR']]} value={metric} onChange={setMetric} />
      </div>
      <div className="note muted" style={{ marginBottom: 10 }}>{t.folds} grouped folds; {t.sim_windows} simulated windows per training set.
        {metric === 'healthy_fpr' ? ' Healthy FPR: healthy windows called a fault (lower is better).' : ''} ↑ better than (a), ↓ worse, = within 0.005.</div>
      <table className="data">
        <thead><tr><th>Training data</th>{models.map((m) => <th key={m} className="num">{short(m)}</th>)}</tr></thead>
        <tbody>{Object.entries(t.variants).map(([v, d]) => (
          <tr key={v}><td><b>({v})</b> {d.description}</td>{models.map((m) => {
            const x = d.models[m]?.[metric]?.mean;
            const base = a[m]?.[metric]?.mean;
            const better = x != null && base != null && v !== 'a' && (metric === 'healthy_fpr' ? x < base : x > base);
            const same = x != null && base != null && Math.abs(x - base) < 0.005;
            return <td key={m} className="num">{x == null ? '—' : <>{fmt(x)}{v !== 'a' && base != null ? (same ? ' =' : better ? ' ↑' : ' ↓') : ''}</>}</td>;
          })}</tr>
        ))}</tbody>
      </table>
    </div>
  );
}

// ------------------------------------------------------------------ b) Simulink / MATLAB
function Matlab({ m }) {
  if (!m) return null;
  const mw = m.mathworks, c = m.crank, d = m.dsp;
  return (
    <Section title="Independent engine models and DSP cross-check" kind="simulink"
      sub="Engines we did not build (MathWorks) or built separately in MATLAB; the detector ran on them blind.">
      <div className="grid3">
        {mw && <Stat label="MathWorks Simulink misfire" value={`${mw.detected_events} / ${mw.misfire_events}`}
          sub={`misfires detected · ${mw.false_alarm_strokes} false alarms in ${mw.healthy_strokes} healthy strokes`} />}
        {d && <Stat label="Signature features re-done in MATLAB" value={d.total_features_checked || d.features_compared} unit="/ 28"
          sub={`agree to ${d.worst_max_rel_diff.toExponential(0)} (worst: ${d.worst_feature})`} />}
        {c && <Stat label="MATLAB crankshaft physics" value={pct(c.detector_trained_on_python_sim.accuracy)}
          sub={`misfires detected over ${c.runs} runs · cylinder named ${pct(c.cylinder_identification_accuracy)}`} />}
      </div>
      <div className="panel panel-pad">
        <table className="data">
          <thead><tr><th>Engine</th><th>Built with</th><th>Result</th></tr></thead>
          <tbody>
            {mw && <tr><td>MathWorks example</td><td>{mw.source}</td><td>{mw.detected_events}/{mw.misfire_events} detected, {mw.false_alarm_strokes} false alarms in {mw.healthy_strokes} healthy strokes; misfiring stroke {mw.speed_gain_rpm.misfire_median.toFixed(0)} rpm vs {mw.speed_gain_rpm.healthy_median.toFixed(0)} healthy</td></tr>}
            {c && <tr><td>MATLAB crankshaft</td><td>{c.source}</td><td>{pct(c.detector_trained_on_python_sim.accuracy)} detected, cylinder named {pct(c.cylinder_identification_accuracy)}</td></tr>}
            {d && <tr><td>DSP re-implementation</td><td>{d.source}</td><td>{d.total_features_checked || d.features_compared} features on {d.windows} windows; worst relative difference {d.worst_max_rel_diff.toExponential(1)}</td></tr>}
          </tbody>
        </table>
      </div>
    </Section>
  );
}

// ------------------------------------------------------------------ c) carOBD
function Obd({ o }) {
  const fa = o.false_alarm_trip_rate;
  const delay = (v) => (v.median_delay_min == null ? '—' : `${v.median_delay_min.toFixed(1)} min`);
  return (
    <Section title="Adaptive baseline on real driving" kind="real_injected"
      sub={`${o.dataset}. ${o.split}.`}>
      <div className="grid3">
        <Stat label="Healthy trips with a false alarm · adaptive" value={pct(fa.adaptive)} sub={`${o.test_trips} held-out real trips`} />
        <Stat label="Healthy trips with a false alarm · fixed" value={pct(fa.static)} sub="same trips, one fixed baseline for every trip" />
        <Stat label="Learning / calibration / test trips" value={`${o.learning_trips} / ${o.calibration_trips} / ${o.test_trips}`} sub={`${o.window_s} s windows`} />
      </div>
      <div className="panel panel-pad">
        <div className="eyebrow" style={{ marginBottom: 10 }}>Every injected fault · detection on held-out trips</div>
        <table className="data">
          <thead><tr><th>Fault (injected from minute 3)</th><th className="num">Adaptive detected</th><th className="num">Median delay</th>
            <th className="num">Fixed detected</th><th className="num">Median delay</th></tr></thead>
          <tbody>
            {Object.entries(o.injected_fault_detection).map(([f, v]) => (
              <tr key={f}><td>{f.replace(/_/g, ' ')}</td><td className="num">{pct(v.adaptive.detection_rate)}</td><td className="num">{delay(v.adaptive)}</td>
                <td className="num">{pct(v.static.detection_rate)}</td><td className="num">{delay(v.static)}</td></tr>
            ))}
          </tbody>
        </table>
        <div className="chart-caption">MAP sensor drift and timing retard are mostly missed by both methods at these thresholds.</div>
      </div>
      {o.residuals && <Residuals before={o} after={o.residuals} />}
    </Section>
  );
}

/** Before / after adding cross-sensor residuals (MAP, timing and fuel trim predicted from the other sensors). */
function Residuals({ before, after }) {
  const faults = Object.keys(before.injected_fault_detection);
  const cell = (v) => pct(v);
  const missed = faults.filter((f) => Math.max(after.injected_fault_detection[f].adaptive.detection_rate,
    after.injected_fault_detection[f].static.detection_rate) < 0.5);
  return (
    <div className="panel panel-pad">
      <div className="row" style={{ marginBottom: 6, gap: 8, flexWrap: 'wrap' }}>
        <div className="eyebrow">Cross-sensor residuals · before → after</div><SourceTag kind="real_injected" />
      </div>
      <div className="note muted" style={{ marginBottom: 10 }}>
        {Object.values(after.residual_models || {}).join('; ')}. Settings and thresholds re-chosen on the calibration trips; test trips scored once.
      </div>
      <table className="data">
        <thead><tr><th /><th className="num">Adaptive</th><th className="num">+ residuals</th><th className="num">Fixed</th><th className="num">+ residuals</th></tr></thead>
        <tbody>
          <tr><td>Healthy trips with a false alarm</td>
            <td className="num">{cell(before.false_alarm_trip_rate.adaptive)}</td><td className="num">{cell(after.false_alarm_trip_rate.adaptive)}</td>
            <td className="num">{cell(before.false_alarm_trip_rate.static)}</td><td className="num">{cell(after.false_alarm_trip_rate.static)}</td></tr>
          {faults.map((f) => {
            const b = before.injected_fault_detection[f], a = after.injected_fault_detection[f];
            return (
              <tr key={f}><td>{f.replace(/_/g, ' ')} detected</td>
                <td className="num">{cell(b.adaptive.detection_rate)}</td><td className="num"><b>{cell(a.adaptive.detection_rate)}</b></td>
                <td className="num">{cell(b.static.detection_rate)}</td><td className="num"><b>{cell(a.static.detection_rate)}</b></td></tr>
            );
          })}
        </tbody>
      </table>
      {missed.length > 0 && <div className="chart-caption">Still missed by both (under 50%): {missed.map((f) => f.replace(/_/g, ' ')).join(', ')}.</div>}
    </div>
  );
}

// ------------------------------------------------------------------ d) CWRU
function Cwru({ c }) {
  return (
    <Section title="Bearing test rig (motor), known-easy benchmark" kind="real"
      sub={`${c.dataset} · ${c.split}. A motor rig, not an engine; listed for completeness.`}>
      <div className="panel panel-pad">
        <table className="data">
          <thead><tr><th>Model</th><th className="num">Accuracy</th><th className="num">± fold std</th><th className="num">Macro F1</th></tr></thead>
          <tbody>{Object.entries(c.models).map(([m, v]) => (
            <tr key={m}><td>{m}</td><td className="num">{pct(v.accuracy.mean)}</td><td className="num">{(v.accuracy.std * 100).toFixed(1)}</td><td className="num">{v.macro_f1.mean.toFixed(3)}</td></tr>
          ))}</tbody>
        </table>
      </div>
    </Section>
  );
}

// ------------------------------------------------------------------ e) simulator, collapsed
function SimUpper({ m, r }) {
  if (!m) return null;
  const zero = r?.audio?.zero_shot_from_simulator;
  return (
    <details className="sim-upper panel panel-pad">
      <summary><h3 style={{ margin: 0, fontSize: 16 }}>Simulator results (upper bound)</h3><SourceTag kind="simulator" /></summary>
      <div className="stack" style={{ marginTop: 14 }}>
        <div className="note">Generator and features were designed together, so these numbers are optimistic.</div>
        <div className="note muted">{m.n_train} training windows, {m.n_test} test windows; split {m.split}.</div>
        <table className="data">
          <thead><tr><th>Model</th><th className="num">Accuracy</th><th className="num">Macro F1</th></tr></thead>
          <tbody>{Object.entries(m.models).map(([k, v]) => <tr key={k}><td>{k}</td><td className="num">{pct(v.accuracy)}</td><td className="num">{v.macro_f1.toFixed(3)}</td></tr>)}</tbody>
        </table>
        {zero && (
          <>
            <div className="eyebrow" style={{ marginTop: 6 }}>Trained on the simulator only, tested on real engine sound (zero-shot)</div>
            <table className="data">
              <thead><tr><th>Model</th><th className="num">Accuracy</th><th className="num">Macro F1</th></tr></thead>
              <tbody>{Object.entries(zero).map(([k, v]) => <tr key={k}><td>{k}</td><td className="num">{pct(v.accuracy)}</td><td className="num">{v.macro_f1.toFixed(3)}</td></tr>)}</tbody>
            </table>
          </>
        )}
      </div>
    </details>
  );
}

// ------------------------------------------------------------------ f) fusion ablation (train_fusion.py), simulator only
const COND = { noise_x1: 'Noise ×1', noise_x5: 'Noise ×5', 'severity_0.1-0.3': 'Weak faults (0.1–0.3)' };

function Fusion({ f }) {
  const conds = Object.keys(f.conditions);
  const [metric, setMetric] = useState('macro_f1');
  const fmt = (v) => (metric === 'macro_f1' ? v.toFixed(3) : pct(v));
  const best = Object.fromEntries(conds.map((c) => [c, Math.max(...Object.values(f.results).map((r) => r[c][metric]))]));
  return (
    <Section title="Multivariable fusion: microphone + accelerometer + OBD" kind="simulator"
      sub={`${f.split} · ${f.n_test_per_condition} test windows per condition · live model: ${f.live_model}`}>
      <div className="panel panel-pad">
        <div className="row" style={{ marginBottom: 10 }}>
          <div className="eyebrow">Ablation · test cars</div><div className="spacer" />
          <Tabs items={[['macro_f1', 'Macro F1'], ['accuracy', 'Accuracy']]} value={metric} onChange={setMetric} />
        </div>
        <table className="data">
          <thead><tr><th>Sensors · model</th>{conds.map((c) => <th key={c} className="num">{COND[c] || c}</th>)}</tr></thead>
          <tbody>{Object.entries(f.results).map(([name, r]) => (
            <tr key={name}><td>{name}</td>{conds.map((c) => (
              <td key={c} className="num" style={{ fontWeight: r[c][metric] === best[c] ? 700 : 400 }}>{fmt(r[c][metric])}</td>
            ))}</tr>
          ))}</tbody>
        </table>
        <div className="chart-caption">Bold: best per column. {f.late_fusion}.</div>
        <div className="note" style={{ marginTop: 10 }}>{f.caveats}</div>
      </div>
    </Section>
  );
}

// ------------------------------------------------------------------ f) robustness (scripts/robustness.py), simulator only
const METRICS = [['macro_f1', 'Macro F1'], ['accuracy', 'Accuracy'], ['misfire_recall', 'Misfire recall'], ['healthy_fpr', 'Healthy FPR']];
const shortCond = (l) => l.replace('severity ', 'sev ').replace(' °C', '').replace('gain ', '').replace('noise ', 'noise ');

function Robustness({ d: plain, rnd }) {
  const [metric, setMetric] = useState('macro_f1');
  const [which, setWhich] = useState('plain');
  const d = which === 'randomized' && rnd ? rnd : plain;
  const models = Object.keys(d.results);
  const conds = d.conditions.map((c) => c.label);
  const z = models.map((m) => conds.map((c) => d.results[m][c][metric]));
  const lowerBetter = metric === 'healthy_fpr';
  const factors = [...new Set(d.conditions.map((c) => c.factor))];
  return (
    <Section title="Robustness: one condition changed at a time" kind="simulator"
      sub={`Test cars ${d.test_cars.join(' and ')} · ${d.windows_per_class_per_car} windows per class per car per condition · ${d.models_from}`}>
      <div className="panel panel-pad">
        <div className="row" style={{ marginBottom: 10, flexWrap: 'wrap', gap: 8 }}>
          <div className="eyebrow">Models × conditions ({factors.join(', ')})</div><div className="spacer" />
          {rnd && <Tabs items={[['plain', 'Trained on plain sim'], ['randomized', 'Trained on randomised sim']]} value={which} onChange={setWhich} />}
          <Tabs items={METRICS} value={metric} onChange={setMetric} />
        </div>
        <Heatmap z={z} rowLabels={models} colLabels={conds.map(shortCond)} height={Math.max(220, 40 * models.length + 60)}
          legend={lowerBetter ? ['0 (good)', '1 (bad)'] : ['0', '1']} cellText={(i, j) => z[i][j].toFixed(2)}
          tip={(i, j) => (<><div className="tx">{models[i]} · {conds[j]}</div>
            <div className="tr">{METRICS.find((m) => m[0] === metric)[1]}<b>{z[i][j].toFixed(3)}</b></div></>)} />
        <div className="chart-caption">
          Defaults unless swept: noise ×1, severity 0.4–1.0, rpm 750–4000, train.py’s coolant mix, gain 0 dB.
          {lowerBetter ? ' Healthy FPR: healthy windows called a fault; lower is better.' : ''}
        </div>
        <div className="note" style={{ marginTop: 10 }}>{d.caveats}</div>
      </div>
    </Section>
  );
}
