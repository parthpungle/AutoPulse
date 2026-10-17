import { useEffect, useState } from 'react';

/** Width of an element, kept current with a ResizeObserver. */
export function useWidth(ref) {
  const [w, setW] = useState(0);
  useEffect(() => {
    if (!ref.current) return undefined;
    const ro = new ResizeObserver(([e]) => setW(Math.floor(e.contentRect.width)));
    ro.observe(ref.current);
    return () => ro.disconnect();
  }, [ref]);
  return w;
}

/** Width and height of an element, kept current with a ResizeObserver. */
export function useSize(ref) {
  const [s, setS] = useState({ w: 0, h: 0 });
  useEffect(() => {
    if (!ref.current) return undefined;
    const ro = new ResizeObserver(([e]) => setS({ w: Math.floor(e.contentRect.width), h: Math.floor(e.contentRect.height) }));
    ro.observe(ref.current);
    return () => ro.disconnect();
  }, [ref]);
  return s;
}
