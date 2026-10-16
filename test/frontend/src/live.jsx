// The live feed from the dashboard API: link state (paired vehicle), the newest diagnosed
// frame, and a rolling 15-minute history for the charts. One WebSocket shared by every screen.
import { createContext, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { labStore } from './pages/lab/labStore.js';

const MAX = 900;
const Ctx = createContext(null);

// Demo safety: record the raw frames (dev only, from the Signature lab), and play a saved recording
// back with /dashboard?replay=<name> (public/replays/<name>.json) instead of the live socket. A replay
// is always labelled as one, and pairing, unpairing and "serviced" do nothing while it plays.
const REPLAY = new URLSearchParams(location.search).get('replay');
const rec = { on: false, frames: [], history: [] };
export const recorder = {
  start(history) { rec.on = true; rec.frames = []; rec.history = history; },
  stop() { rec.on = false; return { version: 1, recorded: new Date().toISOString(), history: rec.history, frames: rec.frames }; },
  get on() { return rec.on; },
  get count() { return rec.frames.length; },
};

async function post(path, body) {
  const r = await fetch('/api' + path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body ?? {}) });
  if (!r.ok) throw new Error(`${path}: HTTP ${r.status}`);
  return r.json();
}

export function LiveProvider({ children }) {
  const [link, setLink] = useState({ state: 'unpaired' });
  const [latest, setLatest] = useState(null);
  const [history, setHistory] = useState([]);
  const [api, setApi] = useState('connecting');           // this page <-> the dashboard API
  const [ready, setReady] = useState(false);               // first hello received: link state is real
  const [lastAt, setLastAt] = useState(0);
  const [now, setNow] = useState(Date.now());
  const carRef = useRef(null);

  useEffect(() => {
    let ws, timer, closed = false;
    const handle = (m) => {
        if (m.type === 'hello') {
          setLink(m.link); setHistory(m.history || []); setLatest(m.latest); setReady(true);
          carRef.current = m.latest ? `${m.latest.vehicle.car_type}/${m.latest.vehicle.unit}` : null;
          if (m.latest) { setLastAt(Date.now()); labStore.push(m.latest); }
        } else if (m.type === 'link') {
          setLink(m.link);
        } else if (m.type === 'frame') {
          setLink(m.link);
          const key = `${m.vehicle.car_type}/${m.vehicle.unit}`;
          const changed = carRef.current !== null && carRef.current !== key;   // a different car: start the charts over
          carRef.current = key;
          setLatest(m);
          labStore.push(m);                                     // the Signature lab keeps its own rolling buffer
          if (rec.on) rec.frames.push(m);
          setHistory((h) => (changed ? [m.row] : [...(h.length >= MAX ? h.slice(h.length - MAX + 1) : h), m.row]));
          setLastAt(Date.now());
        }
    };
    const open = () => {
      ws = new WebSocket(`${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/api/ws/live`);
      ws.onopen = () => setApi('open');
      ws.onmessage = (e) => handle(JSON.parse(e.data));
      ws.onclose = () => { setApi('closed'); if (!closed) timer = setTimeout(open, 1500); };
    };
    // a recording plays once a second, in a loop; clocks keep counting up across loops so the
    // charts and the lab's timeline stay in order
    const replay = async () => {
      const r = await fetch(`/replays/${encodeURIComponent(REPLAY)}.json`);
      if (!r.ok) { setApi('closed'); setReady(true); setLink({ state: 'error', error: `Replay "${REPLAY}" not found in public/replays/` }); return; }
      const data = await r.json();
      const first = data.frames[0], last = data.frames[data.frames.length - 1];
      const span = last.row.clock - first.row.clock + 1;
      const link = { state: 'live', replay: REPLAY, host: 'replay', port: 0, vehicle: first.vehicle, error: null, since: Date.now() / 1000, frames: 0, latency_ms: null };
      setApi('open');
      handle({ type: 'hello', link, history: data.history ?? [], latest: null });
      let i = 0;
      const step = () => {
        const loop = Math.floor(i / data.frames.length), f = data.frames[i % data.frames.length];
        const shift = loop * span;
        handle({ ...f, seq: f.seq + shift, row: { ...f.row, clock: f.row.clock + shift }, link: { ...link, frames: i + 1 } });
        i++;
      };
      step();
      timer = setInterval(step, 1000);
    };
    if (REPLAY) replay(); else open();
    const tick = setInterval(() => setNow(Date.now()), 1000);
    return () => { closed = true; clearTimeout(timer); clearInterval(timer); clearInterval(tick); ws?.close(); };
  }, []);

  const value = useMemo(() => {
    const live = link.state === 'live' && now - lastAt < 4000;
    return {
      link, latest, history, api, ready,
      live,
      stale: link.state === 'live' && !live,
      replay: REPLAY,
      pair: (host, port, code) => (REPLAY ? Promise.resolve(link) : post('/pair', { host, port: Number(port) || 8200, code })),
      unpair: () => (REPLAY ? Promise.resolve(link) : post('/unpair').then((l) => { setLatest(null); setHistory([]); carRef.current = null; return l; })),
      serviced: () => (REPLAY ? Promise.resolve({ ok: true }) : post('/serviced')),
    };
  }, [link, latest, history, api, ready, now, lastAt]);
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export const useLive = () => useContext(Ctx);

/** Column of the rolling history, e.g. series(history, 'coolant_c'). */
export const series = (history, key) => history.map((r) => r[key]);
