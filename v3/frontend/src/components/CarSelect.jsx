// Car type dropdown. The wireframe preview only exists while the menu is open, and follows
// whichever option is hovered or focused, so it never sits on screen otherwise.
import { useEffect, useRef, useState } from 'react';
import { Car, Check, ChevronDown } from 'lucide-react';
import { CarThumb } from './Car3D.jsx';
import { CAR_INFO } from '../cars.js';

export default function CarSelect({ value, onChange, disabled = false }) {
  const [open, setOpen] = useState(false);
  const [peek, setPeek] = useState(value);
  const ref = useRef(null);

  useEffect(() => {
    if (!open) return undefined;
    const away = (e) => { if (!ref.current?.contains(e.target)) setOpen(false); };
    const esc = (e) => { if (e.key === 'Escape') setOpen(false); };
    document.addEventListener('pointerdown', away);
    document.addEventListener('keydown', esc);
    return () => { document.removeEventListener('pointerdown', away); document.removeEventListener('keydown', esc); };
  }, [open]);

  const cur = CAR_INFO[value] || { name: value, spec: '' };
  return (
    <div className="csel" ref={ref}>
      <button className="csel-btn" disabled={disabled} aria-haspopup="listbox" aria-expanded={open}
        onClick={() => { setPeek(value); setOpen((o) => !o); }}>
        <Car size={18} strokeWidth={1.7} color="var(--accent)" />
        <span className="csel-cur"><b>{cur.name}</b><small>{cur.spec}</small></span>
        <ChevronDown size={16} className={open ? 'flip' : ''} />
      </button>
      {open && (
        <div className="csel-pop fade-in" role="listbox" aria-label="Car type">
          <div className="csel-list">
            {Object.entries(CAR_INFO).map(([id, c]) => (
              <button key={id} role="option" aria-selected={id === value} className={`csel-opt ${id === value ? 'on' : ''}`}
                onMouseEnter={() => setPeek(id)} onFocus={() => setPeek(id)}
                onClick={() => { setOpen(false); if (id !== value) onChange(id); }}>
                <span><b>{c.name}</b><small>{c.spec}</small></span>
                {id === value && <Check size={15} color="var(--accent)" />}
              </button>
            ))}
          </div>
          <div className="csel-peek">
            <CarThumb type={peek} spin />
            <div className="eyebrow">{CAR_INFO[peek]?.name}</div>
          </div>
        </div>
      )}
    </div>
  );
}
