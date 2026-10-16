// The live feed from the dashboard API: link state (paired vehicle), the newest diagnosed
// frame, and a rolling 15-minute history for the charts. One WebSocket shared by every screen.
import { createContext, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { labStore } from './pages/lab/labStore.js';

const MAX = 900;
const Ctx = createContext(null);

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
    const open = () => {
      ws = new WebSocket(`${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/api/ws/live`);
      ws.onopen = () => setApi('open');
      ws.onmessage = (e) => {
        const m = JSON.parse(e.data);
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
          setHistory((h) => (changed ? [m.row] : [...(h.length >= MAX ? h.slice(h.length - MAX + 1) : h), m.row]));
          setLastAt(Date.now());
        }
      };
      ws.onclose = () => { setApi('closed'); if (!closed) timer = setTimeout(open, 1500); };
    };
    open();
    const tick = setInterval(() => setNow(Date.now()), 1000);
    return () => { closed = true; clearTimeout(timer); clearInterval(tick); ws?.close(); };
  }, []);

  const value = useMemo(() => {
    const live = link.state === 'live' && now - lastAt < 4000;
    return {
      link, latest, history, api, ready,
      live,
      stale: link.state === 'live' && !live,
      pair: (host, port, code) => post('/pair', { host, port: Number(port) || 8200, code }),
      unpair: () => post('/unpair').then((l) => { setLatest(null); setHistory([]); carRef.current = null; return l; }),
      serviced: () => post('/serviced'),
    };
  }, [link, latest, history, api, ready, now, lastAt]);
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export const useLive = () => useContext(Ctx);

/** Column of the rolling history, e.g. series(history, 'coolant_c'). */
export const series = (history, key) => history.map((r) => r[key]);
