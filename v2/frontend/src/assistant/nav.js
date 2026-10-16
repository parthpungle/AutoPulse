// Navigation for the assistant: go to a screen, switch it to the right tab, and spotlight the
// element that answers the question. Elements opt in with data-spot="<id>".
import { useEffect } from 'react';

let last = null;

/** goTo({ page, tab, select, spot, action }) — App switches page; pages pick up tab/select; spot pulses. */
export function goTo(nav) {
  last = { ...nav, at: Date.now() };
  window.dispatchEvent(new CustomEvent('autopulse:goto', { detail: last }));
}

/** A page applies a pending tab (or selection) once, on mount or while already open. */
export function useNavTarget(page, key, apply) {
  useEffect(() => {
    if (last && last.page === page && last[key] != null && Date.now() - last.at < 4000) apply(last[key]);
    const on = (e) => { if (e.detail.page === page && e.detail[key] != null) apply(e.detail[key]); };
    window.addEventListener('autopulse:goto', on);
    return () => window.removeEventListener('autopulse:goto', on);
  }, [page, key]); // eslint-disable-line react-hooks/exhaustive-deps
}

/** Pulse an element for ~3 s; retries while the target screen is still mounting. */
export function spotlight(id, tries = 25) {
  if (!id) return;
  const el = document.querySelector(`[data-spot="${id}"]`);
  if (!el) {
    if (tries > 0) setTimeout(() => spotlight(id, tries - 1), 120);
    return;
  }
  el.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  el.classList.remove('spot');
  void el.offsetWidth;                                   // restart the animation
  el.classList.add('spot');
  setTimeout(() => el.classList.remove('spot'), 3300);
}
