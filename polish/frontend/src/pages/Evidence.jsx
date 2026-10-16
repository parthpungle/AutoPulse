import { useState } from 'react';
import { useApi } from '../api.js';
import { Stat, Tabs } from '../components/ui.jsx';

const pct = (v) => `${(v * 100).toFixed(1)}%`;

export default function Evidence() {
  const [tab, setTab] = useState('real');
  const { data } = useApi('/results');
  if (!data) return <div className="muted">Loading results…</div>;
  return (
    <div className="stack">
      <Tabs items={[['real', 'Real data'], ['matlab', 'MATLAB & Simulink'], ['sim', 'Simulator']]} value={tab} onChange={setTab} />
      {tab === 'real' && <Real r={data.real} />}
      {tab === 'matlab' && <Matlab m={data.matlab} />}
      {tab === 'sim' && <Sim m={data.simulator} />}
    </div>
  );
}

function ModelTable({ r, recording }) {
  return (
    <table className="data">
      <thead><tr><th>Model</th><th className="num">Accuracy</th><th className="num">± fold std</th><th className="num">Macro F1</th>{recording && <th className="num">Per recording</th>}</tr></thead>
      <tbody>
        {Object.entries(r.models).map(([m, v]) => (
          <tr key={m}><td>{m}</td><td className="num">{pct(v.accuracy.mean)}</td><td className="num">{(v.accuracy.std * 100).toFixed(1)}</td>
            <td className="num">{v.macro_f1.mean.toFixed(3)}</td>{recording && <td className="num">{pct(v.recording_accuracy)}</td>}</tr>
        ))}
      </tbody>
    </table>
  );
}

function Real({ r }) {
  if (!r) return <div className="muted">Run evaluate_real.py to produce real-data results.</div>;
  const best = (x) => Object.entries(x.models).sort((a, b) => b[1].macro_f1.mean - a[1].macro_f1.mean)[0];
  const [am, av] = best(r.audio);
  const o = r.obd;
  return (
    <>
      <div className="grid3">
        <Stat label="Real engine sound" value={pct(av.accuracy.mean)} sub={`${am.split(' (')[0]} · ${r.audio.n_recordings} recordings held out by recording`} />
        <Stat label="Real bearing vibration" value={pct(best(r.cwru)[1].accuracy.mean)} sub="CWRU, unseen motor load (known easy benchmark)" />
        <Stat label="False-alarm trips · real driving" value={pct(o.false_alarm_trip_rate.adaptive)} sub={`vs ${pct(o.false_alarm_trip_rate.static)} for a fixed baseline (carOBD)`} />
      </div>
      <div className="grid2" style={{ gridTemplateColumns: '1fr 1fr', alignItems: 'start' }}>
        <div className="panel panel-pad">
          <div className="eyebrow" style={{ marginBottom: 4 }}>Engine sound · healthy / misfire / tappet / belt</div>
          <div className="note" style={{ marginBottom: 12 }}>{r.audio.split}</div>
          <ModelTable r={r.audio} recording />
        </div>
        <div className="panel panel-pad">
          <div className="eyebrow" style={{ marginBottom: 4 }}>Adaptive baseline on real driving (carOBD)</div>
          <div className="note" style={{ marginBottom: 12 }}>Faults injected into {o.test_trips} held-out real trips from minute 3.</div>
          <table className="data">
            <thead><tr><th>Fault</th><th className="num">Adaptive</th><th className="num">Fixed</th></tr></thead>
            <tbody>
              {Object.entries(o.injected_fault_detection).map(([f, v]) => (
                <tr key={f}><td>{f.replace(/_/g, ' ')}</td><td className="num">{pct(v.adaptive.detection_rate)}</td><td className="num">{pct(v.static.detection_rate)}</td></tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
      <div className="panel panel-pad note">
        Caveats, stated plainly: the audio set has no car labels, so one car may sit on both sides of a split; models trained only on the
        simulator reach macro F1 {Math.max(...Object.values(r.audio.zero_shot_from_simulator).map((v) => v.macro_f1)).toFixed(2)} on real audio
        (the sim-to-real gap round 2 closes); the public engine-condition table barely beats guessing ({pct(best(r.condition)[1].accuracy.mean)} vs {pct(r.condition.majority_class_accuracy)}), so it is not used as a benchmark.
      </div>
    </>
  );
}

function Matlab({ m }) {
  if (!m) return <div className="muted">Run the MATLAB cross-checks to produce these results.</div>;
  const mw = m.mathworks, c = m.crank, d = m.dsp;
  return (
    <>
      <div className="grid3">
        {mw && <Stat label="MathWorks Simulink engine" value={`${mw.detected_events} / ${mw.misfire_events}`} sub={`misfires found blind · ${mw.false_alarm_strokes} false alarms in ${mw.healthy_strokes} strokes`} />}
        {c && <Stat label="Our MATLAB crank physics" value={pct(c.detector_trained_on_python_sim.accuracy)} sub={`detected · cylinder named ${pct(c.cylinder_identification_accuracy)}`} />}
        {d && <Stat label="Signature features in MATLAB" value={d.total_features_checked || d.features_compared} unit="/ 28" sub={`agree to ${d.worst_max_rel_diff.toExponential(0)}`} />}
      </div>
      <div className="panel panel-pad">
        <div className="eyebrow" style={{ marginBottom: 10 }}>Three independent engines, one misfire signature</div>
        <table className="data">
          <thead><tr><th>Engine</th><th>Built with</th><th>Result</th></tr></thead>
          <tbody>
            <tr><td>Python generator</td><td>Our physics-inspired simulator</td><td>Detector trained here</td></tr>
            {c && <tr><td>MATLAB crankshaft</td><td>matlab/crank_sim.m, ode45</td><td>{pct(c.detector_trained_on_python_sim.accuracy)} detected, cylinder named {pct(c.cylinder_identification_accuracy)}</td></tr>}
            {mw && <tr><td>MathWorks example</td><td>Simulink + Powertrain Blockset (autoblkSICoreOBDMisfire)</td><td>{mw.detected_events}/{mw.misfire_events} detected; misfiring stroke {mw.speed_gain_rpm.misfire_median.toFixed(0)} rpm vs {mw.speed_gain_rpm.healthy_median.toFixed(0)} healthy</td></tr>}
          </tbody>
        </table>
      </div>
    </>
  );
}

function Sim({ m }) {
  if (!m) return null;
  return (
    <div className="panel panel-pad">
      <div className="eyebrow" style={{ marginBottom: 4 }}>Held-out simulated engines (upper bounds)</div>
      <div className="note" style={{ marginBottom: 12 }}>{m.n_train} training windows, {m.n_test} test windows; split {m.split}.</div>
      <table className="data">
        <thead><tr><th>Model</th><th className="num">Accuracy</th><th className="num">Macro F1</th></tr></thead>
        <tbody>{Object.entries(m.models).map(([k, v]) => <tr key={k}><td>{k}</td><td className="num">{pct(v.accuracy)}</td><td className="num">{v.macro_f1.toFixed(3)}</td></tr>)}</tbody>
      </table>
    </div>
  );
}
