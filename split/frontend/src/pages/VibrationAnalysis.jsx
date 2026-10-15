// Insights -> Vibration analysis: upload an accelerometer CSV, see its time / FFT / STFT signatures.
// All numbers come from POST /api/vibration/analyze; nothing on this page is simulated.
import { useMemo, useState } from 'react';
import { Download, FileUp, LoaderCircle } from 'lucide-react';
import { analyzeVibration } from '../api.js';
import LineChart from '../components/charts/LineChart.jsx';
import Heatmap from '../components/charts/Heatmap.jsx';
import { HBars } from '../components/charts/Bars.jsx';
import { Stat, Status, Tabs } from '../components/ui.jsx';

const TIME_COLS = ['timestamp', 'time', 't', 'time_s', 'timestamp_s', 'seconds', 'time_ms'];
const AXIS_GUESS = /^(accel_[xyz]|acc_[xyz]|a[xyz]|accelerometer_[xyz]|a_[xyz])$/i;
export const UNIT_LABEL = { g: 'g', 'm/s2': 'm/s²', unknown: 'file units' };
export const num = (v, d = 3) => (v == null ? '–' : Math.abs(v) >= 1000 || (v !== 0 && Math.abs(v) < 0.001) ? v.toExponential(2) : Number(v.toPrecision(d)).toString());
// Frequencies read better as plain numbers: 1,150 Hz in labels, 1.5k on an axis.
export const hz = (v) => (v == null ? '–' : Math.abs(v) >= 100 ? Math.round(v).toLocaleString('en-US') : Number(v.toPrecision(3)).toString());
export const hzTick = (v) => (Math.abs(v) >= 1000 ? `${+(v / 1000).toFixed(2)}k` : `${+v.toFixed(1)}`);
const size = (b) => (b > 1e6 ? `${(b / 1e6).toFixed(1)} MB` : `${Math.max(1, Math.round(b / 1e3))} kB`);

async function readHeader(file) {
  const text = await file.slice(0, 4096).text();
  return text.split(/\r?\n/)[0].split(',').map((c) => c.trim()).filter(Boolean);
}

export default function CsvAnalysis() {
  const [file, setFile] = useState(null);
  const [cols, setCols] = useState([]);
  const [axes, setAxes] = useState([]);
  const [f, setF] = useState({ fs: '', units: 'unknown', rpm: '', location: '', notes: '', timeUnit: 's', detrend: 'mean', hp: '', lp: '', envelope: false });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [res, setRes] = useState(null);
  const set = (k) => (e) => setF((s) => ({ ...s, [k]: e.target.type === 'checkbox' ? e.target.checked : e.target.value }));

  const pick = async (fileObj) => {
    setFile(fileObj); setError(null); setRes(null);
    if (!fileObj) { setCols([]); setAxes([]); return; }
    const header = await readHeader(fileObj);
    const data = header.filter((c) => !TIME_COLS.includes(c.toLowerCase()));
    setCols(data);
    setAxes(data.filter((c) => AXIS_GUESS.test(c)));
  };
  const useSample = async () => {
    const r = await fetch('/samples/synthetic_accel_3axis.csv');
    if (!r.ok) return setError('Sample file not found on the server.');
    await pick(new File([await r.blob()], 'synthetic_accel_3axis.csv', { type: 'text/csv' }));
    setF((s) => ({ ...s, units: 'g', fs: '', location: 'synthetic (no sensor)' }));
  };

  const submit = async (e) => {
    e.preventDefault();
    if (busy || !file) return;
    const fd = new FormData();
    fd.append('file', file);
    if (axes.length) fd.append('axes', axes.join(','));
    fd.append('units', f.units);
    fd.append('time_unit', f.timeUnit);
    fd.append('detrend', f.detrend);
    fd.append('envelope', f.envelope);
    for (const [k, v] of [['sampling_rate_hz', f.fs], ['rpm', f.rpm], ['highpass_hz', f.hp], ['lowpass_hz', f.lp],
      ['sensor_location', f.location], ['notes', f.notes]]) if (String(v).trim() !== '') fd.append(k, v);
    setBusy(true); setError(null);
    try { setRes(await analyzeVibration(fd)); } catch (err) { setRes(null); setError(err.message); } finally { setBusy(false); }
  };

  return (
    <div className="stack">
      <form className="panel panel-pad stack" onSubmit={submit}>
        <div className="eyebrow">Accelerometer recording · CSV upload</div>
        <div className="vib-drop">
          <div className="row" style={{ flexWrap: 'wrap' }}>
            <label className="btn" style={{ cursor: 'pointer' }}>
              <FileUp size={15} />Choose CSV
              <input type="file" accept=".csv,text/csv" hidden onChange={(e) => pick(e.target.files[0] || null)} />
            </label>
            <button type="button" className="btn ghost" onClick={useSample}>Use synthetic sample</button>
            <span className="note">{file ? `${file.name} · ${size(file.size)}` : 'No file selected'}</span>
          </div>
          <div className="chart-caption">
            Header row required. Optional <code>timestamp</code> column (seconds by default) plus <code>accel_x</code>, <code>accel_y</code>, <code>accel_z</code>
            (aliases: acc_x, ax, accelerometer_x…). Without timestamps you must enter the sampling frequency. Max 25 MB / 2 M samples.
          </div>
          <pre className="vib-code">{'timestamp,accel_x,accel_y,accel_z\n0.0000,0.12,-0.04,0.31\n0.0005,0.15,-0.02,0.29'}</pre>
        </div>
        {cols.length > 0 && (
          <div>
            <div className="kpi-label" style={{ marginBottom: 6 }}>Axes to analyse</div>
            <div className="vib-axes">
              {cols.map((c) => (
                <label key={c}><input type="checkbox" checked={axes.includes(c)}
                  onChange={(e) => setAxes((a) => (e.target.checked ? [...a, c] : a.filter((x) => x !== c)))} />{c}</label>
              ))}
            </div>
            {axes.length === 0 && <div className="chart-caption">No standard accelerometer column recognised — tick the column(s) that hold acceleration.</div>}
          </div>
        )}
        <div className="vib-form">
          <label className="field">Sampling frequency (Hz)
            <input type="number" min="0" step="any" value={f.fs} onChange={set('fs')} placeholder="from timestamps" />
          </label>
          <label className="field">Acceleration units
            <select value={f.units} onChange={set('units')}>
              <option value="unknown">Unknown (use file units)</option><option value="g">g</option><option value="m/s2">m/s²</option>
            </select>
          </label>
          <label className="field">Engine RPM (optional)
            <input type="number" min="0" step="any" value={f.rpm} onChange={set('rpm')} placeholder="steady speed only" />
          </label>
          <label className="field">Sensor location (optional)
            <input type="text" value={f.location} onChange={set('location')} placeholder="e.g. engine block, intake side" />
          </label>
          <label className="field">Timestamp unit
            <select value={f.timeUnit} onChange={set('timeUnit')}><option value="s">seconds</option><option value="ms">milliseconds</option><option value="us">microseconds</option></select>
          </label>
          <label className="field">Detrend
            <select value={f.detrend} onChange={set('detrend')}><option value="mean">Remove DC (mean)</option><option value="linear">Linear detrend</option><option value="none">None</option></select>
          </label>
          <label className="field">High-pass (Hz, optional)
            <input type="number" min="0" step="any" value={f.hp} onChange={set('hp')} />
          </label>
          <label className="field">Low-pass (Hz, optional)
            <input type="number" min="0" step="any" value={f.lp} onChange={set('lp')} />
          </label>
        </div>
        <label className="field"><span>Notes (optional)</span>
          <input type="text" value={f.notes} onChange={set('notes')} placeholder="conditions, load, anything worth remembering" />
        </label>
        <label className="vib-axes"><input type="checkbox" checked={f.envelope} onChange={set('envelope')} />Compute envelope spectrum (upper half of the band)</label>
        <div className="row">
          <button className="btn primary" type="submit" disabled={busy || !file}>
            {busy ? <><LoaderCircle size={15} className="spin" />Analysing…</> : 'Analyse recording'}
          </button>
          <span className="note">CSV upload analyses recorded data; it is not a live sensor connection.</span>
        </div>
        {error && <div className="vib-error" role="alert">{error}</div>}
      </form>
      {res && <Results key={res.channels.join() + res.recording.size_bytes + res.sampling_rate_hz} res={res} />}
    </div>
  );
}

function Results({ res }) {
  const chans = res.analysis_channels;
  const [ch, setCh] = useState(chans[0]);
  const [view, setView] = useState('time');
  const [fdiv, setFdiv] = useState(1);
  const unit = UNIT_LABEL[res.recording.units];
  const feats = res.features[ch] || res.features[chans[0]];
  const nyq = res.sampling_rate_hz / 2;
  const fmax = nyq / fdiv;
  const rec = res.recording;

  const views = [['time', 'Waveform'], ['spectrum', 'Spectrum (FFT)'], ['spectrogram', 'Spectrogram (STFT)'],
    ...(res.envelope ? [['envelope', 'Envelope']] : []), ...(res.orders ? [['orders', 'Orders']] : [])];

  return (
    <>
      <div className="panel panel-pad">
        <div className="eyebrow" style={{ marginBottom: 10 }}>Recording summary</div>
        <table className="data"><tbody>
          <tr><td>File</td><td>{rec.filename} · {size(rec.size_bytes)}</td><td>Sampling frequency</td><td>{num(res.sampling_rate_hz, 6)} Hz ({rec.sampling_rate_source})</td></tr>
          <tr><td>Samples</td><td>{rec.n_samples.toLocaleString()}</td><td>Duration</td><td>{rec.duration_s.toFixed(3)} s</td></tr>
          <tr><td>Axes</td><td>{res.channels.join(', ')}</td><td>Units</td><td>{unit}</td></tr>
          <tr><td>Sensor location</td><td>{rec.sensor_location || '–'}</td><td>Frequency resolution</td><td>{num(res.settings.frequency_resolution_hz)} Hz</td></tr>
        </tbody></table>
        {res.warnings.length > 0 && <div className="vib-warn" style={{ marginTop: 12 }}>{res.warnings.map((w) => <div key={w}>• {w}</div>)}</div>}
      </div>

      <div className="grid3" style={{ gridTemplateColumns: 'repeat(4, 1fr)' }}>
        <Stat label="RMS" value={num(feats.rms)} unit={unit} />
        <Stat label="Peak" value={num(feats.peak)} unit={unit} sub={`peak-to-peak ${num(feats.peak_to_peak)}`} />
        <Stat label="Crest factor" value={num(feats.crest_factor)} sub="peak ÷ RMS" />
        <Stat label="Kurtosis" value={num(feats.kurtosis)} sub="excess; ~0 for Gaussian noise" />
      </div>

      <div className="grid2 vib-grid" style={{ gridTemplateColumns: '1.6fr 1fr', alignItems: 'start' }}>
        <div className="panel panel-pad">
          <div className="row" style={{ flexWrap: 'wrap', marginBottom: 12 }}>
            <Tabs items={views} value={view} onChange={setView} />
            <span className="spacer" />
            {chans.length > 1 && (
              <select aria-label="Axis" style={{ width: 'auto' }} value={ch} onChange={(e) => setCh(e.target.value)}>
                {chans.map((c) => <option key={c} value={c}>{c === 'magnitude' ? 'vector magnitude' : c}</option>)}
              </select>
            )}
            {(view === 'spectrum' || view === 'spectrogram') && (
              <select aria-label="Frequency range" style={{ width: 'auto' }} value={fdiv} onChange={(e) => setFdiv(Number(e.target.value))}>
                {[1, 2, 4, 8, 16].map((d) => <option key={d} value={d}>0–{hz(nyq / d)} Hz</option>)}
              </select>
            )}
          </div>
          <Plot view={view} res={res} ch={ch} fmax={fmax} unit={unit} />
          <div className="chart-caption">{CAPTION[view]}</div>
        </div>

        <div className="stack">
          <Classification c={res.classification} />
          <div className="panel panel-pad">
            <div className="eyebrow" style={{ marginBottom: 10 }}>Dominant peaks · {ch}</div>
            {feats.peaks.length ? (
              <table className="data"><thead><tr><th>Frequency</th><th className="num">Amplitude</th></tr></thead><tbody>
                {feats.peaks.map((p) => <tr key={p.frequency_hz}><td>{hz(p.frequency_hz)} Hz</td><td className="num">{num(p.amplitude)} {unit}</td></tr>)}
              </tbody></table>
            ) : <div className="note">No spectral peaks (flat or constant signal).</div>}
            <div className="chart-caption">Peaks are measured frequencies, not diagnoses. Linking one to a component needs RPM, geometry and baseline data.</div>
          </div>
          <div className="panel panel-pad">
            <div className="eyebrow" style={{ marginBottom: 10 }}>Features · {ch}</div>
            <table className="data"><tbody>
              {[['Mean', feats.mean], ['Std dev', feats.std], ['Min', feats.min], ['Max', feats.max], ['Skewness', feats.skewness],
                ['Zero-crossing rate', feats.zero_crossing_rate], ['Spectral centroid (Hz)', feats.spectral_centroid_hz],
                ['Spectral bandwidth (Hz)', feats.spectral_bandwidth_hz]].map(([k, v]) => <tr key={k}><td>{k}</td><td className="num">{num(v)}</td></tr>)}
            </tbody></table>
            <div className="eyebrow" style={{ margin: '14px 0 8px' }}>Band energy (share of power)</div>
            <HBars items={feats.bands.map((b) => ({ label: `${hz(b.lo_hz)}–${hz(b.hi_hz)} Hz`, value: b.fraction ?? 0 }))}
              fmt={(v) => `${(v * 100).toFixed(1)}%`} />
            <div className="row" style={{ marginTop: 14 }}>
              <button className="btn" type="button" onClick={() => download(`${rec.filename}.features.json`, JSON.stringify(summary(res), null, 2), 'application/json')}><Download size={14} />JSON</button>
              <button className="btn" type="button" onClick={() => download(`${rec.filename}.features.csv`, featuresCsv(res), 'text/csv')}><Download size={14} />CSV</button>
            </div>
          </div>
        </div>
      </div>
    </>
  );
}

const CAPTION = {
  time: 'Acceleration after the selected preprocessing, downsampled for display by keeping the largest sample in each bucket. Features are computed on the full-resolution data.',
  spectrum: 'Single-sided amplitude spectrum, Hann window with amplitude correction. Resolution = sampling frequency ÷ number of samples.',
  spectrogram: 'Short-time Fourier transform power in dB (Hann, 1024-sample window, 50% overlap), pooled for display. Brighter = more power.',
  envelope: 'Hilbert envelope spectrum of the upper half of the band: shows how often high-frequency bursts repeat.',
  orders: 'Spectrum amplitude near multiples of the supplied RPM. Only meaningful if engine speed was steady during the recording.',
};

function Plot({ view, res, ch, fmax, unit }) {
  const w = res.waveform[ch], sp = res.spectrum[ch], sg = res.spectrogram[ch];
  const speakPeaks = res.features[ch].peaks.filter((p) => p.frequency_hz <= fmax).slice(0, 4);
  const spec = useMemo(() => {
    const k = sp.f_hz.findIndex((v) => v > fmax);
    const n = k < 0 ? sp.f_hz.length : k;
    return { f: sp.f_hz.slice(0, n), a: sp.amplitude.slice(0, n) };
  }, [sp, fmax]);
  const gram = useMemo(() => {
    const k = sg.f_hz.findIndex((v) => v > fmax);
    const n = k < 0 ? sg.f_hz.length : k;
    return { f: sg.f_hz.slice(0, n), z: sg.power_db.slice(0, n) };
  }, [sg, fmax]);
  if (view === 'time') {
    return <LineChart height={320} xTitle="s" fmtX={(v) => v.toFixed(2)} fmtY={(v) => num(v, 3)}
      series={[{ id: 'w', label: `${ch} (${unit})`, color: 'var(--s1)', x: w.t_s, y: w.y, width: 1.2 }]} />;
  }
  if (view === 'spectrum') {
    return <LineChart height={340} xTitle="Hz" xDomain={[0, fmax]} fmtX={hzTick} fmtY={(v) => num(v, 2)}
      markers={speakPeaks.map((p) => ({ x: p.frequency_hz, label: `${hz(p.frequency_hz)} Hz` }))}
      series={[{ id: 's', label: `${ch} amplitude (${unit})`, color: 'var(--s1)', x: spec.f, y: spec.a, width: 1.4 }]} />;
  }
  if (view === 'spectrogram') {
    const step = fmax / 4;
    return <Heatmap f={gram.f} t={sg.t_s} z={gram.z} height={320} unit="dB" fTicks={[0, 1, 2, 3, 4].map((i) => i * step).filter((v) => v <= gram.f[gram.f.length - 1])}
      fmtF={hzTick} fmtT={(v) => v.toFixed(2)} />;
  }
  if (view === 'envelope') {
    return <LineChart height={320} xTitle="Hz" fmtX={hzTick} fmtY={(v) => num(v, 2)}
      series={[{ id: 'e', label: `Envelope spectrum (band ${hz(res.envelope.band_hz[0])}–${hz(res.envelope.band_hz[1])} Hz)`, color: 'var(--s1)', x: res.envelope.f_hz, y: res.envelope.amplitude, width: 1.4 }]} />;
  }
  const o = res.orders;
  return (
    <div>
      <div className="note" style={{ marginBottom: 8 }}>Channel {o.channel} at {o.rpm} rpm ({num(o.rpm / 60, 4)} Hz crank).</div>
      <table className="data"><thead><tr><th>Order</th><th>Frequency</th><th className="num">Amplitude</th></tr></thead><tbody>
        {o.orders.map((x, i) => <tr key={x}><td>{x}×</td><td>{hz(o.frequency_hz[i])} Hz</td><td className="num">{num(o.amplitude[i])} {unit}</td></tr>)}
      </tbody></table>
    </div>
  );
}

export function Classification({ c }) {
  return (
    <div className="panel panel-pad">
      <div className="eyebrow" style={{ marginBottom: 8 }}>Fault classification</div>
      {c.status === 'available' ? (
        <>
          <div style={{ fontSize: 20, fontWeight: 600 }}>{c.label}</div>
          <div className="note" style={{ margin: '4px 0 12px' }}>{Math.round(c.confidence * 100)}% model confidence · {c.model?.name}</div>
          <HBars items={Object.entries(c.probabilities).sort((a, b) => b[1] - a[1]).map(([k, v], i) => ({ label: k, value: v, emphasis: i === 0 }))} />
          <div className="chart-caption">Supported classes: {c.model?.classes?.join(', ')}. {c.model?.domain}</div>
          {c.model?.limitations && <div className="chart-caption">{c.model.limitations}</div>}
        </>
      ) : (
        <>
          <Status status={c.status === 'error' ? 'critical' : 'info'} />
          <div style={{ fontWeight: 600, margin: '8px 0 4px' }}>{c.status === 'error' ? 'Classifier error' : 'Classification unavailable'}</div>
          <div className="note">{c.status === 'unavailable' && 'Signature extraction succeeded, but no compatible trained classifier is installed. '}{c.reason}</div>
        </>
      )}
    </div>
  );
}

function summary(res) {
  const { waveform, spectrum, spectrogram, ...rest } = res;  // plot arrays are omitted from the summary
  return rest;
}

function featuresCsv(res) {
  const keys = ['mean', 'std', 'rms', 'min', 'max', 'peak', 'peak_to_peak', 'crest_factor', 'skewness', 'kurtosis', 'zero_crossing_rate',
    'spectral_centroid_hz', 'spectral_bandwidth_hz'];
  const rows = [['channel', ...keys, 'top_peak_hz'].join(',')];
  for (const [c, f] of Object.entries(res.features)) rows.push([c, ...keys.map((k) => f[k] ?? ''), f.peaks[0]?.frequency_hz ?? ''].join(','));
  return rows.join('\n') + '\n';
}

function download(name, text, type) {
  const url = URL.createObjectURL(new Blob([text], { type }));
  const a = Object.assign(document.createElement('a'), { href: url, download: name });
  a.click();
  URL.revokeObjectURL(url);
}
