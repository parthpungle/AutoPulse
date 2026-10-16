// Ask AutoPulse: questions → one short sentence from the live state, plus where in the UI to look.
// Deterministic on purpose: every number comes from the dashboard's own data, so it cannot make
// anything up, works offline, and answers instantly. Definitions fall back to GLOSSARY, then to a
// small search over the project's docs on the backend.

const norm = (s) => s.toLowerCase().replace(/[^a-z0-9°.%+\s-]/g, ' ').replace(/\s+/g, ' ').trim();
const f0 = (v) => (v == null ? '—' : Math.round(v));
const f1 = (v) => (v == null ? '—' : v.toFixed(1));
const sys = (L, id) => L.systems.find((s) => s.id === id);
const SEV = { critical: 3, warning: 2, info: 1, ok: 0 };
const worst = (L) => [...L.systems].sort((a, b) => SEV[b.status] - SEV[a.status])[0];
const ENGINE_VIEW = { misfire: 'crank', knock: 'spectrum', valve_tick: 'time', bearing: 'envelope', belt_squeal: 'spectrum', imbalance: 'orders', healthy: 'spectrum' };
const isOff = (L) => L.engine.state === 'off';

/** Each intent: words that suggest it (phrases count double), and an answer built from live data. */
export const INTENTS = [
  {
    id: 'health', words: ['score', 'health', 'how is my car', 'overall', 'safe to drive', 'why low', '~healthy', '~status', '~ok', '~okay', '~fine', '~problem', '~wrong'],
    answer: (L) => {
      const bad = L.systems.filter((s) => s.status !== 'ok');
      if (!bad.length) return { text: `Health ${L.score}/100: every system is normal.`, status: 'ok', nav: { page: 'overview', spot: 'health-score' } };
      const w = worst(L);
      return { text: `Health ${L.score}/100 (${L.verdict.toLowerCase()}): ${bad.map((s) => s.name).join(', ')}.`, status: w.status,
        nav: { page: 'check', select: w.id, spot: `check-${w.id}` } };
    },
  },
  {
    id: 'engine', words: ['engine', 'sound', 'vibration', 'misfire', 'knock', 'knocking', 'tick', 'tappet', 'valve', 'bearing', 'belt', 'squeal', 'imbalance', 'mount', 'noise', 'detonation'],
    answer: (L) => {
      if (isOff(L)) return { text: 'The engine is off, so there is no vibration to analyse.', status: 'ok', nav: { page: 'overview', spot: 'car-stage' } };
      const e = L.engine;
      const fault = e.fault && e.fault !== 'healthy' ? e.fault : 'healthy';
      const text = fault === 'healthy'
        ? `Engine sounds healthy (${Math.round(e.healthy_p * 100)}%), deviation ${f1(e.anomaly)} of ${e.threshold} from its normal.`
        : `${e.label}, ${Math.round(e.confidence * 100)}% confident from the vibration alone.`;
      return { text, status: e.status, nav: { page: 'signatures', tab: ENGINE_VIEW[fault], spot: 'sig-plot' } };
    },
  },
  {
    id: 'coolant', words: ['coolant', 'temperature', 'temp', 'overheat', 'overheating', 'hot', 'radiator', 'thermostat', 'cooling', 'leak coolant',
      'engine hot', 'engine is hot', 'running hot', 'too hot', 'heating up'],
    answer: (L) => {
      const c = L.row.coolant_c, s = sys(L, 'cooling');
      const text = c > 112 ? `Coolant ${f0(c)} °C, past the 112 °C limit: pull over and switch the engine off.`
        : s.status !== 'ok' ? `Coolant ${f0(c)} °C and rising: AC off, heater to max, head for a mechanic.`
          : `Coolant ${f0(c)} °C, ${c < 75 ? 'still warming up' : 'inside the 80–100 °C normal band'}.`;
      return { text, status: s.status, nav: { page: 'drive', tab: 'coolant', spot: 'drive-chart' } };
    },
  },
  {
    id: 'battery', words: ['battery', 'charging', 'charge', 'alternator', 'voltage', 'volt', 'electrical', '~start'],
    answer: (L) => {
      const s = sys(L, 'battery');
      return { text: s.status !== 'ok' ? `${s.detail}: the alternator is not keeping the battery charged.` : `${s.detail}; charging is normal.`,
        status: s.status, nav: { page: 'drive', tab: 'battery', spot: 'drive-chart' } };
    },
  },
  {
    id: 'oil', words: ['oil', 'lubrication', 'oil pressure', 'pressure oil'],
    answer: (L) => {
      const s = sys(L, 'oil');
      return { text: s.status !== 'ok' ? `${s.detail}: stop the engine, low oil pressure destroys it in minutes.` : `${s.detail}; normal for this speed.`,
        status: s.status, nav: { page: 'drive', tab: 'oil', spot: 'drive-chart' } };
    },
  },
  {
    id: 'tyres', words: ['tyre', 'tyres', 'tire', 'tires', 'puncture', 'flat', 'wheel', 'psi', 'tyre pressure'],
    answer: (L) => {
      const s = sys(L, 'tyres');
      return { text: s.status !== 'ok' ? `${s.detail}: ${s.status === 'critical' ? 'pull over safely' : 'top it up soon'}.` : `${s.detail}; all within 30–36 psi.`,
        status: s.status, nav: { page: 'drive', tab: 'tyres', spot: 'drive-chart' } };
    },
  },
  {
    id: 'fuel', words: ['fuel', 'petrol', 'gas', 'range', 'trim', 'lean', 'vacuum', 'fuel leak', 'tank', 'mileage'],
    answer: (L) => {
      const s = sys(L, 'fuel');
      const range = Math.round((L.row.fuel_level_pct / 100) * 45 / 6.5 * 100);
      return { text: s.status !== 'ok' ? `${s.detail}.` : `Fuel ${f0(L.row.fuel_level_pct)}% (about ${range} km), trims ${L.row.ltft_pct >= 0 ? '+' : ''}${f0(L.row.ltft_pct)}%.`,
        status: s.status, nav: { page: 'drive', tab: 'fuel', spot: 'drive-chart' } };
    },
  },
  {
    id: 'alerts', words: ['alert', 'alerts', 'alarm', 'warning', 'warnings', 'what should i do', 'what do i do', 'action', 'advice', 'guidance', 'help me', 'next step'],
    answer: (L) => {
      const a = L.alerts.find((x) => x.severity !== 'info') || L.alerts[0];
      if (!a) return { text: 'No alerts: every hard limit, rule and engine model is quiet.', status: 'ok', nav: { page: 'drive', spot: 'drive-alerts' } };
      return { text: `${a.title}: ${a.actions?.[0] || a.message}.`, status: a.severity, nav: { page: 'drive', spot: 'drive-alerts' } };
    },
  },
  {
    id: 'speed', words: ['speed', 'how fast', 'rpm', 'revs', 'kmh', 'km/h'],
    answer: (L) => ({ text: `${f0(L.row.speed_kph)} km/h at ${f0(L.row.rpm)} rpm.`, status: 'ok', nav: { page: 'overview', spot: 'readouts' } }),
  },
  {
    id: 'models', words: ['model', 'models', 'svm', 'cnn', 'ann', 'softmax', 'confidence', 'vote', 'votes', 'classifier', 'ai', 'ml', 'neural'],
    answer: (L) => {
      if (isOff(L) || !L.engine.votes) return { text: 'Four models vote on every second of engine vibration once the engine runs.', status: 'ok', nav: { page: 'signatures', spot: 'sig-votes' } };
      const picks = Object.entries(L.engine.votes).map(([m, p]) => `${m} ${L.engine.classes[p.indexOf(Math.max(...p))].split(' (')[0].toLowerCase()}`);
      return { text: `${picks.join(', ')}.`, status: L.engine.status, nav: { page: 'signatures', spot: 'sig-votes' } };
    },
  },
  {
    id: 'baseline', words: ['baseline', 'normal', 'deviation', 'anomaly', 'learned', 'learn', 'adaptive', 'its own normal', 'different'],
    answer: (L) => isOff(L)
      ? { text: 'The adaptive baseline learns this car\'s normal while the engine runs.', status: 'ok', nav: { page: 'insights', tab: 'baseline', spot: 'insights-panel' } }
      : { text: `Deviation ${f1(L.engine.anomaly)} of ${L.engine.threshold}, learned from ${L.engine.learned} s of this car.`, status: L.engine.anomaly > L.engine.threshold ? 'warning' : 'ok',
        nav: { page: 'overview', spot: 'deviation' } },
  },
  { id: 'waveform', words: ['waveform', 'wave', 'time domain', 'raw signal'], answer: () => ({ text: 'The latest second of block vibration, one impulse per firing.', status: 'ok', nav: { page: 'signatures', tab: 'time', spot: 'sig-plot' } }) },
  { id: 'spectrum', words: ['spectrum', 'fft', 'frequency', 'frequencies', 'hz'], answer: () => ({ text: 'Where the vibration energy sits; knock lifts the 5.5–8 kHz band.', status: 'ok', nav: { page: 'signatures', tab: 'spectrum', spot: 'sig-plot' } }) },
  { id: 'spectrogram', words: ['spectrogram', 'stft', 'heatmap', 'image'], answer: () => ({ text: 'The spectrum through one second, the image the CNN reads.', status: 'ok', nav: { page: 'signatures', tab: 'spectrogram', spot: 'sig-plot' } }) },
  { id: 'orders', words: ['order', 'orders', 'harmonic', 'harmonics'], answer: () => ({ text: 'Energy at multiples of crank speed: 0.5× misfire, 1× imbalance.', status: 'ok', nav: { page: 'signatures', tab: 'orders', spot: 'sig-plot' } }) },
  { id: 'crank', words: ['crank', 'crankshaft', 'cylinder', 'firing'], answer: () => ({ text: 'Crank speed at every firing; a misfiring cylinder shows as a dip.', status: 'ok', nav: { page: 'signatures', tab: 'crank', spot: 'sig-plot' } }) },
  { id: 'envelope', words: ['envelope', 'bpfo', 'impacts'], answer: () => ({ text: 'How often impacts repeat; a bearing defect peaks at its BPFO.', status: 'ok', nav: { page: 'signatures', tab: 'envelope', spot: 'sig-plot' } }) },
  {
    id: 'check', words: ['health check', 'scan', 'check all', 'subsystem', 'subsystems', 'systems', 'diagnose', 'diagnosis'],
    answer: (L) => ({ text: `${L.systems.filter((s) => s.status === 'ok').length} of ${L.systems.length} systems normal.`, status: worst(L).status, nav: { page: 'check', spot: 'health-ring' } }),
  },
  {
    id: 'trend', words: ['trend', 'history', 'last minutes', 'over time', 'graph', 'chart', 'telemetry', 'obd'],
    answer: () => ({ text: 'Live OBD-II telemetry against its hard limits, up to 15 minutes back.', status: 'ok', nav: { page: 'drive', spot: 'drive-chart' } }),
  },
  {
    id: 'wear', words: ['wear', 'service', 'brake', 'brakes', 'pads', 'tread', 'battery life', 'replace', 'maintenance', 'due'],
    answer: () => ({ text: 'Component wear like phone battery health: battery, oil life, brake pads, tyre tread.', status: 'ok', nav: { page: 'insights', tab: 'wear', spot: 'insights-panel' } }),
  },
  {
    id: 'evidence', words: ['how accurate', 'how well', 'accuracy', 'accurate', 'proof', 'evidence', 'results', 'real data', 'dataset', 'tested', 'validation', 'how good'],
    answer: () => ({ text: 'On 321 real engine recordings the SVM scores 90.3%, split by recording.', status: 'ok', nav: { page: 'evidence', tab: 'real', spot: 'evidence-panel' } }),
  },
  {
    id: 'matlab', words: ['matlab', 'simulink', 'mathworks', 'cross check', 'crosscheck'],
    answer: () => ({ text: 'MathWorks\' Simulink misfire engine: 11 of 11 misfires caught, run blind.', status: 'ok', nav: { page: 'evidence', tab: 'matlab', spot: 'evidence-panel' } }),
  },
  {
    id: 'link', words: ['connection', 'connected', 'pair', 'paired', 'pairing', 'link', 'latency', 'vehicle laptop', 'network', 'wifi', 'disconnected'],
    answer: (L, ctx) => ({ text: ctx.live ? `Live from ${L.vehicle.name}, ${ctx.link.frames} frames${ctx.link.latency_ms != null ? `, ${ctx.link.latency_ms} ms` : ''}.` : 'No live data from the vehicle right now.',
      status: ctx.live ? 'ok' : 'warning', nav: { action: 'pair' } }),
  },
  {
    id: 'car', words: ['which car', 'what car', 'car type', 'unit', 'vehicle', 'model of car', 'sedan', 'suv', 'pickup', 'coupe', 'hatchback'],
    answer: (L) => ({ text: `${L.vehicle.label}, unit ${L.vehicle.unit}, streaming from ${L.vehicle.name}.`, status: 'ok', nav: { page: 'overview', spot: 'car-stage' } }),
  },
];

/** Short definitions; the doc search on the backend covers the rest. */
export const GLOSSARY = {
  misfire: ['A cylinder that fails to burn its charge, so the crank slows on its stroke.', { page: 'signatures', tab: 'crank', spot: 'sig-plot' }],
  knock: ['Fuel detonating instead of burning smoothly; it rings at 5.5–8 kHz and damages pistons.', { page: 'signatures', tab: 'spectrum', spot: 'sig-plot' }],
  p0300: ['OBD-II code for random or multiple cylinder misfire.', { page: 'check', select: 'ecu', spot: 'check-ecu' }],
  obd: ['On-Board Diagnostics II: the port every modern car has, serving live engine data and fault codes.', null],
  ltft: ['Long-term fuel trim: how much fuel the ECU adds or removes; lean trims at idle suggest a vacuum leak.', { page: 'drive', tab: 'fuel', spot: 'drive-chart' }],
  'fuel trim': ['How much fuel the ECU adds or removes; lean trims at idle suggest a vacuum leak.', { page: 'drive', tab: 'fuel', spot: 'drive-chart' }],
  bpfo: ['Ball-pass frequency of the outer race: how often a damaged bearing is struck.', { page: 'signatures', tab: 'envelope', spot: 'sig-plot' }],
  spectrogram: ['A picture of frequency against time; the CNN classifies it like an image.', { page: 'signatures', tab: 'spectrogram', spot: 'sig-plot' }],
  'adaptive baseline': ['A per-car normal learned per engine state, so seasons and ageing don\'t raise false alarms.', { page: 'insights', tab: 'baseline', spot: 'insights-panel' }],
  isa: ['ISA-101 and ISA-18.2: control-room standards; grey when healthy, colour and shape only for alarms.', null],
  'health score': ['100 minus 35 per critical, 12 per warning and 4 per note across the eight subsystems.', { page: 'check', spot: 'health-ring' }],
};

// a phrase counts 2, a word 1, a weak word (~) 0.5, so "what is wrong with the engine" goes to engine
const scoreIntent = (q, it) => it.words.reduce((s, raw) => {
  const weak = raw.startsWith('~');
  const w = weak ? raw.slice(1) : raw;
  if (!new RegExp(`\\b${w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`).test(q)) return s;
  return s + (w.includes(' ') ? 2 : weak ? 0.5 : 1);
}, 0);

/** Returns { kind: 'intent'|'glossary'|'docs'|'none', ... } for a question. */
export function route(question) {
  const q = norm(question);
  if (!q) return { kind: 'none' };
  const defining = /^(what is|what's|whats|what are|what does|define|meaning of|explain|why does)\b/.test(q);
  const term = Object.keys(GLOSSARY).find((t) => new RegExp(`\\b${t}\\b`).test(q));
  // a bare term ("what is knock") gets the glossary line; a more specific question
  // ("what is an OBD readiness monitor") tries the docs first and keeps the glossary as a fallback
  const extra = term && q.replace(/^(what is|what's|whats|what are|what does|define|meaning of|explain|why does)\b/, '')
    .replace(new RegExp(`\\b${term}\\b`), '').split(' ').filter((w) => w.length > 2 && !['the', 'and', 'mean', 'means', 'for'].includes(w));
  if (defining && term && extra.length > 1) return { kind: 'docs', q: question, fallback: term };
  if (defining && term) return { kind: 'glossary', term };
  const ranked = INTENTS.map((it) => ({ it, s: scoreIntent(q, it) })).filter((r) => r.s > 0).sort((a, b) => b.s - a.s);
  if (ranked.length && !defining) return { kind: 'intent', intent: ranked[0].it };
  if (term) return { kind: 'glossary', term };
  if (ranked.length) return { kind: 'intent', intent: ranked[0].it };
  return { kind: 'docs', q: question };
}

/** Starter questions, picked from what is happening right now. */
export function suggestions(L) {
  if (!L) return ['Is the vehicle connected?', 'How accurate are the models?', 'What is the adaptive baseline?'];
  const out = [];
  const bad = L.systems.filter((s) => s.status !== 'ok');
  if (bad.length) out.push('Why is the health score low?');
  if (L.engine.state !== 'off' && L.engine.fault && L.engine.fault !== 'healthy') out.push('What is wrong with the engine?');
  if (L.alerts.length) out.push('What should I do?');
  for (const s of bad) {
    const q = { cooling: 'Why is the engine hot?', battery: 'Is the battery charging?', tyres: 'Which tyre is low?', oil: 'Is the oil pressure ok?', fuel: 'Is there a fuel problem?' }[s.id];
    if (q && !out.includes(q)) out.push(q);
  }
  for (const q of ['Is the engine healthy?', 'Show me the spectrum', 'How accurate are the models?', 'What is knock?']) if (out.length < 4 && !out.includes(q)) out.push(q);
  return out.slice(0, 4);
}
