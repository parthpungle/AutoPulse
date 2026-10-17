// Sends one window of buffered microphone audio to the backend every hop, never more than one at a time.

export class ApiError extends Error {
  constructor(code, message, status = null) {
    super(message);
    this.code = code;
    this.status = status;
  }
}

/** POST raw float32 samples (platform byte order: little-endian on every desktop/mobile CPU). */
export async function analyzeWindow(samples, sampleRate, { timeoutMs = 6000, signal, fetchImpl = globalThis.fetch } = {}) {
  const ctrl = new AbortController();
  let timedOut = false;
  const timer = setTimeout(() => { timedOut = true; ctrl.abort(); }, timeoutMs);
  const onAbort = () => ctrl.abort();
  signal?.addEventListener('abort', onAbort);
  let r;
  try {
    r = await fetchImpl(`/api/live-audio/analyze?sample_rate=${Math.round(sampleRate)}`, {
      method: 'POST', headers: { 'Content-Type': 'application/octet-stream' }, body: samples, signal: ctrl.signal,
    });
  } catch (e) {
    if (timedOut) throw new ApiError('timeout', `No answer from the analysis server within ${timeoutMs / 1000} s.`);
    if (signal?.aborted) throw new ApiError('aborted', 'Request cancelled.');
    throw new ApiError('network', 'Cannot reach the AutoPulse API (is the backend running on port 8000?).');
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener('abort', onAbort);
  }
  if (r.ok) return r.json();
  let detail = `HTTP ${r.status}`;
  try { detail = (await r.json()).detail || detail; } catch { /* not JSON */ }
  const code = { 413: 'invalid_audio', 415: 'invalid_audio', 422: 'invalid_audio', 429: 'busy', 504: 'timeout' }[r.status] || 'server';
  throw new ApiError(code, detail, r.status);
}

export async function fetchLiveStatus(fetchImpl = globalThis.fetch) {
  const r = await fetchImpl('/api/live-audio/status');
  if (!r.ok) throw new ApiError('server', `status: HTTP ${r.status}`, r.status);
  return r.json();
}

export class LiveAnalyzer {
  constructor({ buffer, sampleRate, windowS = 1, analyze = analyzeWindow, onResult = () => {}, onError = () => {}, timeoutMs = 6000 }) {
    Object.assign(this, { buffer, sampleRate, windowS, analyze, onResult, onError, timeoutMs });
    this.inflight = null;
    this.stopped = false;
    this.stats = { sent: 0, skipped: 0, failed: 0 };
  }

  /** One scheduling step: 'waiting' (buffer not full), 'skipped' (previous window still running) or 'sent'. */
  async tick() {
    if (this.stopped) return 'stopped';
    if (this.inflight) { this.stats.skipped++; return 'skipped'; }
    const win = this.buffer.latest(Math.round(this.windowS * this.sampleRate));
    if (!win) return 'waiting';
    const ctrl = new AbortController();
    this.inflight = ctrl;
    this.stats.sent++;
    const t0 = Date.now();
    try {
      const res = await this.analyze(win, this.sampleRate, { signal: ctrl.signal, timeoutMs: this.timeoutMs });
      if (!this.stopped) this.onResult(res, { roundTripMs: Date.now() - t0, at: new Date() });
    } catch (e) {
      if (this.stopped || e?.code === 'aborted') return 'sent';
      if (e?.code === 'busy') this.stats.skipped++;
      else { this.stats.failed++; this.onError(e); }
    } finally {
      if (this.inflight === ctrl) this.inflight = null;
    }
    return 'sent';
  }

  stop() {
    this.stopped = true;
    this.inflight?.abort();
    this.inflight = null;
  }
}
