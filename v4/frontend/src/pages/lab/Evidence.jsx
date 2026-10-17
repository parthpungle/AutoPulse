// 03 / Evidence: one chart, chosen to prove the current verdict, against this car's normal, with the
// number that matters as a readout. The choice follows engine.fault (what the classifier confirmed),
// or the status when no fault is confirmed. SIGNATURE_LAB_PLAN.md §4 Phase 2.
import { VBars } from '../../components/charts/Bars.jsx';
import EvidenceChart from './EvidenceChart.jsx';
import { BASELINE_MIN, baselineFor } from './labStore.js';
import {
  bearingOutOfView, contextWords, excessInBand, firingHarmonics, insideShare, largestExcess, nonOrderPeak, peakIn, weakFiring,
} from './derive.js';

const kHz = (v) => `${(v / 1000).toFixed(v % 1000 ? 1 : 0)}k`;
const hz = (v) => `${Math.round(v).toLocaleString('en-US')} Hz`;
const signed = (v, d = 1) => `${v >= 0 ? '+' : '−'}${Math.abs(v).toFixed(d)}`;
const minus = (v, d = 0) => `${v < 0 ? '−' : ''}${Math.abs(v).toFixed(d)}`;

const CAPTION = {
  spectrum: 'Welch PSD · Hann 1024 samples (42.7 ms), 50% overlap · 1 s at 24 kHz · Δf 23.4 Hz.',
  envelope: 'Hilbert envelope of 2–7.5 kHz · 0–399 Hz in 1 Hz steps · normalised to its peak.',
  crank: 'Per-firing crank speed minus the window median, rpm. Firing numbers count within this second only.',
  orders: 'Amplitude at multiples of crank speed, linear.',
};

/** What to show and say for the current second (also read by the Why / Where panel). */
export function chooseEvidence(sig, engine, store) {
  const ctx = engine.context;
  const spec = baselineFor(store, ctx, 'spectrum');
  const env = baselineFor(store, ctx, 'envelope');
  const ord = baselineFor(store, ctx, 'orders');
  const rpm = sig.rpm;
  const f = sig.spectrum.f, db = sig.spectrum.db;
  const pending = (b) => ({ pending: `needs this car's normal (${b.n}/${BASELINE_MIN} s)` });
  const spectrumChart = (extra) => ({
    kind: 'chart', caption: CAPTION.spectrum, base: spec.mean ? spec : null, learnN: spec.n,
    props: { f, live: db, xDomain: [0, 10000], xFmt: kHz, yUnit: 'dB, arbitrary ref.', markers: firingHarmonics(rpm, 10000), ...extra },
  });
  const envelopeChart = (extra) => ({
    kind: 'chart', caption: CAPTION.envelope, base: env.mean ? env : null, learnN: env.n,
    props: { f: sig.envelope.f, live: sig.envelope.y, xDomain: [0, 400], floor: 0, yUnit: 'normalised', ...extra },
  });

  switch (engine.fault) {
    case 'knock':
      return {
        view: 'knock', title: 'energy in the knock band against this car\'s normal',
        ...spectrumChart({ bracket: { x0: 5500, x1: 8000, label: 'knock band 5.5–8 kHz' } }),
        readout: spec.mean ? { value: `${signed(excessInBand(f, db, spec, 5500, 8000))} dB`, text: 'in 5.5–8 kHz vs this car\'s normal' } : pending(spec),
      };
    case 'belt_squeal': {
      const p = peakIn(f, db, 2500, 3500);
      return {
        view: 'belt_squeal', title: 'a narrow tone, zoomed to 2–4 kHz',
        ...spectrumChart({ xDomain: [2000, 4000], xFmt: hz, markers: [], callout: { x: p.f, y: p.y, text: hz(p.f) } }),
        readout: { value: `${signed(p.prominence)} dB`, text: `tone at ${hz(p.f)}, above the rest of 2.5–3.5 kHz` },
      };
    }
    case 'bearing': {
      const p = nonOrderPeak(sig.envelope.f, sig.envelope.y, rpm);
      if (p || !bearingOutOfView(rpm)) {
        return {
          view: 'bearing', title: 'how often impacts repeat (envelope spectrum)',
          ...envelopeChart({
            markers: sig.envelope.orders.map((x, k) => ({ x, label: `${['0.5', '1', '1.5', '2'][k]}× crank` })),
            callout: p ? { x: p.f, y: p.y, text: `${Math.round(p.f)} Hz` } : undefined,
          }),
          // the simulator's defect rate is 7.15–9.82× crank and modulated at the pulley rate, so a peak
          // here may be either; the readout only claims what it sees: a repetition that is not an order
          readout: p ? { value: `${p.ratio.toFixed(1)}× crank`, text: `a repetition at ${hz(p.f)} that is not an engine order` }
            : { pending: 'no impact peak off the engine orders this second' },
        };
      }
      // above ~3,350 rpm the defect rate leaves the 0–399 Hz envelope; the impacts still ring at ~3.5 kHz
      return {
        view: 'bearing', title: 'bearing impacts ringing near 3.5 kHz',
        ...spectrumChart({ xDomain: [2500, 4500], xFmt: hz, markers: [], bracket: { x0: 3300, x1: 3700, label: 'bearing ringing 3.3–3.7 kHz' } }),
        readout: spec.mean ? { value: `${signed(excessInBand(f, db, spec, 3300, 3700))} dB`, text: `at 3.3–3.7 kHz vs normal; the defect rate is above 400 Hz at ${Math.round(rpm)} rpm, out of the envelope's view` } : pending(spec),
      };
    }
    case 'valve_tick': {
      const at = rpm / 120;
      const k = sig.envelope.f.reduce((a, v, i) => (Math.abs(v - at) < Math.abs(sig.envelope.f[a] - at) ? i : a), 0);
      const lvl = Math.max(...sig.envelope.y.slice(Math.max(0, k - 2), k + 3));
      return {
        view: 'valve_tick', title: 'a click once per engine cycle (envelope spectrum)',
        ...envelopeChart({ markers: [{ x: at, label: '0.5× crank · once per cycle' }] }),
        readout: env.mean ? { value: `×${(lvl / Math.max(env.mean[k], 0.01)).toFixed(1)}`, text: `envelope at ${hz(at)} vs this car's normal` }
          : { value: lvl.toFixed(2), text: `envelope at ${hz(at)} (normalised)` },
      };
    }
    case 'misfire': {
      const w = weakFiring(sig.crank.dev);
      const half = ord.mean ? ` · 0.5× order ×${(sig.orders.amp[0] / Math.max(ord.mean[0], 1e-6)).toFixed(1)} vs normal` : '';
      return {
        view: 'misfire', title: 'crank speed at every firing', kind: 'crank', caption: CAPTION.crank, weak: w.phase,
        // in frequency a misfire is the half order: one weak firing per 720° cycle
        freq: ord.mean ? `0.5× crank order (once per cycle) ×${(sig.orders.amp[0] / Math.max(ord.mean[0], 1e-6)).toFixed(1)} vs this car's normal.`
          : `0.5× crank order (once per cycle) at ${sig.orders.amp[0].toFixed(3)}, linear.`,
        readout: { value: `${minus(w.mean - w.others)} rpm`, text: `every 4th firing vs the other three${half}` },
      };
    }
    case 'imbalance':
      return {
        view: 'imbalance', title: 'vibration at multiples of crank speed', kind: 'orders', caption: CAPTION.orders,
        readout: ord.mean ? { value: `×${(sig.orders.amp[1] / Math.max(ord.mean[1], 1e-6)).toFixed(1)}`, text: '1× crank amplitude vs this car\'s normal' }
          : { value: sig.orders.amp[1].toFixed(3), text: '1× crank amplitude (linear)' },
      };
    default:
      break;
  }
  if (engine.status === 'info') {
    const ex = spec.mean && largestExcess(f, db, spec);
    return {
      view: 'info', title: 'where the sound differs from this car\'s normal',
      ...spectrumChart(ex ? { bracket: { x0: ex.lo, x1: ex.hi, label: 'largest rise' } } : {}),
      readout: ex ? { value: `${signed(ex.db)} dB`, text: `at ${kHz(ex.lo)}–${kHz(ex.hi)} Hz, the largest rise over normal` } : pending(spec),
    };
  }
  return {
    view: 'healthy', title: 'the spectrum against this car\'s normal',
    ...spectrumChart(),
    readout: spec.mean ? { value: `${Math.round(insideShare(db, spec) * 100)}%`, text: 'of the spectrum inside this car\'s normal' } : pending(spec),
  };
}

export default function Evidence({ sig, engine, store }) {
  const ev = chooseEvidence(sig, engine, store);
  const ctx = contextWords(engine.context).toLowerCase();
  const normal = ev.base
    ? `Normal = mean ± 2σ of ${ev.base.n} s the models called healthy (${ctx}), learned in this browser.`
    : null;
  const summary = `${ev.title}. ${ev.readout.value ? `${ev.readout.value} ${ev.readout.text}` : ev.readout.pending}.`;

  return (
    <section id="lab-evidence" tabIndex={-1} className="panel panel-pad lab-evidence" data-view={ev.view} data-fault={engine.fault} data-normal-n={ev.base?.n ?? ev.learnN ?? ''}
      aria-labelledby="lab-ev-title">
      <div className="lab-evidence__head">
        <h2 className="eyebrow lab-eyebrow" id="lab-ev-title"><span className="num">04</span> / Evidence · {ev.title}</h2>
        <div className="lab-readout" aria-live="polite">
          {ev.readout.value ? <><span className="num">{ev.readout.value}</span><span>{ev.readout.text}</span></>
            : <span className="lab-readout__pending">{ev.readout.pending}</span>}
        </div>
      </div>

      {ev.kind === 'chart' && !ev.base && (
        <p className="lab-ev__learning">Learning this car's normal · {ev.learnN} / {BASELINE_MIN} healthy s in {ctx}. The band appears once it has.</p>
      )}
      {ev.kind === 'chart' && <EvidenceChart {...ev.props} base={ev.base} summary={summary} height={340} />}
      {ev.kind === 'crank' && (
        <div role="img" aria-label={summary}>
          <VBars labels={Array.from(sig.crank.dev, (_, k) => k + 1)} values={Array.from(sig.crank.dev)} height={340} showEvery={5}
            fmt={(v) => minus(v)} colorOf={(_, i) => (i % 4 === ev.weak ? 'var(--lab-excess)' : 'var(--s3)')} />
        </div>
      )}
      {ev.kind === 'orders' && (
        <div role="img" aria-label={summary}>
          <VBars labels={sig.orders.labels} values={sig.orders.amp} height={340} fmt={(v) => v.toFixed(3)}
            colorOf={(_, i) => (i === 1 ? 'var(--lab-excess)' : 'var(--s3)')} />
        </div>
      )}

      <p className="chart-caption">{ev.caption}{normal && <> {normal}</>}</p>
    </section>
  );
}
