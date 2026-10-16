// Link and node details that operators rarely need, moved out of the header: one button, one popover.
import { useEffect, useRef, useState } from 'react';
import { Activity } from 'lucide-react';
import { useLive } from '../live.jsx';
import { CAR_INFO } from '../cars.js';

const mmss = (s) => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;

export default function Diagnostics() {
  const { link, latest, api, replay } = useLive();
  const [open, setOpen] = useState(false);
  const box = useRef(null);
  const v = latest?.vehicle || link.vehicle;

  useEffect(() => {
    if (!open) return undefined;
    const away = (e) => { if (!box.current?.contains(e.target)) setOpen(false); };
    const esc = (e) => e.key === 'Escape' && setOpen(false);
    document.addEventListener('pointerdown', away);
    window.addEventListener('keydown', esc);
    return () => { document.removeEventListener('pointerdown', away); window.removeEventListener('keydown', esc); };
  }, [open]);

  const rows = [
    ['Node', v?.name ?? '–', v && CAR_INFO[v.car_type]?.spec],
    ['Trip', latest ? (latest.row.ignition ? mmss(latest.row.t) : 'engine off') : '–'],
    ['Frames', String(link.frames ?? 0)],
    ['Frame seq', latest ? String(latest.seq) : '–'],
    ['Link', `${link.state}${link.host ? ` · ${link.host}:${link.port}` : ''}`],
    ['Latency', link.latency_ms != null ? `${link.latency_ms} ms` : '–'],
    ['Dashboard API', api],
    ['Baseline', latest?.engine?.context ? `${latest.engine.context.replace('_', ' · ')} · ${latest.engine.learned} healthy s` : '–'],
  ];
  if (replay) rows.unshift(['Source', `replay "${replay}" (recorded, not live)`]);

  return (
    <div className="diag" ref={box}>
      <button className="btn ghost" aria-expanded={open} aria-haspopup="dialog" onClick={() => setOpen((o) => !o)}>
        <Activity size={15} />Diagnostics
      </button>
      {open && (
        <div className="diag-pop" role="dialog" aria-label="Diagnostics">
          <dl>{rows.map(([k, val, tip]) => <div key={k}><dt>{k}</dt><dd className="num" title={tip}>{val}</dd></div>)}</dl>
        </div>
      )}
    </div>
  );
}
