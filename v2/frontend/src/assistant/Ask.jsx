// Ask AutoPulse: an icon in the status bar (or Ctrl/⌘ K). On the cockpit the box opens above the car,
// in the space between the car's name and the readouts; elsewhere it drops from the icon. Answers are
// one short sentence from the live data; the app jumps to the screen that already shows the answer
// and spotlights the element. No long chat, no invented numbers.
import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { ArrowUpRight, BookOpen, CornerDownLeft, MessageCircleQuestion, Search, X } from 'lucide-react';
import { AlarmShape, prio } from '../components/hmi.jsx';
import { useLive } from '../live.jsx';
import { GLOSSARY, route, suggestions } from './intents.js';
import { goTo } from './nav.js';

const isMac = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent);
const PAGE_NAME = { overview: 'Cockpit', check: 'Health check', drive: 'Live drive', signatures: 'Signature lab', insights: 'Insights', evidence: 'Evidence' };

async function answer(question, live) {
  const r = route(question);
  const L = live.latest;
  if (r.kind === 'intent') {
    if (!L && !['evidence', 'matlab', 'wear', 'link'].includes(r.intent.id)) {
      return { text: 'No vehicle is streaming yet. Pair one first.', status: 'warning', nav: { action: 'pair' } };
    }
    return r.intent.answer(L || {}, live);
  }
  if (r.kind === 'glossary') {
    const [text, nav] = GLOSSARY[r.term];
    return { text, status: 'ok', nav, source: 'Glossary' };
  }
  try {
    const res = await fetch(`/api/ask/docs?q=${encodeURIComponent(question)}`).then((x) => x.json());
    if (res.answer) return { text: res.answer.sentence, status: 'ok', nav: null, source: `${res.answer.doc} · ${res.answer.title}` };
  } catch { /* fall through */ }
  if (r.fallback) {
    const [text, nav] = GLOSSARY[r.fallback];
    return { text, status: 'ok', nav, source: 'Glossary' };
  }
  return { text: 'I can answer about health, the engine, coolant, battery, oil, tyres, fuel, alerts, models, signatures and results.', status: 'ok', nav: null };
}

export default function Ask({ page }) {
  const live = useLive();
  const [open, setOpen] = useState(false);
  const [slot, setSlot] = useState(null);                  // the cockpit's space above the car, when it is on screen
  const pop = useRef(null);
  const [q, setQ] = useState('');
  const [log, setLog] = useState([]);                      // last few Q/A pairs, newest first
  const [busy, setBusy] = useState(false);
  const box = useRef(null);
  const input = useRef(null);

  useEffect(() => {
    const key = (e) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') { e.preventDefault(); setOpen((o) => !o); }
      if (e.key === 'Escape') setOpen(false);
    };
    const away = (e) => { if (open && !box.current?.contains(e.target) && !pop.current?.contains(e.target)) setOpen(false); };
    window.addEventListener('keydown', key);
    document.addEventListener('pointerdown', away);
    return () => { window.removeEventListener('keydown', key); document.removeEventListener('pointerdown', away); };
  }, [open]);
  useLayoutEffect(() => { setSlot(open ? document.getElementById('ask-slot') : null); }, [open, page, live.latest == null]);
  useEffect(() => { if (open) setTimeout(() => input.current?.focus(), 0); }, [open, slot]);

  const ask = async (question) => {
    const text = question.trim();
    if (!text || busy) return;
    setBusy(true);
    const a = await answer(text, live);
    setBusy(false);
    setLog((l) => [{ q: text, a }, ...l].slice(0, 4));
    setQ('');
    if (a.nav) goTo(a.nav);                                 // take them to the answer straight away
  };

  const where = (nav) => (nav?.action === 'pair' ? 'Vehicle link' : nav?.page ? PAGE_NAME[nav.page] : null);

  const panel = open && (
    <div ref={pop} className={`ask-pop fade-in ${slot ? 'in-slot' : ''}`} role="dialog" aria-label="Ask AutoPulse">
      <form className="ask-input" onSubmit={(e) => { e.preventDefault(); ask(q); }}>
        <Search size={15} />
        <input ref={input} autoFocus value={q} onChange={(e) => setQ(e.target.value)} placeholder="Why is the score low?  ·  What is knock?" />
        {q ? <button type="submit" className="ask-go" aria-label="Ask"><CornerDownLeft size={14} /></button>
          : <button type="button" className="ask-go" onClick={() => setOpen(false)} aria-label="Close"><X size={14} /></button>}
      </form>
      {log.length === 0 && (
        <div className="ask-sugg">
          <div className="label">Try</div>
          {suggestions(live.latest).map((s) => <button key={s} onClick={() => ask(s)}>{s}</button>)}
        </div>
      )}
      <div className="ask-log">
        {log.map(({ q: question, a }, i) => (
          <div key={`${question}-${i}`} className={`ask-item ${i === 0 ? 'latest' : ''}`}>
            <div className="ask-q">{question}</div>
            <div className="ask-a">
              {prio(a.status) ? <AlarmShape priority={prio(a.status)} size={14} /> : a.source ? <BookOpen size={14} className="muted" /> : <span className="ask-dot" />}
              <span>{a.text}</span>
            </div>
            {(a.nav || a.source) && (
              <div className="ask-meta">
                {a.nav && <button className="link-btn" onClick={() => goTo(a.nav)}><ArrowUpRight size={12} />{where(a.nav)}</button>}
                {a.source && <span className="muted">{a.source}</span>}
              </div>
            )}
          </div>
        ))}
      </div>
      <div className="ask-foot">Answers come from the live data and the project's docs. Nothing is generated.</div>
    </div>
  );

  return (
    <div className="ask" ref={box}>
      <button className={`ask-trigger ${open ? 'on' : ''}`} onClick={() => setOpen((o) => !o)} aria-expanded={open}
        aria-label="Ask AutoPulse" title={`Ask AutoPulse (${isMac ? '⌘' : 'Ctrl'} K)`}>
        <MessageCircleQuestion size={16} />
      </button>
      {panel && (slot ? createPortal(panel, slot) : panel)}
    </div>
  );
}
