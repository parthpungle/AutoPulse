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

/** Multipart upload for /api/vibration/analyze. Resolves to the JSON body; rejects with Error(message, {code}). */
export async function analyzeVibration(form) {
  let r;
  try { r = await fetch('/api/vibration/analyze', { method: 'POST', body: form }); }
  catch { throw new Error('Could not reach the AutoPulse API. Is the backend running?'); }
  const body = await r.json().catch(() => null);
  if (!r.ok) {
    const e = new Error(body?.message || (typeof body?.detail === 'string' ? body.detail : `Analysis failed (HTTP ${r.status})`));
    e.code = body?.code;
    throw e;
  }
  return body;
}
