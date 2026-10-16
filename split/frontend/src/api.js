// Thin client for the Python API (backend/app.py). Responses are cached by request so
// switching tabs back and forth never refetches the same scenario.
import { useEffect, useRef, useState } from 'react';

const cache = new Map();

async function call(path, body) {
  const key = path + JSON.stringify(body ?? null);
  if (cache.has(key)) return cache.get(key);
  const p = fetch('/api' + path, body === undefined ? {} : {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
  }).then((r) => {
    if (!r.ok) throw new Error(`${path}: HTTP ${r.status}`);
    return r.json();
  });
  cache.set(key, p);
  p.catch(() => cache.delete(key));
  return p;
}

/** POST one audio file to the real-audio models. Throws an Error carrying the server's message (413/415/503). */
export async function classifyAudio(blob, name = 'clip.wav') {
  const form = new FormData();
  form.append('file', blob, name);
  const r = await fetch('/api/classify-audio', { method: 'POST', body: form });
  const body = await r.json().catch(() => ({}));
  if (!r.ok) throw Object.assign(new Error(body.detail || `classify-audio: HTTP ${r.status}`), { status: r.status });
  return body;
}

/** useApi('/startup', scenario) -> { data, loading, error }. Keeps the previous data while
 *  refetching, so charts dim instead of flashing empty. */
export function useApi(path, body) {
  const [state, setState] = useState({ data: null, loading: true, error: null });
  const key = JSON.stringify(body ?? null);
  const seq = useRef(0);
  useEffect(() => {
    const id = ++seq.current;
    setState((s) => ({ ...s, loading: true, error: null }));
    call(path, body).then(
      (data) => id === seq.current && setState({ data, loading: false, error: null }),
      (error) => id === seq.current && setState((s) => ({ ...s, loading: false, error })),
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [path, key]);
  return state;
}
