// Vehicle link: one obvious next step at a time.
//   Connected     → what you're connected to, Disconnect, Switch vehicle. No form.
//   Not connected → 1 choose the vehicle (found on the network, or type its address: checked at once)
//                   2 enter the code it shows → Connect. Failures say what to fix.
import { useEffect, useRef, useState } from 'react';
import { Check, ChevronDown, CircleAlert, Link2, Link2Off, LoaderCircle, Monitor, Radio, RefreshCw, X } from 'lucide-react';
import { useLive } from '../live.jsx';
import { carName } from '../cars.js';

const STREAM_PORT = 8200;

function Connected({ link, live, stale, onDisconnect, onSwitch }) {
  const v = link.vehicle;
  const reconnecting = link.state === 'lost' || stale;
  return (
    <div className="vl-connected">
      <div className={`vl-status ${reconnecting ? 'warn' : 'ok'}`}>
        {reconnecting ? <LoaderCircle size={18} className="spin" /> : <span className="vl-live" />}
        <div>
          <div className="vl-title">{reconnecting ? 'Reconnecting…' : 'Connected'}</div>
          <div className="muted">{reconnecting ? (link.error || 'Waiting for the vehicle to come back.') : 'Live data from the vehicle'}</div>
        </div>
      </div>
      <dl className="vl-facts">
        <dt>Car</dt><dd>{v ? `${carName(v.car_type)} · unit ${v.unit}` : '—'}</dd>
        <dt>Vehicle laptop</dt><dd>{v?.name || '—'}</dd>
        <dt>Address</dt><dd className="num">{link.host}:{link.port}</dd>
        <dt>Link</dt><dd className="num">{link.frames || 0} frames{live && link.latency_ms != null ? ` · ${link.latency_ms} ms` : ''}</dd>
      </dl>
      <div className="vl-actions">
        <button className="btn" onClick={onDisconnect}><Link2Off size={14} />Disconnect</button>
        <button className="btn ghost" onClick={onSwitch}><RefreshCw size={14} />Switch vehicle</button>
      </div>
      <p className="note muted">Disconnect before you move to a different vehicle laptop, or use Switch vehicle to do both at once.</p>
    </div>
  );
}

export default function PairDrawer({ onClose }) {
  const live = useLive();
  const { link, pair, unpair } = live;
  const connectedNow = ['live', 'lost'].includes(link.state);
  const [picking, setPicking] = useState(!connectedNow);   // false while showing the connected card
  const [found, setFound] = useState([]);
  const [target, setTarget] = useState(null);              // { host, port, name, car_type, unit }
  const [manual, setManual] = useState(false);
  const [addr, setAddr] = useState('');
  const [port, setPort] = useState(STREAM_PORT);
  const [showPort, setShowPort] = useState(false);
  const [check, setCheck] = useState(null);                // probe result for a typed address
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState(link.state === 'error' ? link.error : null);
  const codeRef = useRef(null);

  useEffect(() => { if (!connectedNow) setPicking(true); }, [connectedNow]);

  useEffect(() => {                                        // listen for vehicles while choosing
    if (!picking) return undefined;
    let stop = false;
    const look = () => fetch('/api/discover').then((r) => r.json()).then((d) => {
      if (stop) return;
      setFound(d.vehicles);
      if (!manual && d.vehicles.length === 1) setTarget((t) => t || { host: d.vehicles[0].ip, port: d.vehicles[0].port, ...d.vehicles[0] });
    }).catch(() => {});
    look();
    const id = setInterval(look, 2000);
    return () => { stop = true; clearInterval(id); };
  }, [picking, manual]);

  useEffect(() => {                                        // check a typed address as soon as it looks complete
    if (!manual) return undefined;
    const host = addr.trim();
    setCheck(null);
    if (!/^[\w.-]+$/.test(host) || host.length < 4) { setTarget(null); return undefined; }
    const t = setTimeout(async () => {
      setCheck({ busy: true });
      try {
        const r = await fetch(`/api/probe?host=${encodeURIComponent(host)}&port=${Number(port) || STREAM_PORT}`).then((x) => x.json());
        setCheck(r);
        setTarget(r.ok ? { host, port: Number(port) || STREAM_PORT, ...r } : null);
      } catch { setCheck({ ok: false, error: 'The dashboard API is not answering.' }); }
    }, 600);
    return () => clearTimeout(t);
  }, [addr, port, manual]);

  useEffect(() => { if (target) setTimeout(() => codeRef.current?.focus(), 0); }, [target]);

  const connect = async (e) => {
    e.preventDefault();
    if (!target || code.length < 4) return;
    setBusy(true); setErr(null);
    try {
      const l = await pair(target.host, target.port, code);
      if (l.state === 'live') { setPicking(false); setTimeout(onClose, 700); }
      else {
        setErr(l.error || 'The vehicle did not answer. Check the address and that both laptops are on the same network.');
        if ((l.error || '').startsWith('Wrong code')) { setCode(''); codeRef.current?.focus(); }
      }
    } catch (ex) {
      setErr(String(ex.message || ex));
    } finally {
      setBusy(false);
    }
  };

  const disconnect = async () => { await unpair(); setPicking(true); setCode(''); setErr(null); };
  const switchVehicle = async () => { await unpair(); setTarget(null); setCode(''); setErr(null); setPicking(true); };
  const choose = (v) => { setManual(false); setErr(null); setTarget({ host: v.ip, port: v.port, ...v }); };

  return (
    <>
      <div className="scrim" onClick={onClose} />
      <aside className="drawer vl" role="dialog" aria-label="Vehicle link">
        <div className="row">
          <div>
            <div className="eyebrow accent">Vehicle link</div>
            <div className="vl-h">{picking ? 'Connect to a vehicle' : 'Vehicle connected'}</div>
          </div>
          <div className="spacer" />
          <button className="btn ghost" onClick={onClose} aria-label="Close"><X size={16} /></button>
        </div>

        {!picking ? (
          <Connected link={link} live={live.live} stale={live.stale} onDisconnect={disconnect} onSwitch={switchVehicle} />
        ) : (
          <form className="vl-flow" onSubmit={connect}>
            {/* step 1: which vehicle */}
            <section className={`vl-step ${target ? 'done' : 'now'}`}>
              <div className="vl-step-h"><span className="vl-n">{target ? <Check size={12} /> : 1}</span>Choose the vehicle</div>
              {!manual && (
                <>
                  {found.length === 0 ? (
                    <div className="vl-empty"><Radio size={15} className="pulse-ico" />Looking for vehicles on this network…</div>
                  ) : (
                    <div className="vl-list" role="radiogroup">
                      {found.map((v) => {
                        const on = target && target.host === v.ip && target.port === v.port;
                        return (
                          <button type="button" role="radio" aria-checked={!!on} key={`${v.ip}:${v.port}`} className={`vl-card ${on ? 'on' : ''}`} onClick={() => choose(v)}>
                            <Monitor size={18} />
                            <span className="vl-card-t"><b>{v.name}{v.local ? ' · this laptop' : ''}</b>
                              <small>{carName(v.car_type)} · unit {v.unit} · {v.ignition ? 'engine running' : 'engine off'}</small></span>
                            <span className="num muted">{v.ip}</span>
                            {on && <Check size={16} color="var(--accent)" />}
                          </button>
                        );
                      })}
                    </div>
                  )}
                  <button type="button" className="link-btn vl-alt" onClick={() => { setManual(true); setTarget(null); }}>
                    Not in the list? Type its address
                  </button>
                </>
              )}
              {manual && (
                <div className="vl-manual">
                  <label className="field">Vehicle laptop's address
                    <input className="input" value={addr} onChange={(e) => setAddr(e.target.value)} placeholder="e.g. 192.168.1.23" autoFocus />
                  </label>
                  <div className="vl-check">
                    {check?.busy && <><LoaderCircle size={14} className="spin" />Checking {addr.trim()}…</>}
                    {check?.ok && <><Check size={14} color="var(--accent)" />Found {check.name} · {carName(check.car_type)}</>}
                    {check && !check.busy && !check.ok && <><CircleAlert size={14} color="var(--p2)" />{check.error}</>}
                    {!check && <span className="muted">It's printed in the vehicle laptop's window and on its control panel.</span>}
                  </div>
                  <div className="row" style={{ gap: 12 }}>
                    <button type="button" className="link-btn" onClick={() => setManual(false)}>← Back to the list</button>
                    <span className="spacer" />
                    {showPort ? (
                      <label className="row" style={{ gap: 6, fontSize: 12 }}>Port<input className="input" style={{ width: 80, height: 28 }} value={port} onChange={(e) => setPort(e.target.value)} inputMode="numeric" /></label>
                    ) : <button type="button" className="link-btn" onClick={() => setShowPort(true)}>Port {port} <ChevronDown size={12} /></button>}
                  </div>
                </div>
              )}
            </section>

            {/* step 2: the code */}
            <section className={`vl-step ${target ? 'now' : 'later'}`}>
              <div className="vl-step-h"><span className="vl-n">2</span>Enter the code shown on {target?.name || 'the vehicle'}</div>
              <input ref={codeRef} className="input code" value={code} disabled={!target}
                onChange={(e) => setCode(e.target.value.replace(/\D/g, '').slice(0, 6))} placeholder="0000" inputMode="numeric" aria-label="Pairing code" />
            </section>

            {err && <div className="form-err">{err}</div>}
            <button className="btn primary vl-go" disabled={busy || !target || code.length < 4} type="submit">
              {busy ? <LoaderCircle size={16} className="spin" /> : link.state === 'live' ? <Check size={16} /> : <Link2 size={16} />}
              {busy ? `Connecting to ${target?.name || target?.host}…` : 'Connect'}
            </button>

            <details className="vl-help">
              <summary>Can't connect?</summary>
              <ul>
                <li>Both laptops on the same Wi-Fi (or the same phone hotspot). Campus and hotel Wi-Fi often block laptop-to-laptop traffic.</li>
                <li>On the vehicle laptop, allow Python through the firewall. Windows: <em>Allow</em> on private networks. macOS: <em>Allow incoming connections</em>.</li>
                <li>Start the vehicle first (run.bat / run.command, role 1). Its code changes every time it starts.</li>
                <li>Not in the list? Type the address shown on the vehicle: some networks block discovery but still allow connecting.</li>
              </ul>
            </details>
          </form>
        )}
      </aside>
    </>
  );
}
