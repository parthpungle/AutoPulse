import { useEffect, useRef } from 'react';
import type { CSSProperties } from 'react';
import { SENSORS } from '../../content/sensors';

interface Props {
  active: number;
  onSelect: (index: number) => void;
}

const pad = (n: number) => String(n).padStart(2, '0');

/** Bottom-left index of the Sensor Array: one button per sensor plus a live readout. */
export function SensorIndex({ active, onSelect }: Props) {
  const s = SENSORS[active];
  const list = useRef<HTMLOListElement>(null);
  // on phones the list is a horizontal chip scroller: keep the active chip in view (sideways only)
  useEffect(() => {
    const el = list.current;
    const chip = el?.children[active] as HTMLElement | undefined;
    if (!el || !chip || el.scrollWidth <= el.clientWidth) return;
    el.scrollTo({ left: chip.offsetLeft - (el.clientWidth - chip.offsetWidth) / 2, behavior: 'smooth' });
  }, [active]);
  return (
    <nav className="tt-index" aria-label="Sensor array" data-ui>
      <p className="tt-index__head">
        Sensor array <span>· {pad(SENSORS.length)}</span>
      </p>
      <ol className="tt-index__list" ref={list}>
        {SENSORS.map((x) => (
          <li key={x.key}>
            <button
              type="button"
              className={x.index === active ? 'on' : ''}
              aria-current={x.index === active ? 'true' : undefined}
              style={{ '--c': x.color } as CSSProperties}
              onClick={() => onSelect(x.index)}
            >
              <span className="tt-index__num">{pad(x.index + 1)}</span>
              <span className="tt-index__label">{x.indexLabel}</span>
            </button>
          </li>
        ))}
      </ol>
      <p className="tt-index__readout" style={{ '--c': s.color } as CSSProperties} aria-live="polite">
        <i aria-hidden="true" />
        {s.readout}
      </p>
    </nav>
  );
}
