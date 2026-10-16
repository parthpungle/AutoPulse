// Pair this dashboard with a vehicle: pick one the network announced, or type its address,
// then enter the 4-digit code the vehicle laptop shows.
import { useEffect, useState } from 'react';
import { Link2, Link2Off, LoaderCircle, Radio, X } from 'lucide-react';
import { useLive } from '../live.jsx';
import { carName } from '../cars.js';
import { LinkPill } from './LinkPill.jsx';

export default function PairDrawer({ onClose }) {
  const { link, pair, unpair } = useLive();
  const [found, setFound] = useState([]);
  const [host, setHost] = useState(link.host || '');
  const [port, setPort] = useState(link.port || 8200);
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState(null);

  useEffect(() => {
    let stop = false;
    const look = () => fetch('/api/discover').then((r) => r.json()).then((d) => !stop && setFound(d.vehicles)).catch(() => {});
    look();
    const id = setInterval(look, 2000);
    return () => { stop = true; clearInterval(id); };
  }, []);

  const go = async (e) => {
    e.preventDefault();
    setBusy(true); setErr(null);
    try {
      const l = await pair(host, port, code);
      if (l.state === 'live') onClose();
      else setErr(l.error || 'The vehicle has not answered yet. Check the address, and that both laptops are on the same Wi-Fi.');
    } catch (ex) {
      setErr(String(ex.message || ex));
    } finally {
      setBusy(false);
    }
  };

  const paired = ['live', 'connecting', 'lost'].includes(link.state);
  return (
    <>
      <div className="scrim" onClick={onClose} />
      <aside className="drawer" role="dialog" aria-label="Vehicle link" style={{ width: 400 }}>
        <div className="row">
          <div>
            <div className="eyebrow accent">Vehicle link</div>
            <div style={{ fontSize: 18, fontWeight: 600, marginTop: 4 }}>Pair with a car</div>
          </div>
          <div className="spacer" />
          <button className="btn ghost" onClick={onClose} aria-label="Close"><X size={16} /></button>
        </div>

        {paired && (
          <div className="panel panel-pad stack" style={{ gap: 10 }}>
            <LinkPill />
            <div className="note">{link.vehicle ? `${carName(link.vehicle.car_type)} · unit ${link.vehicle.unit} on ${link.vehicle.name}` : 'Waiting for the first frame…'}
              <br /><span className="muted">{link.host}:{link.port} · {link.frames || 0} frames</span></div>
            <button className="btn" onClick={() => unpair()}><Link2Off size={15} />Unpair</button>
          </div>
        )}

        <div>
          <div className="eyebrow" style={{ marginBottom: 8 }}>On this network</div>
          {found.length === 0 ? (
            <div className="note row" style={{ gap: 8 }}><Radio size={15} className="pulse-ico" />Listening for vehicles…</div>
          ) : (
            <div className="pair-list">
              {found.map((v) => (
                <button key={`${v.ip}:${v.port}`} className={`pair-opt ${host === v.ip && +port === v.port ? 'on' : ''}`}
                  onClick={() => { setHost(v.ip); setPort(v.port); }}>
                  <span className={`dot ${v.ignition ? 'on' : ''}`} />
                  <span><b>{v.name}{v.local ? ' (this laptop)' : ''}</b><small>{carName(v.car_type)} · unit {v.unit} · {v.ignition ? 'engine running' : 'engine off'}</small></span>
                  <code>{v.ip}</code>
                </button>
              ))}
            </div>
          )}
        </div>

        <form className="stack" style={{ gap: 14 }} onSubmit={go}>
          <div className="row" style={{ gap: 10, alignItems: 'flex-end' }}>
            <label className="field" style={{ flex: 1 }}>Vehicle address
              <input className="input" value={host} onChange={(e) => setHost(e.target.value)} placeholder="192.168.1.23" required />
            </label>
            <label className="field" style={{ width: 90 }}>Port
              <input className="input" value={port} onChange={(e) => setPort(e.target.value)} inputMode="numeric" />
            </label>
          </div>
          <label className="field">Pairing code (shown on the vehicle laptop)
            <input className="input code" value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
              placeholder="0000" inputMode="numeric" required />
          </label>
          {err && <div className="form-err">{err}</div>}
          <button className="btn primary" disabled={busy || !host || code.length < 4} type="submit">
            {busy ? <LoaderCircle size={16} className="spin" /> : <Link2 size={16} />}{busy ? 'Pairing…' : 'Pair'}
          </button>
        </form>
        <div className="spacer" />
        <p className="note muted" style={{ margin: 0 }}>
          The vehicle laptop prints its address and code when its run.bat starts, and shows them at the top of its control panel.
          If nothing appears above, type the address in: some networks block broadcast discovery.
        </p>
      </aside>
    </>
  );
}
