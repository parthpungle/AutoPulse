// Signature lab · Real clip (from Parth's branch): upload or record up to 30 s of a real engine, or play a sample.
// Classified by the models trained on real recordings only (train_real.py → models/real_audio/), window by window.
import { useRef, useState } from 'react';
import { AudioLines, Mic, Upload } from 'lucide-react';
import LineChart from '../components/charts/LineChart.jsx';
import Heatmap from '../components/charts/Heatmap.jsx';
import { HBars, VBars } from '../components/charts/Bars.jsx';
import { Status, Tabs } from '../components/ui.jsx';
import { classifyAudio, useApi } from '../api.js';
import { record, toWav } from '../audio.js';

const VIEWS = [
  ['time', 'Waveform'], ['spectrum', 'Spectrum'], ['spectrogram', 'Spectrogram'],
  ['envelope', 'Envelope'], ['orders', 'Orders'], ['crank', 'Crank speed'],
];
const WHY = {
  time: 'One impulse per firing. Knock adds a sharp ring after each one; valve wear adds a click once per cycle.',
  spectrum: 'Where the energy sits. Knock lifts the 5.5–8 kHz band; belt squeal is a narrow tone at 2.5–3.5 kHz.',
  spectrogram: 'How the spectrum changes inside one second. This image is what the CNN looks at.',
  envelope: 'How often impacts repeat. A bearing defect shows as a peak at its defect frequency.',
  orders: 'Energy at multiples of crank speed. 0.5× rises with misfire, 1× with imbalance; 2× is normal firing.',
  crank: 'Speed change on every firing. A misfiring cylinder stops pushing, so the crank slows on its turn.',
};

// ------------------------------------------------------------------ a real recording, uploaded or recorded
const NAMES = { healthy: 'Healthy', misfire: 'Misfire', valve_tick: 'Valve tick', belt_squeal: 'Belt squeal', unsure: 'Unsure' };
const COLORS = { healthy: 'var(--good)', misfire: 'var(--critical)', valve_tick: 'var(--warning)', belt_squeal: 'var(--s1)' };
const SAMPLES = [['healthy_071', 'Healthy idle'], ['misfire_072', 'Misfire'], ['belt_issue_031', 'Belt squeal']];
const SERVER_DECODES = /\.(wav|flac|ogg)$/i;
const MAX_S = 30;

export default function RealClip() {
  const metaReq = useApi('/real-audio');
  const meta = metaReq.data;
  const [res, setRes] = useState(null);
  const [src, setSrc] = useState(null);           // { name, sample }
  const [busy, setBusy] = useState(null);
  const [err, setErr] = useState(null);
  const [rec, setRec] = useState(null);           // { left, level } while recording
  const [view, setView] = useState('spectrum');
  const fileRef = useRef(null);

  async function run(blob, name, sample = false) {
    setErr(null); setBusy('Classifying…');
    try {
      let out;
      if (SERVER_DECODES.test(name)) {
        try {
          out = await classifyAudio(blob, name);
        } catch (e) {
          if (e.status !== 415) throw e;           // the server cannot read it: let the browser decode it instead
        }
      }
      if (!out) {
        setBusy('Decoding in the browser…');
        const { wav, seconds } = await toWav(blob);
        if (seconds > MAX_S) throw new Error(`The clip is ${Math.round(seconds)} s long; the limit is ${MAX_S} s.`);
        setBusy('Classifying…');
        out = await classifyAudio(wav, name.replace(/\.[^.]*$/, '') + '.wav');
      }
      setRes(out); setSrc({ name, sample });
    } catch (e) {
      setErr(e.name === 'EncodingError' ? 'The browser could not decode this file.' : e.message);
    } finally {
      setBusy(null);
    }
  }

  async function onRecord() {
    setErr(null);
    try {
      setRec({ left: 10, level: 0 });
      const blob = await record(10, setRec);
      setRec(null);
      await run(blob, 'microphone.webm');
    } catch (e) {
      setRec(null);
      setErr(e.name === 'NotAllowedError' ? 'Microphone permission was denied.' : e.message);
    }
  }

  const sample = async (id) => {
    const r = await fetch(`/samples/${id}.wav`);
    await run(await r.blob(), `${id}.wav`, true);
  };

  return (
    <div className="stack">
      <div className="panel panel-pad">
        <div className="row" style={{ gap: 10, flexWrap: 'wrap' }}>
          <button className="btn primary" disabled={!!busy || !!rec} onClick={() => fileRef.current.click()}><Upload size={15} />Upload audio</button>
          <input ref={fileRef} type="file" hidden accept=".wav,.mp3,.webm,.ogg,.m4a,audio/*"
            onChange={(e) => { const f = e.target.files[0]; e.target.value = ''; if (f) run(f, f.name); }} />
          <button className="btn" disabled={!!busy || !!rec} onClick={onRecord}><Mic size={15} />Record 10 s</button>
          <span className="note muted" style={{ marginLeft: 6 }}>Try a sample:</span>
          {SAMPLES.map(([id, label]) => (
            <button key={id} className="btn ghost" disabled={!!busy || !!rec} onClick={() => sample(id)}><AudioLines size={15} />{label}</button>
          ))}
          <div className="spacer" />
          {meta && <span className="chip" title={`${meta.source} · ${meta.n_windows} windows · trained ${meta.trained_at}`}>
            Real-audio models · trained on {meta.n_recordings} real recordings</span>}
          {!metaReq.loading && !meta && <span className="chip">Real-audio models not trained: run train_real.py</span>}
        </div>
        {rec && (
          <div className="row" style={{ gap: 12, marginTop: 14 }}>
            <span className="live-tag" style={{ color: 'var(--critical)' }}>recording · {Math.ceil(rec.left)} s</span>
            <div className="meter" style={{ flex: 1, maxWidth: 360 }}>
              <div style={{ width: `${Math.max(1, rec.level * 100)}%`, background: rec.level > 0.9 ? 'var(--critical)' : 'var(--good)', transition: 'width 50ms' }} />
            </div>
            <span className="note muted">Hold the phone or laptop near the running engine.</span>
          </div>
        )}
        {busy && <div className="note" style={{ marginTop: 12 }}>{busy}</div>}
        {err && <div className="note" style={{ marginTop: 12, color: 'var(--critical)' }}>{err}</div>}
      </div>

      {!res && !busy && !rec && (
        <div className="empty fade-in" style={{ minHeight: 260 }}>
          <div className="empty-ico"><AudioLines size={28} strokeWidth={1.5} /></div>
          <h2>No clip yet</h2>
          <p className="note">Up to 30 s of engine sound. Each 1 s window is classified (0.5 s apart), then the windows are averaged.</p>
        </div>
      )}
      {res && <ClipResult res={res} src={src} view={view} setView={setView} />}
    </div>
  );
}

function ClipResult({ res, src, view, setView }) {
  const cls = res.classes;
  if (!res.n_windows) {
    return (
      <div className="panel panel-pad">
        <div className="eyebrow">Verdict</div>
        <div style={{ fontSize: 20, fontWeight: 600, margin: '6px 0' }}>No engine sound found</div>
        <div className="note">All {res.n_dropped} windows of {src?.name} were near-silent (below −60 dBFS, or 20 dB under the clip’s own level).</div>
      </div>
    );
  }
  const unsure = res.verdict === 'unsure';
  const k = res.ensemble.indexOf(Math.max(...res.ensemble));
  return (
    <div className="grid2" style={{ gridTemplateColumns: '1fr 330px', alignItems: 'start' }}>
      <div className="stack">
        <div className="panel panel-pad">
          <div className="row" style={{ marginBottom: 10 }}>
            <div className="eyebrow">Window by window · {res.duration_s} s</div>
            <div className="spacer" />
            <span className="note muted">{res.n_windows} classified{res.n_dropped ? ` · ${res.n_dropped} near-silent, skipped` : ''}</span>
          </div>
          <WindowStrip res={res} />
        </div>
        <div className="panel panel-pad">
          <div className="row" style={{ marginBottom: 14, flexWrap: 'wrap', gap: 10 }}>
            <Tabs items={VIEWS} value={view} onChange={setView} />
            <div className="spacer" />
            <span className="note muted">window {res.sig_window + 1}, the one most sure of the verdict · ~{res.sig.rpm} rpm from the sound</span>
          </div>
          <ClipPlot view={view} d={res.sig} signal="Engine sound (real recording)" />
          <div className="chart-caption">{WHY[view]}</div>
        </div>
        <div className="panel panel-pad">
          <div className="eyebrow" style={{ marginBottom: 12 }}>Each model · averaged over the windows</div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 22 }}>
            {Object.entries(res.per_model).map(([m, p]) => {
              const top = p.indexOf(Math.max(...p));
              return (
                <div key={m}>
                  <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 8 }}>{m}</div>
                  <HBars items={cls.map((c, i) => ({ label: NAMES[c], value: p[i], emphasis: i === top }))} />
                </div>
              );
            })}
          </div>
        </div>
      </div>

      <div className="stack">
        <div className="panel panel-pad">
          <div className="eyebrow">Verdict · {src?.name}</div>
          <div style={{ fontSize: 22, fontWeight: 600, margin: '6px 0 4px', color: unsure ? 'var(--s4)' : undefined }}>
            {unsure ? 'Unsure' : NAMES[res.verdict] || res.verdict}
          </div>
          <div className="row" style={{ gap: 10 }}>
            <Status status={unsure ? 'unsure' : res.verdict === 'healthy' ? 'ok' : 'warning'} />
            <span className="note">{Math.round(res.confidence * 100)}% ensemble confidence</span>
          </div>
          {unsure && <div className="note" style={{ marginTop: 8 }}>The models do not agree well enough to name a fault:
            {' '}{Math.round(res.confidence * 100)}% is below the {Math.round(res.threshold * 100)}% needed. Closest: {NAMES[cls[k]]}.
            Record closer to the engine, or longer.</div>}
          {!unsure && res.threshold > 0.25 && <div className="note muted" style={{ marginTop: 8 }}>
            Above the {Math.round(res.threshold * 100)}% confidence needed for a verdict (below it: Unsure).</div>}
          <div className="note muted" style={{ marginTop: 8 }}>
            {res.source} · real data only ({res.model_info.source}). Engine speed is estimated from the sound: ~{Math.round(res.rpm_est)} rpm.
          </div>
          {src?.sample && <div className="note muted" style={{ marginTop: 8 }}>
            Demo sample: held out in the check script, but the served models were trained on all {res.model_info.n_recordings} recordings,
            this one included, so this is not a test score. Held-out scores are on the Evidence page.</div>}
        </div>
        <div className="panel panel-pad">
          <div className="eyebrow" style={{ marginBottom: 12 }}>Ensemble probability</div>
          <HBars items={cls.map((c, i) => ({ label: NAMES[c], value: res.ensemble[i], emphasis: i === k }))
            .sort((a, b) => b.value - a.value)} />
        </div>
      </div>
    </div>
  );
}

/** One cell per 0.5 s window, coloured by its top class (fainter when less sure); grey = near-silent, skipped. */
function WindowStrip({ res }) {
  const cells = [
    ...res.window_t.map((t, i) => ({ t, p: res.per_window[i], i })),
    ...res.dropped_t.map((t) => ({ t, p: null })),
  ].sort((a, b) => a.t - b.t);
  return (
    <div>
      <div style={{ display: 'flex', gap: 3 }}>
        {cells.map((c) => {
          if (!c.p) {
            return <div key={c.t} title={`${c.t.toFixed(1)} s · near-silent, skipped`}
              style={{ flex: 1, height: 34, borderRadius: 4, background: 'var(--surface-3)', opacity: 0.6 }} />;
          }
          const j = c.p.indexOf(Math.max(...c.p));
          return (
            <div key={c.t} title={`${c.t.toFixed(1)}–${(c.t + 1).toFixed(1)} s · ${NAMES[res.classes[j]]} ${Math.round(c.p[j] * 100)}%`}
              style={{ flex: 1, height: 34, borderRadius: 4, background: COLORS[res.classes[j]], opacity: 0.3 + 0.7 * c.p[j],
                outline: c.i === res.sig_window ? '2px solid var(--ink)' : 'none', outlineOffset: 1 }} />
          );
        })}
      </div>
      <div className="row" style={{ gap: 14, marginTop: 10, flexWrap: 'wrap' }}>
        {res.classes.map((c) => (
          <span key={c} className="note muted" style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
            <span style={{ width: 10, height: 10, borderRadius: 2, background: COLORS[c] }} />{NAMES[c]}
          </span>
        ))}
        <span className="note muted">Outlined: the window shown below.</span>
      </div>
    </div>
  );
}

function ClipPlot({ view, d, signal = 'Block vibration' }) {
  if (view === 'time') {
    return <LineChart height={320} fmtX={(v) => `${v.toFixed(0)}`} xTitle="ms" fmtY={(v) => v.toFixed(1)} legend={false}
      series={[{ id: 'v', label: signal, color: 'var(--s1)', x: d.time.t_ms, y: d.time.y, width: 1.2 }]} />;
  }
  if (view === 'spectrum') {
    return <LineChart height={340} xDomain={[0, 10000]} fmtX={(v) => `${(v / 1000).toFixed(0)}k`} xTitle="Hz" legend={false}
      bands={[{ x0: 5500, x1: 8000, label: 'knock band' }]}
      fmtY={(v) => v.toFixed(0)} series={[{ id: 's', label: 'Power (dB)', color: 'var(--s1)', x: d.spectrum.f, y: d.spectrum.db, width: 1.6 }]} />;
  }
  if (view === 'spectrogram') return <Heatmap f={d.spectrogram.f} t={d.spectrogram.t} z={d.spectrogram.z} height={320} />;
  if (view === 'envelope') {
    const marks = d.envelope.orders.map((f, k) => ({ x: f, label: ['0.5×', '1×', '1.5×', '2×'][k], row: k % 2 }));
    return <LineChart height={320} xDomain={[0, 400]} markers={marks} xTitle="Hz" fmtY={(v) => v.toFixed(1)} legend={false}
      series={[{ id: 'e', label: 'Envelope spectrum (normalised)', color: 'var(--s1)', x: d.envelope.f, y: d.envelope.y, width: 1.5 }]} />;
  }
  if (view === 'orders') return <VBars labels={d.orders.labels} values={d.orders.amp} height={300} fmt={(v) => v.toFixed(3)} />;
  const dev = d.crank.dev;
  if (!dev.length) {
    return <div className="empty" style={{ minHeight: 300 }}><p className="note">A sound recording has no crank-position sensor,
      so there is no per-firing crank speed here. The misfire shows in the 0.5× order and the envelope instead.</p></div>;
  }
  return <VBars labels={dev.map((_, k) => k + 1)} values={dev} height={300} showEvery={5} fmt={(v) => `${v.toFixed(1)} rpm`}
    colorOf={(v) => (v < -15 ? 'var(--critical)' : 'var(--s1)')} />;
}
