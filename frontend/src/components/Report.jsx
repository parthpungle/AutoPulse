// Printable vehicle health report: one sheet that pulls the key-on check, the drive telemetry,
// the engine-signature vote and component wear together. Opens as a preview; Print (or Save as PDF)
// prints only the sheet.
import { useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import { Moon, Printer, Sun, X } from 'lucide-react';
import { useApi } from '../api.js';
import { CAR_INFO, ENGINE_FAULTS, OBD_FAULTS, label, useScenario } from '../scenario.jsx';
import { STATUS_WORD, StatusIcon, scoreStatus } from './ui.jsx';
import '../report.css';

const RANK = { ok: 0, info: 1, warning: 2, critical: 3 };
const worse = (a, b) => (RANK[b] > RANK[a] ? b : a);
const COL = { ok: 'var(--good)', info: 'var(--info)', warning: 'var(--warning)', critical: 'var(--critical)' };

// Telemetry channels: the scale each strip is drawn on, the normal band, and how the worst reading is graded.
const CHANNELS = [
  { id: 'coolant', key: 'coolant_c', name: 'Coolant temperature', src: 'PID 05', unit: '°C', d: 0, dom: [20, 135], band: [80, 105],
    limit: 112, grade: (v) => (v.max > 112 ? 'critical' : v.max > 105 ? 'warning' : 'ok'), worst: 'max' },
  { id: 'oil', key: 'oil_pressure_bar', name: 'Oil pressure', src: 'Sensor', unit: 'bar', d: 2, dom: [0, 5], band: [1, 4.5],
    limit: 0.5, grade: (v) => (v.min < 0.6 ? 'critical' : v.min < 1 ? 'warning' : 'ok'), worst: 'min' },
  { id: 'battery', key: 'battery_v', name: 'System voltage', src: 'PID 42', unit: 'V', d: 2, dom: [10.5, 15], band: [13.2, 14.8],
    limit: 13, grade: (v) => (v.min < 11 ? 'critical' : v.min < 13 ? 'warning' : 'ok'), worst: 'min' },
  { id: 'fuel', key: 'fuel_level_pct', name: 'Fuel level', src: 'PID 2F', unit: '%', d: 1, dom: [0, 100], band: [15, 100],
    grade: (v) => (v.first - v.last > 6 ? 'critical' : v.first - v.last > 4 || v.last < 15 ? 'warning' : 'ok'), worst: 'last',
    note: (v) => `used ${(v.first - v.last).toFixed(1)}% in 15 min` },
  { id: 'trim', key: 'ltft_pct', name: 'Long-term fuel trim', src: 'PID 07', unit: '%', d: 1, dom: [-15, 15], band: [-4, 4],
    grade: (v) => { const m = Math.max(Math.abs(v.min), Math.abs(v.max)); return m > 10 ? 'critical' : m > 4 ? 'warning' : 'ok'; }, worst: 'absmax' },
  { id: 'tyre', key: 'tyre_min', name: 'Lowest tyre', src: 'TPMS / ABS', unit: 'psi', d: 1, dom: [0, 45], band: [30, 36],
    limit: 22, grade: (v) => (v.min < 22 ? 'critical' : v.min < 28 ? 'warning' : 'ok'), worst: 'min' },
  { id: 'rpm', key: 'rpm', name: 'Engine speed', src: 'PID 0C', unit: 'rpm', d: 0, dom: [0, 6500], band: [700, 4000],
    grade: () => 'ok', worst: 'max' },
  { id: 'speed', key: 'speed_kph', name: 'Vehicle speed', src: 'PID 0D', unit: 'km/h', d: 0, dom: [0, 140], band: [0, 120],
    grade: () => 'ok', worst: 'max' },
];

const TYRE_NAMES = { tyre_fl_psi: 'front-left', tyre_fr_psi: 'front-right', tyre_rl_psi: 'rear-left', tyre_rr_psi: 'rear-right' };

function summarize(arr) {
  let min = Infinity, max = -Infinity, sum = 0;
  for (const v of arr) { if (v < min) min = v; if (v > max) max = v; sum += v; }
  return { min, max, mean: sum / arr.length, first: arr[0], last: arr[arr.length - 1] };
}

const fmtT = (t) => `${Math.floor(t / 60)}:${String(t % 60).padStart(2, '0')}`;

/* ---------------------------------------------------------------- small visuals */

function Spark({ values, dom, band, limit, color }) {
  const W = 200, H = 44, n = values.length;
  const step = Math.max(1, Math.floor(n / 150));
  const y = (v) => H - 2 - ((Math.min(dom[1], Math.max(dom[0], v)) - dom[0]) / (dom[1] - dom[0])) * (H - 4);
  let d = '';
  for (let i = 0; i < n; i += step) d += `${d ? 'L' : 'M'}${((i / (n - 1)) * W).toFixed(1)},${y(values[i]).toFixed(1)}`;
  return (
    <svg className="rp-spark" viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" aria-hidden>
      <rect x="0" width={W} y={y(band[1])} height={Math.max(0, y(band[0]) - y(band[1]))} className="rp-band" />
      {limit !== undefined && <line x1="0" x2={W} y1={y(limit)} y2={y(limit)} className="rp-limit" />}
      <path d={d} fill="none" stroke={color} strokeWidth="1.6" vectorEffect="non-scaling-stroke" strokeLinejoin="round" />
    </svg>
  );
}

/** Scale strip: the normal band, the bracket of everything seen this drive, and a tick at the reading reported. */
function Strip({ dom, band, min, max, value, color }) {
  const W = 200;
  const x = (v) => ((Math.min(dom[1], Math.max(dom[0], v)) - dom[0]) / (dom[1] - dom[0])) * W;
  return (
    <svg className="rp-strip" viewBox={`0 0 ${W} 14`} preserveAspectRatio="none" aria-hidden>
      <line x1="0" x2={W} y1="7" y2="7" className="rp-track" vectorEffect="non-scaling-stroke" />
      <rect x={x(band[0])} width={x(band[1]) - x(band[0])} y="4" height="6" rx="1" className="rp-band" />
      <line x1={x(min)} x2={x(max)} y1="7" y2="7" stroke={color} strokeWidth="2" vectorEffect="non-scaling-stroke" opacity=".55" />
      <rect x={x(value) - 1.5} y="0" width="3" height="14" fill={color} />
    </svg>
  );
}

function Gauge({ value, status }) {
  // 240° arc gauge; the score sits in the middle.
  const r = 46, cx = 60, cy = 60, a0 = 150, sweep = 240;
  const pt = (deg) => [cx + r * Math.cos((deg * Math.PI) / 180), cy + r * Math.sin((deg * Math.PI) / 180)];
  const arc = (from, to) => {
    const [x1, y1] = pt(from), [x2, y2] = pt(to);
    return `M${x1},${y1} A${r},${r} 0 ${to - from > 180 ? 1 : 0} 1 ${x2},${y2}`;
  };
  const end = a0 + (sweep * Math.max(0.5, value)) / 100;
  return (
    <svg className="rp-gauge" viewBox="0 0 120 108" role="img" aria-label={`Health score ${value} of 100`}>
      <path d={arc(a0, a0 + sweep)} className="rp-gauge-track" />
      <path d={arc(a0, end)} stroke={COL[status]} strokeWidth="9" fill="none" strokeLinecap="round" />
      {[0, 25, 50, 75, 100].map((t) => {
        const [x1, y1] = pt(a0 + (sweep * t) / 100);
        const k = (r + 8) / r;
        return <line key={t} x1={x1} y1={y1} x2={cx + (x1 - cx) * k} y2={cy + (y1 - cy) * k} className="rp-tick" />;
      })}
      <text x="60" y="62" textAnchor="middle" className="rp-gauge-val">{value}</text>
      <text x="60" y="80" textAnchor="middle" className="rp-gauge-sub">/ 100</text>
    </svg>
  );
}

/** Top-down schematic, nose to the left; zones tinted by the key-on check. */
function CarMap({ zones }) {
  const z = (id) => zones?.[id] || 'ok';
  const zoneProps = (id) => {
    const st = z(id);
    return st === 'ok' ? { className: 'rp-zone' } : { className: `rp-zone hot ${st}`, style: { '--c': COL[st] } };
  };
  const tyre = (id, x, yy, lbl, ly) => (
    <g key={id}>
      <rect x={x} y={yy} width="38" height="15" rx="4" {...zoneProps(id)} />
      <text x={x + 19} y={ly} textAnchor="middle" className="rp-map-lbl">{lbl}</text>
    </g>
  );
  return (
    <svg className="rp-map" viewBox="0 0 300 168" role="img" aria-label="Vehicle zone map">
      <text x="10" y="88" className="rp-map-lbl" transform="rotate(-90 10 88)" textAnchor="middle">FRONT</text>
      <rect x="34" y="34" width="234" height="100" rx="34" className="rp-body" />
      <path d="M118 42 h86 a12 12 0 0 1 12 12 v60 a12 12 0 0 1 -12 12 h-86 a12 12 0 0 1 -12 -12 v-60 a12 12 0 0 1 12 -12z" className="rp-cabin" />
      <rect x="40" y="52" width="10" height="64" rx="3" {...zoneProps('cooling')} />
      <rect x="56" y="48" width="44" height="72" rx="8" {...zoneProps('engine')} />
      <rect x="84" y="40" width="16" height="12" rx="2" {...zoneProps('battery')} />
      <rect x="222" y="64" width="34" height="40" rx="6" {...zoneProps('fuel')} />
      <text x="45" y="146" textAnchor="middle" className="rp-map-lbl">RAD</text>
      <text x="78" y="88" textAnchor="middle" className="rp-map-lbl">ENG</text>
      <text x="104" y="49" className="rp-map-lbl">BAT</text>
      <text x="239" y="88" textAnchor="middle" className="rp-map-lbl">FUEL</text>
      {tyre('tyre_fr', 58, 19, 'FR', 12)}
      {tyre('tyre_rr', 196, 19, 'RR', 12)}
      {tyre('tyre_fl', 58, 134, 'FL', 162)}
      {tyre('tyre_rl', 196, 134, 'RL', 162)}
    </svg>
  );
}

function Pill({ status }) {
  return <span className={`rp-pill ${status}`}><StatusIcon status={status} size={11} />{STATUS_WORD[status]}</span>;
}

/* ---------------------------------------------------------------- report */

export default function Report({ onClose }) {
  const { s } = useScenario();
  const driveBody = useMemo(() => ({ obd_fault: s.obd_fault, ambient: s.ambient, seed: s.seed }), [s.obd_fault, s.ambient, s.seed]);
  const startup = useApi('/startup', s);
  const drive = useApi('/drive', driveBody);
  const sig = useApi('/signature', s);
  const wear = useApi('/wear');
  const [paper, setPaper] = useState(() => (new URLSearchParams(window.location.search).get('paper') === 'light' ? 'light' : 'dark'));
  const [now] = useState(() => new Date());

  useEffect(() => {
    const onKey = (e) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    document.body.classList.add('rp-open');
    return () => { window.removeEventListener('keydown', onKey); document.body.classList.remove('rp-open'); };
  }, [onClose]);

  const failed = [startup, drive, sig, wear].find((q) => q.error);
  const ready = startup.data && drive.data && sig.data && wear.data;

  return createPortal(
    <div className="report-root" data-paper={paper}>
      <div className="rp-toolbar">
        <div className="rp-toolbar-title">Report preview</div>
        <div className="spacer" />
        <button className="btn" onClick={() => setPaper(paper === 'dark' ? 'light' : 'dark')} title="Switch between a dark sheet and an ink-saving light one">
          {paper === 'dark' ? <Sun size={15} /> : <Moon size={15} />}{paper === 'dark' ? 'Ink saver' : 'Dark sheet'}
        </button>
        <button className="btn primary" onClick={() => window.print()} disabled={!ready}><Printer size={15} />Print / Save PDF</button>
        <button className="btn ghost" onClick={onClose} aria-label="Close report"><X size={16} /></button>
      </div>
      {failed ? <div className="rp-wait">Could not build the report: {String(failed.error.message || failed.error)}</div>
        : !ready ? <div className="rp-wait">Compiling report…</div>
          : <Sheet s={s} st={startup.data} dr={drive.data} sg={sig.data} wr={wear.data} now={now} />}
    </div>,
    document.body,
  );
}

function Sheet({ s, st, dr, sg, wr, now }) {
  const S = dr.series;

  // Telemetry: summarise every channel over the whole drive and grade its worst reading.
  const tyreKeys = Object.keys(TYRE_NAMES);
  const tyreMin = S.t.map((_, i) => Math.min(...tyreKeys.map((k) => S[k][i])));
  const lowTyre = tyreKeys.reduce((a, k) => (Math.min(...S[k]) < Math.min(...S[a]) ? k : a), tyreKeys[0]);
  const series = { ...S, tyre_min: tyreMin };
  const tiles = CHANNELS.map((c) => {
    const v = summarize(series[c.key]);
    const status = c.grade(v);
    const shown = c.worst === 'absmax' ? (Math.abs(v.min) > Math.abs(v.max) ? v.min : v.max) : v[c.worst];
    return { ...c, v, status, shown };
  });

  // Alerts: first time each one fired, at its highest severity.
  const events = new Map();
  for (const frame of dr.alerts) {
    for (const a of frame.alerts) {
      const e = events.get(a.title);
      if (!e) events.set(a.title, { ...a, t: frame.t });
      else if (RANK[a.severity] > RANK[e.severity]) events.set(a.title, { ...e, severity: a.severity, message: a.message, actions: a.actions });
    }
  }
  const alerts = [...events.values()].sort((a, b) => RANK[b.severity] - RANK[a.severity] || a.t - b.t);
  const duration = S.t[S.t.length - 1];

  // Engine signature
  const k = sg.ensemble.indexOf(Math.max(...sg.ensemble));
  const engineStatus = k === 0 ? 'ok' : ['misfire', 'knock'].includes(ENGINE_FAULTS[k][0]) ? 'critical' : 'warning';
  const models = Object.entries(sg.votes).map(([name, p]) => {
    const j = p.indexOf(Math.max(...p));
    return { name, label: sg.classes[j], p: p[j], agree: j === k };
  });
  const orderMax = Math.max(...sg.orders.amp);

  // Overall status: worst of the key-on checks, the drive and the signature.
  const overall = [...st.checks.map((c) => c.status), ...tiles.map((t) => t.status), ...alerts.map((a) => a.severity), engineStatus]
    .reduce(worse, 'ok');
  const findings = [
    ...st.checks.filter((c) => c.status !== 'ok').map((c) => ({ status: c.status, what: c.name, why: c.detail, src: 'Key-on check' })),
    ...alerts.map((a) => ({ status: a.severity, what: a.title, why: a.message, src: `Drive · ${fmtT(a.t)}` })),
    ...tiles.filter((t) => t.status !== 'ok' && !alerts.length).map((t) => ({ status: t.status, what: t.name, why: `Worst reading ${t.shown.toFixed(t.d)} ${t.unit}`, src: 'Drive telemetry' })),
  ].sort((a, b) => RANK[b.status] - RANK[a.status]);
  const lead = findings[0];

  const actions = [...new Set([
    ...alerts.flatMap((a) => a.actions || []),
    ...wr.components.filter((c) => c.health < 20).map((c) => `${c.name} at ${Math.round(c.health)}% — replace at the next service`),
    ...(engineStatus !== 'ok' ? [`Engine signature matches ${sg.verdict.label.toLowerCase()} — have the engine inspected`] : []),
  ])];

  const reportNo = `AP-${s.car_type.slice(0, 3).toUpperCase()}${s.unit}-${String(s.seed).slice(-4).padStart(4, '0')}-${now.toISOString().slice(2, 10).replace(/-/g, '')}`;
  const scoreSt = scoreStatus(st.score);

  return (
    <article className="rp-sheet">
      {/* ---- masthead */}
      <header className="rp-head">
        <div className="rp-brand">
          <svg width="26" height="26" viewBox="0 0 24 24" aria-hidden>
            <circle cx="12" cy="12" r="10.5" fill="none" stroke="var(--accent)" strokeWidth="1.6" />
            <path d="M3.5 12h4l2-5 3 10 2.2-7 1.3 2H20.5" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinejoin="round" strokeLinecap="round" />
          </svg>
          <div>
            <div className="rp-brand-name">AutoPulse</div>
            <div className="rp-eyebrow">Vehicle health report</div>
          </div>
        </div>
        <dl className="rp-meta">
          <div><dt>Vehicle</dt><dd>{CAR_INFO[s.car_type].name} · {CAR_INFO[s.car_type].spec}</dd></div>
          <div><dt>Unit</dt><dd>#{s.unit}</dd></div>
          <div><dt>Report</dt><dd className="mono">{reportNo}</dd></div>
          <div><dt>Generated</dt><dd className="mono">{now.toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' })}</dd></div>
          <div><dt>Ambient</dt><dd className="mono">{s.ambient} °C</dd></div>
          <div><dt>Drive</dt><dd className="mono">{Math.round(duration / 60)} min · 1 Hz</dd></div>
        </dl>
      </header>

      {/* ---- priority line */}
      <div className={`rp-banner ${overall}`} style={{ '--c': COL[overall] }}>
        <StatusIcon status={overall} size={16} />
        <span className="rp-banner-tag">{overall === 'ok' ? 'All clear' : overall === 'critical' ? 'Action required' : 'Attention'}</span>
        <span className="rp-banner-text">
          {lead ? <><b>{lead.what}</b> — {lead.why}</> : 'No faults found in the key-on scan, the drive or the engine signature.'}
        </span>
        <span className="rp-banner-count mono">{findings.length} finding{findings.length === 1 ? '' : 's'}</span>
      </div>

      {/* ---- headline figures */}
      <section className="rp-kpis">
        <div className="rp-card rp-score" style={{ '--c': COL[scoreSt] }}>
          <Gauge value={st.score} status={scoreSt} />
          <div>
            <div className="rp-eyebrow">Health score</div>
            <div className="rp-verdict">{st.verdict}</div>
            <div className="rp-small">8 key-on checks · penalties for each fault</div>
          </div>
        </div>
        <Kpi label="Engine signature" value={`${Math.round(sg.verdict.confidence * 100)}`} unit="%" status={engineStatus}
          sub={sg.verdict.label} />
        <Kpi label="Checks passed" value={`${st.checks.filter((c) => c.status === 'ok').length}`} unit={`/ ${st.checks.length}`}
          status={st.checks.map((c) => c.status).reduce(worse, 'ok')} sub="ECU, battery, cooling, oil, fuel, tyres, brakes" />
        <Kpi label="Battery life" value={wr.battery.months_left ?? '—'} unit="months"
          status={wr.battery.months_left !== null && wr.battery.months_left < 3 ? 'warning' : 'ok'} sub="to the 3.2 V cranking-dip limit" />
      </section>

      {/* ---- telemetry */}
      <section className="rp-section">
        <SectionHead n="01" title="Drive telemetry" note={`Worst reading over a ${Math.round(duration / 60)}-minute drive · shaded band = normal for this car`} />
        <div className="rp-tiles">
          {tiles.map((t) => (
            <div key={t.id} className={`rp-tile ${t.status}`} style={{ '--c': COL[t.status] }}>
              <div className="rp-tile-head">
                <span className="rp-tile-name">{t.name}</span>
                <span className="rp-src">{t.src}</span>
              </div>
              <div className="rp-tile-val">
                <span className="mono">{t.shown.toFixed(t.d)}</span><small>{t.unit}</small>
                <span className="spacer" /><Pill status={t.status} />
              </div>
              <Strip dom={t.dom} band={t.band} min={t.v.min} max={t.v.max} value={t.shown} color={COL[t.status === 'ok' ? 'ok' : t.status]} />
              <Spark values={series[t.key]} dom={t.dom} band={t.band} limit={t.limit} color={t.status === 'ok' ? 'var(--rp-line-ink)' : COL[t.status]} />
              <div className="rp-tile-foot mono">
                {t.id === 'tyre' ? `${TYRE_NAMES[lowTyre]} · ` : ''}
                {t.note ? t.note(t.v) : `min ${t.v.min.toFixed(t.d)} · avg ${t.v.mean.toFixed(t.d)} · max ${t.v.max.toFixed(t.d)}`}
              </div>
            </div>
          ))}
        </div>
      </section>

      {/* ---- checks + map */}
      <section className="rp-section rp-two">
        <div>
          <SectionHead n="02" title="Key-on subsystem scan" note="Read at ignition, before the car moves" />
          <div className="rp-checks">
            {st.checks.map((c) => (
              <div key={c.id} className={`rp-check ${c.status}`} style={{ '--c': COL[c.status] }}>
                <span className="rp-check-name">{c.name}</span>
                <span className="rp-check-detail">{c.detail}</span>
                <Pill status={c.status} />
              </div>
            ))}
          </div>
        </div>
        <div>
          <SectionHead n="03" title="Where" note="Zones flagged by the scan" />
          <div className="rp-card rp-mapcard">
            <CarMap zones={st.zones} />
            <div className="rp-legend">
              {['ok', 'warning', 'critical'].map((x) => <span key={x}><i style={{ background: COL[x] }} />{STATUS_WORD[x]}</span>)}
            </div>
          </div>
        </div>
      </section>

      {/* ---- engine signature */}
      <section className="rp-section">
        <SectionHead n="04" title="Engine sound & vibration" note="1 s window · 28 signature features + spectrogram · four independent classifiers" />
        <div className="rp-three">
          <div className="rp-card">
            <div className="rp-eyebrow">Ensemble probability</div>
            <div className="rp-bars">
              {sg.classes.map((c, i) => (
                <div key={c} className={`rp-bar ${i === k ? 'on' : ''}`}>
                  <span className="rp-bar-lbl">{c.replace(/ \(.*\)/, '')}</span>
                  <span className="rp-bar-track"><span style={{ width: `${Math.max(0.6, sg.ensemble[i] * 100)}%`, background: i === k ? COL[engineStatus] : undefined }} /></span>
                  <span className="rp-bar-num mono">{(sg.ensemble[i] * 100).toFixed(1)}%</span>
                </div>
              ))}
            </div>
          </div>
          <div className="rp-card">
            <div className="rp-eyebrow">Model agreement</div>
            <table className="rp-table">
              <tbody>
                {models.map((m) => (
                  <tr key={m.name}>
                    <td className="mono">{m.name}</td>
                    <td>{m.label.replace(/ \(.*\)/, '')}</td>
                    <td className="num mono">{(m.p * 100).toFixed(1)}%</td>
                    <td className="num"><span className={`rp-dot ${m.agree ? 'yes' : 'no'}`} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
            <div className="rp-small" style={{ marginTop: 8 }}>
              {models.filter((m) => m.agree).length} of {models.length} models agree · injected: {label(ENGINE_FAULTS, s.engine_fault)}
            </div>
          </div>
          <div className="rp-card">
            <div className="rp-eyebrow">Engine orders at 1500 rpm</div>
            <svg className="rp-orders" viewBox="0 0 180 96" preserveAspectRatio="none" aria-label="Order amplitudes">
              {sg.orders.amp.map((a, i) => {
                const w = 180 / sg.orders.amp.length;
                const h = Math.max(1.5, (a / orderMax) * 78);
                return (
                  <g key={i}>
                    <rect x={i * w + 5} width={w - 10} y={80 - h} height={h} rx="2" className={a === orderMax ? 'rp-order hi' : 'rp-order'} />
                    <text x={i * w + w / 2} y="93" textAnchor="middle" className="rp-map-lbl">{sg.orders.labels[i]}</text>
                  </g>
                );
              })}
            </svg>
            <div className="rp-small">Firing order (2×) dominates a healthy 4-cylinder; half-orders point to one cylinder.</div>
          </div>
        </div>
      </section>

      {/* ---- events + wear */}
      <section className="rp-section rp-two">
        <div>
          <SectionHead n="05" title="Drive events" note="When each safety rule first fired" />
          <div className="rp-card">
            <svg className="rp-timeline" viewBox="0 0 400 34" preserveAspectRatio="none" aria-label="Alert timeline">
              <line x1="0" x2="400" y1="17" y2="17" className="rp-track" vectorEffect="non-scaling-stroke" />
              {[0, 5, 10, 15].map((m) => (
                <g key={m}>
                  <line x1={(m * 60 / duration) * 400} x2={(m * 60 / duration) * 400} y1="13" y2="21" className="rp-track" vectorEffect="non-scaling-stroke" />
                </g>
              ))}
              {alerts.map((a) => <circle key={a.title} cx={(a.t / duration) * 400} cy="17" r="5" fill={COL[a.severity]} />)}
            </svg>
            <div className="rp-axis mono"><span>0 min</span><span>5</span><span>10</span><span>15</span></div>
            {alerts.length === 0 ? <div className="rp-empty">No safety rule fired during the drive.</div> : (
              <div className="rp-events">
                {alerts.map((a) => (
                  <div key={a.title} className="rp-event" style={{ '--c': COL[a.severity] }}>
                    <span className="mono rp-event-t">{fmtT(a.t)}</span>
                    <div><b>{a.title}</b><div className="rp-small">{a.message}</div></div>
                    <Pill status={a.severity} />
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
        <div>
          <SectionHead n="06" title="Component wear" note="Estimated remaining life" />
          <div className="rp-card rp-wear">
            {wr.components.map((c) => {
              const ws = c.health < 20 ? 'critical' : c.health < 40 ? 'warning' : 'ok';
              return (
                <div key={c.id} className="rp-wear-row">
                  <span>{c.name}</span>
                  <span className="rp-cells" aria-label={`${Math.round(c.health)}%`}>
                    {[...Array(20).keys()].map((i) => <i key={i} style={i < Math.round(c.health / 5) ? { background: COL[ws] } : null} />)}
                  </span>
                  <span className="mono rp-wear-num">{Math.round(c.health)}%</span>
                </div>
              );
            })}
          </div>
        </div>
      </section>

      {/* ---- recommendations */}
      <section className="rp-section">
        <SectionHead n="07" title="What to do" note={label(OBD_FAULTS, s.obd_fault) === 'No fault' && s.engine_fault === 'healthy' ? 'Routine' : 'In order of urgency'} />
        <ol className="rp-actions">
          {(actions.length ? actions : ['No action needed. Keep to the normal service schedule.']).map((a) => <li key={a}>{a}</li>)}
        </ol>
      </section>

      <footer className="rp-foot">
        <span>Simulated vehicle · scenario: engine {label(ENGINE_FAULTS, s.engine_fault).toLowerCase()}, vehicle {label(OBD_FAULTS, s.obd_fault).toLowerCase()}, severity {s.severity.toFixed(2)}</span>
        <span>AutoPulse is a decision aid, not a substitute for a workshop inspection.</span>
      </footer>
    </article>
  );
}

function SectionHead({ n, title, note }) {
  return (
    <div className="rp-sec-head">
      <span className="mono rp-sec-n">{n}</span>
      <h3>{title}</h3>
      {note && <span className="rp-small">{note}</span>}
    </div>
  );
}

function Kpi({ label: l, value, unit, sub, status }) {
  return (
    <div className={`rp-card rp-kpi ${status}`} style={{ '--c': COL[status] }}>
      <div className="rp-eyebrow">{l}</div>
      <div className="rp-kpi-val"><span className="mono">{value}</span><small>{unit}</small></div>
      <div className="rp-small">{sub}</div>
    </div>
  );
}
