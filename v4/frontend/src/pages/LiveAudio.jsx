// Live Audio Monitoring: the computer's microphone through the real-engine-audio pipeline.
// Capture and buffering run in the browser (src/liveaudio); each window is analysed by /api/live-audio/analyze.
import { useCallback, useEffect, useRef, useState } from 'react';
import { Mic, MicOff, Radio } from 'lucide-react';
import Heatmap from '../components/charts/Heatmap.jsx';
import { HBars } from '../components/charts/Bars.jsx';
import { useWidth } from '../components/charts/useWidth.js';
import { Status } from '../components/ui.jsx';
import { RingBuffer, level, pushBounded } from '../liveaudio/buffer.js';
import { MicCapture } from '../liveaudio/mic.js';
import { LiveAnalyzer, fetchLiveStatus } from '../liveaudio/analyzer.js';

const HISTORY_MAX = 20;
const BUFFER_S = 4; // rolling buffer: the analysis window plus headroom for the waveform view
const HOPS = [['0.5', '0.5 s'], ['1', '1 s'], ['2', '2 s']];
const CLASS_LABEL = { healthy: 'Healthy', misfire: 'Misfire', valve_tick: 'Valve tick', belt_squeal: 'Belt squeal' };
const MIC_WORD = { idle: 'Off', requesting: 'Waiting for permission', active: 'Listening', error: 'Error' };
const CODE_STATUS = { ok: 'info', out_of_distribution: 'pending', bad_quality: 'warning', no_model: 'pending' };
const CODE_WORD = { ok: 'Model output', out_of_distribution: 'Not engine-like', bad_quality: 'Unusable audio', no_model: 'No model' };
const EVIDENCE_LABEL = {
  spectral_centroid_khz: ['Spectral centroid', (v) => `${v.toFixed(2)} kHz`],
  spectral_flatness: ['Spectral flatness', (v) => v.toFixed(3)],
  kurtosis: ['Kurtosis (impulsiveness)', (v) => v.toFixed(2)],
  crest_factor: ['Crest factor', (v) => v.toFixed(2)],
  zero_cross_rate: ['Zero-crossing rate', (v) => v.toFixed(3)],
  env_peak_prominence: ['Envelope peak prominence', (v) => v.toFixed(2)],
};

export default function LiveAudio() {
  const [status, setStatus] = useState(null);
  const [statusError, setStatusError] = useState(null);
  const [mic, setMic] = useState({ state: 'idle', error: null, sampleRate: null, device: null });
  const [hop, setHop] = useState('0.5');
  const [latest, setLatest] = useState(null);
  const [history, setHistory] = useState([]);
  const [apiError, setApiError] = useState(null);
  const [busy, setBusy] = useState(false);
  const [stats, setStats] = useState({ sent: 0, skipped: 0, failed: 0 });

  const micRef = useRef(null);
  const bufRef = useRef(null);
  const analyzerRef = useRef(null);
  const levelRef = useRef({ dbfs: -120, peak: 0 });

  useEffect(() => {
    fetchLiveStatus().then(setStatus, (e) => setStatusError(e.message));
  }, []);

  const windowS = status?.limits?.window_s ?? 1;

  const teardown = useCallback(() => {
    analyzerRef.current?.stop();
    analyzerRef.current = null;
    setBusy(false);
  }, []);

  // one scheduling loop per capture session; the analyzer itself prevents overlapping requests
  useEffect(() => {
    if (mic.state !== 'active') { teardown(); return undefined; }
    const a = new LiveAnalyzer({
      buffer: bufRef.current, sampleRate: mic.sampleRate, windowS,
      timeoutMs: ((status?.limits?.timeout_s ?? 5) + 1) * 1000,
      onResult: (res, meta) => {
        setApiError(null);
        setLatest({ ...res, meta });
        setHistory((h) => pushBounded(h, {
          id: meta.at.getTime(), at: meta.at, code: res.prediction_status.code,
          label: res.prediction?.label ?? null, score: res.prediction?.score ?? null,
          quality: res.quality.status, rms: res.quality.rms_dbfs, ms: meta.roundTripMs,
        }, HISTORY_MAX));
      },
      onError: (e) => setApiError(e.message),
    });
    analyzerRef.current = a;
    const id = setInterval(async () => {
      setBusy(!!a.inflight);
      const p = a.tick();
      setBusy(!!a.inflight);
      await p;
      setBusy(!!a.inflight);
      setStats({ ...a.stats });
    }, Number(hop) * 1000);
    return () => { clearInterval(id); a.stop(); };
  }, [mic.state, mic.sampleRate, hop, windowS, status, teardown]);

  // release the microphone when the page is left
  useEffect(() => () => { micRef.current?.stop(); }, []);

  const start = async () => {
    if (!micRef.current) {
      micRef.current = new MicCapture({
        onChunk: (chunk) => { bufRef.current?.push(chunk); levelRef.current = level(chunk); },
        onState: (s) => {
          if (s.state === 'active') bufRef.current = new RingBuffer(Math.ceil(s.sampleRate * BUFFER_S));
          setMic(s);
        },
      });
    }
    setApiError(null);
    setLatest(null);
    setStats({ sent: 0, skipped: 0, failed: 0 });
    await micRef.current.start();
  };
  const stop = () => micRef.current?.stop();

  const active = mic.state === 'active';
  const modelOk = status?.model_available;

  return (
    <div className="grid2 la-grid" style={{ gridTemplateColumns: 'minmax(0, 1fr) 340px', alignItems: 'start' }}>
      <div className="stack">
        <div className="la-banner">
          <Radio size={16} />
          <div>
            <b>Live microphone input</b> — not a prerecorded dataset and not simulated telemetry. A laptop microphone hearing
            voices, music, fans or room noise is not engine audio, and nothing shown here is a validated vehicle diagnosis.
          </div>
        </div>

        <div className="panel panel-pad">
          <div className="row" style={{ flexWrap: 'wrap', gap: 14 }}>
            {!active ? (
              <button className="btn primary" onClick={start} disabled={mic.state === 'requesting'}>
                <Mic size={16} />Start microphone
              </button>
            ) : (
              <button className="btn" onClick={stop}><MicOff size={16} />Stop microphone</button>
            )}
            <span className={`status ${active ? 'ok' : mic.state === 'error' ? 'critical' : 'pending'}`}>
              <span className={`la-dot ${active ? 'on' : ''}`} />{MIC_WORD[mic.state]}
            </span>
            <span className="spacer" />
            <label className="row" style={{ gap: 8, fontSize: 13, color: 'var(--ink-2)' }}>
              Analyse every
              <select value={hop} onChange={(e) => setHop(e.target.value)} style={{ width: 88 }}>
                {HOPS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
              </select>
            </label>
          </div>
          {mic.error && <div className="la-error">{mic.error.message}</div>}
          <div className="la-facts">
            <span>Device<b>{mic.device || '—'}</b></span>
            <span>Capture rate<b>{mic.sampleRate ? `${mic.sampleRate} Hz` : '—'}</b></span>
            <span>Model rate<b>{status ? `${status.limits.model_rate} Hz` : '—'}</b></span>
            <span>Window<b>{windowS} s</b></span>
            <span>Processing<b>{!active ? 'idle' : busy ? 'analysing…' : 'waiting for next window'}</b></span>
            <span>Windows<b>{stats.sent} sent · {stats.skipped} skipped · {stats.failed} failed</b></span>
          </div>
        </div>

        <div className="panel panel-pad">
          <div className="row" style={{ marginBottom: 10 }}>
            <div className="eyebrow">Waveform · last {windowS} s</div>
            <span className="spacer" />
            <LevelMeter levelRef={levelRef} active={active} quietDb={status?.limits?.quiet_dbfs ?? -50} />
          </div>
          <Waveform bufRef={bufRef} active={active} sampleRate={mic.sampleRate} windowS={windowS} />
          {!active && <div className="chart-caption">Idle. Press <b>Start microphone</b>; the browser will ask for permission.</div>}
        </div>

        <div className="panel panel-pad">
          <div className="eyebrow" style={{ marginBottom: 10 }}>Spectrogram of the last analysed window (model preprocessing: 24 kHz, z-scored)</div>
          {latest ? <Heatmap f={latest.spectrogram.f} t={latest.spectrogram.t} z={latest.spectrogram.z} height={240} />
            : <div className="la-empty">No window analysed yet.</div>}
        </div>

        <div className="panel panel-pad">
          <div className="eyebrow" style={{ marginBottom: 10 }}>Recent windows (last {HISTORY_MAX})</div>
          {history.length === 0 ? <div className="la-empty">Nothing yet.</div> : (
            <table className="data">
              <thead><tr><th>Time</th><th>Result</th><th>Quality</th><th className="num">Level</th><th className="num">Score</th><th className="num">Round trip</th></tr></thead>
              <tbody>
                {history.map((h) => (
                  <tr key={h.id}>
                    <td>{h.at.toLocaleTimeString()}</td>
                    <td>{h.label ? CLASS_LABEL[h.label] : <span className="muted">{CODE_WORD[h.code]}</span>}</td>
                    <td>{h.quality}</td>
                    <td className="num">{h.rms.toFixed(0)} dBFS</td>
                    <td className="num">{h.score != null ? `${Math.round(h.score * 100)}%` : '—'}</td>
                    <td className="num">{h.ms} ms</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>

      <div className="stack">
        <div className="panel panel-pad">
          <div className="eyebrow">Latest window</div>
          {apiError && <div className="la-error">{apiError}</div>}
          {!latest ? <div className="la-empty" style={{ marginTop: 8 }}>{active ? 'Collecting the first window…' : 'Microphone off.'}</div> : (
            <>
              <div className="row" style={{ margin: '8px 0 4px' }}>
                <Status status={CODE_STATUS[latest.prediction_status.code]} />
                <span className="note">{CODE_WORD[latest.prediction_status.code]}</span>
              </div>
              {latest.prediction && (
                <div style={{ fontSize: 20, fontWeight: 600, margin: '4px 0' }}>
                  {CLASS_LABEL[latest.prediction.label]}
                  <span className="note" style={{ fontWeight: 400, marginLeft: 8 }}>model score {Math.round(latest.prediction.score * 100)}%</span>
                </div>
              )}
              <div className="note">{latest.prediction_status.message}</div>
              {latest.quality.warnings.map((w) => <div key={w} className="la-warn">{w}</div>)}
              {latest.prediction && (
                <div style={{ marginTop: 14 }}>
                  <div className="kpi-label" style={{ marginBottom: 8 }}>Model scores (SVM, Platt-scaled)</div>
                  <HBars items={Object.entries(latest.prediction.scores).map(([k, v]) => ({
                    label: CLASS_LABEL[k], value: v, emphasis: k === latest.prediction.label }))} />
                </div>
              )}
              <table className="data" style={{ marginTop: 14 }}>
                <tbody>
                  <tr><td>Input level</td><td className="num">{latest.quality.rms_dbfs.toFixed(1)} dBFS</td></tr>
                  <tr><td>Peak / clipped</td><td className="num">{latest.quality.peak.toFixed(2)} / {(latest.quality.clip_fraction * 100).toFixed(2)}%</td></tr>
                  {latest.novelty && <tr><td>Engine-likeness</td><td className="num">{latest.novelty.score.toFixed(3)} (gate {latest.novelty.threshold.toFixed(3)})</td></tr>}
                  <tr><td>Server time</td><td className="num">{latest.timings.total_ms.toFixed(0)} ms</td></tr>
                  <tr><td>Round trip</td><td className="num">{latest.meta.roundTripMs} ms</td></tr>
                </tbody>
              </table>
            </>
          )}
        </div>

        {latest && (
          <div className="panel panel-pad">
            <div className="eyebrow" style={{ marginBottom: 8 }}>Acoustic measurements (signature extractor)</div>
            <table className="data">
              <tbody>
                {Object.entries(latest.evidence.features).map(([k, v]) => (
                  <tr key={k}><td>{EVIDENCE_LABEL[k][0]}</td><td className="num">{EVIDENCE_LABEL[k][1](v)}</td></tr>
                ))}
                <tr><td>Envelope repetition rate</td><td className="num">{latest.evidence.envelope_rate_hz.toFixed(1)} Hz</td></tr>
                <tr><td>≈ rpm <span className="muted">if a 4-cyl 4-stroke engine</span></td><td className="num">{Math.round(latest.evidence.rpm_if_4cyl_4stroke)}</td></tr>
              </tbody>
            </table>
            <div className="chart-caption">Descriptive measurements of the sound. On their own they do not identify a mechanical fault.</div>
          </div>
        )}

        <div className="panel panel-pad">
          <div className="eyebrow" style={{ marginBottom: 8 }}>Model</div>
          {statusError && <div className="la-error">Cannot reach the API: {statusError}</div>}
          {status && !modelOk && (
            <div className="la-error">
              Live microphone capture works, but a compatible trained model is unavailable: {status.reason}
              {' '}Signal views still update; no predictions are made.
            </div>
          )}
          {modelOk && <ModelCard m={status.model} />}
        </div>
      </div>
    </div>
  );
}

function ModelCard({ m }) {
  const cv = m.metrics.per_window_normalization;
  const probes = m.metrics.novelty_gate?.synthetic_probe_pass_rate || {};
  return (
    <div className="stack" style={{ gap: 8 }}>
      <div className="note"><b>{m.model_name}</b> on 28 signature features · classes {m.classes.map((c) => CLASS_LABEL[c]).join(', ')}</div>
      <div className="note">Trained on {m.dataset.name}: {m.dataset.description}. Licence: {m.dataset.license}.</div>
      <div className="note">
        Cross-validated on held-out recordings: {(cv.accuracy.mean * 100).toFixed(1)}% of windows, {(cv.recording_accuracy * 100).toFixed(1)}% of
        recordings ({m.metrics.n_recordings} recordings, {m.metrics.split}).
      </div>
      <div className="note muted">
        That figure is for phone recordings from the same dataset. It is not an accuracy for this microphone, this room or your car.
        The engine-likeness gate rejected every synthetic voice, tone, chord and fan probe in testing, but let
        {' '}{Math.round((probes['white noise']?.passed_gate ?? 0) * 100)}% of white-noise windows through: broadband noise can still receive a label.
      </div>
    </div>
  );
}

function LevelMeter({ levelRef, active, quietDb }) {
  const bar = useRef(null);
  const txt = useRef(null);
  useEffect(() => {
    if (!active) {
      if (bar.current) bar.current.style.width = '0';
      if (txt.current) txt.current.textContent = '—';
      return undefined;
    }
    let raf;
    const draw = () => {
      const { dbfs, peak } = levelRef.current;
      const pct = Math.max(0, Math.min(100, ((dbfs + 70) / 70) * 100));
      if (bar.current) {
        bar.current.style.width = `${pct}%`;
        bar.current.style.background = peak >= 0.999 ? 'var(--critical)' : dbfs < quietDb ? 'var(--muted)' : 'var(--good)';
      }
      if (txt.current) txt.current.textContent = `${dbfs < -119 ? '−∞' : dbfs.toFixed(0)} dBFS`;
      raf = requestAnimationFrame(draw);
    };
    raf = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(raf);
  }, [active, levelRef, quietDb]);
  return (
    <div className="row" style={{ gap: 8, minWidth: 220 }} aria-label="Input level">
      <span className="kpi-label">Level</span>
      <div className="meter" style={{ flex: 1 }}><div ref={bar} style={{ width: 0 }} /></div>
      <span ref={txt} className="la-num">—</span>
    </div>
  );
}

function Waveform({ bufRef, active, sampleRate, windowS }) {
  const wrap = useRef(null);
  const canvas = useRef(null);
  const width = useWidth(wrap);
  const H = 140;
  useEffect(() => {
    const c = canvas.current;
    if (!c || width <= 0) return undefined;
    const dpr = window.devicePixelRatio || 1;
    c.width = width * dpr;
    c.height = H * dpr;
    const ctx = c.getContext('2d');
    const css = getComputedStyle(c);
    const line = css.getPropertyValue('--s1').trim() || '#3987e5';
    const grid = css.getPropertyValue('--grid').trim() || '#2c2c2a';
    let raf;
    const draw = () => {
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, width, H);
      ctx.strokeStyle = grid;
      ctx.beginPath(); ctx.moveTo(0, H / 2); ctx.lineTo(width, H / 2); ctx.stroke();
      const n = sampleRate ? Math.round(sampleRate * windowS) : 0;
      const x = active && n ? bufRef.current?.latest(Math.min(n, bufRef.current.filled)) : null;
      if (x && x.length > 1) {
        // min/max per pixel column, so short transients stay visible
        const per = x.length / width;
        ctx.strokeStyle = line;
        ctx.beginPath();
        for (let px = 0; px < width; px++) {
          let lo = 1, hi = -1;
          for (let i = Math.floor(px * per), e = Math.min(x.length, Math.floor((px + 1) * per) + 1); i < e; i++) {
            if (x[i] < lo) lo = x[i];
            if (x[i] > hi) hi = x[i];
          }
          ctx.moveTo(px + 0.5, H / 2 - Math.min(1, hi) * (H / 2 - 2));
          ctx.lineTo(px + 0.5, H / 2 - Math.max(-1, lo) * (H / 2 - 2) + 0.5);
        }
        ctx.stroke();
      }
      if (active) raf = requestAnimationFrame(draw);
    };
    draw();
    return () => cancelAnimationFrame(raf);
  }, [width, active, sampleRate, windowS, bufRef]);
  return <div ref={wrap} className="chart"><canvas ref={canvas} style={{ width: '100%', height: H, display: 'block' }} /></div>;
}
