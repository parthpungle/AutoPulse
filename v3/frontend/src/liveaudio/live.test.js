// node --test src/liveaudio/   (no browser needed: the browser APIs are faked)
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { RingBuffer, level, pushBounded } from './buffer.js';
import { MicCapture, classify } from './mic.js';
import { ApiError, LiveAnalyzer, analyzeWindow } from './analyzer.js';

// ------------------------------------------------------------------ fakes
function fakeBrowser({ gum } = {}) {
  const log = { tracksStopped: 0, closed: 0, disconnected: 0, contexts: 0, gumCalls: 0, revoked: 0 };
  const listeners = {};
  const track = {
    label: 'Fake mic', stop: () => { log.tracksStopped++; },
    addEventListener: (ev, fn) => { listeners[ev] = fn; },
  };
  const stream = { getTracks: () => [track], getAudioTracks: () => [track] };
  const node = () => ({ connect() {}, disconnect() { log.disconnected++; } });
  class Ctx {
    constructor() { log.contexts++; this.sampleRate = 48000; this.state = 'running'; this.destination = {}; }
    get audioWorklet() { return { addModule: async () => {} }; }
    createMediaStreamSource() { return node(); }
    createGain() { return { ...node(), gain: { value: 1 } }; }
    async close() { this.state = 'closed'; log.closed++; }
  }
  class Worklet { constructor() { this.port = { onmessage: null }; Object.assign(this, node()); Worklet.last = this; } }
  const mediaDevices = {
    getUserMedia: async () => { log.gumCalls++; if (gum) return gum(); return stream; },
  };
  const opts = { mediaDevices, AudioContextCtor: Ctx, WorkletNodeCtor: Worklet, secure: true,
    makeModuleUrl: () => 'blob:x', revokeModuleUrl: () => { log.revoked++; } };
  return { opts, log, listeners, Worklet };
}

const named = (name) => Object.assign(new Error(name), { name });

// ------------------------------------------------------------------ buffer
test('ring buffer keeps the newest samples and stays bounded', () => {
  const b = new RingBuffer(5);
  assert.equal(b.latest(1), null);
  b.push(Float32Array.from([1, 2, 3]));
  b.push(Float32Array.from([4, 5, 6, 7]));
  assert.deepEqual([...b.latest(5)], [3, 4, 5, 6, 7]);
  assert.deepEqual([...b.latest(2)], [6, 7]);
  assert.equal(b.latest(6), null);
  b.push(Float32Array.from([10, 11, 12, 13, 14, 15, 16]));
  assert.deepEqual([...b.latest(5)], [12, 13, 14, 15, 16]);
  assert.equal(b.data.length, 5);
});

test('history is bounded, newest first', () => {
  let h = [];
  for (let i = 0; i < 50; i++) h = pushBounded(h, i, 20);
  assert.equal(h.length, 20);
  assert.equal(h[0], 49);
  assert.equal(h[19], 30);
});

test('level of a chunk', () => {
  const l = level(Float32Array.from([0.5, -0.5, 0.5, -0.5]));
  assert.equal(l.peak, 0.5);
  assert.ok(Math.abs(l.dbfs - 20 * Math.log10(0.5)) < 1e-6);
  assert.ok(level(new Float32Array(4)).dbfs < -200);
});

// ------------------------------------------------------------------ microphone lifecycle
test('start delivers chunks, stop releases tracks and the audio context', async () => {
  const { opts, log, Worklet } = fakeBrowser();
  const got = [];
  const mic = new MicCapture({ ...opts, onChunk: (c) => got.push(c) });
  assert.equal(await mic.start(), true);
  assert.equal(mic.state, 'active');
  assert.equal(mic.sampleRate, 48000);
  assert.equal(mic.device, 'Fake mic');
  Worklet.last.port.onmessage({ data: new Float32Array(4) });
  assert.equal(got.length, 1);
  const port = Worklet.last.port;
  await mic.stop();
  assert.equal(mic.state, 'idle');
  assert.equal(log.tracksStopped, 1);
  assert.equal(log.closed, 1);
  assert.equal(log.disconnected, 3);
  assert.equal(log.revoked, 1);
  assert.equal(port.onmessage, null);
});

test('permission denied is reported and nothing stays open', async () => {
  const { opts, log } = fakeBrowser({ gum: () => { throw named('NotAllowedError'); } });
  const states = [];
  const mic = new MicCapture({ ...opts, onState: (s) => states.push(s.state) });
  assert.equal(await mic.start(), false);
  assert.equal(mic.state, 'error');
  assert.equal(mic.error.code, 'denied');
  assert.match(mic.error.message, /denied/);
  assert.deepEqual(states, ['requesting', 'error']);
  assert.equal(log.contexts, 0);
});

test('no device / device busy / insecure page / unsupported browser', async () => {
  for (const [err, code] of [['NotFoundError', 'no_device'], ['NotReadableError', 'busy'], ['TypeError', 'failed']]) {
    const { opts } = fakeBrowser({ gum: () => { throw named(err); } });
    const mic = new MicCapture(opts);
    await mic.start();
    assert.equal(mic.error.code, code);
  }
  const { opts } = fakeBrowser();
  const insecure = new MicCapture({ ...opts, secure: false });
  await insecure.start();
  assert.equal(insecure.error.code, 'insecure');
  const old = new MicCapture({ ...opts, WorkletNodeCtor: undefined });
  await old.start();
  assert.equal(old.error.code, 'unsupported');
  assert.equal(classify(named('SecurityError')), 'denied');
});

test('device disconnect while running stops capture with an error', async () => {
  const { opts, log, listeners } = fakeBrowser();
  const mic = new MicCapture(opts);
  await mic.start();
  await listeners.ended();
  assert.equal(mic.state, 'error');
  assert.equal(mic.error.code, 'disconnected');
  assert.equal(log.closed, 1);
  assert.equal(log.tracksStopped, 1);
});

test('repeated start does not open a second session; start/stop cycles release everything', async () => {
  const { opts, log } = fakeBrowser();
  const mic = new MicCapture(opts);
  const [a, b] = await Promise.all([mic.start(), mic.start()]);
  assert.deepEqual([a, b], [true, false]);
  assert.equal(log.gumCalls, 1);
  assert.equal(await mic.start(), false);
  for (let i = 0; i < 3; i++) { await mic.stop(); await mic.start(); }
  await mic.stop();
  assert.equal(log.gumCalls, 4);
  assert.equal(log.contexts, 4);
  assert.equal(log.closed, 4);
  assert.equal(log.tracksStopped, 4);
});

test('stop while the permission prompt is open releases the stream when it arrives', async () => {
  let grant;
  const { opts, log } = fakeBrowser();
  const stream = await opts.mediaDevices.getUserMedia();
  log.gumCalls = 0;
  const mic = new MicCapture({ ...opts, mediaDevices: { getUserMedia: () => new Promise((r) => { grant = () => r(stream); }) } });
  const started = mic.start();
  await mic.stop();
  grant();
  assert.equal(await started, false);
  assert.equal(mic.state, 'idle');
  assert.equal(log.tracksStopped, 1);
  assert.equal(log.contexts, 0);
});

// ------------------------------------------------------------------ backend client

test('analyzeWindow posts octet-stream with the sample rate', async () => {
  let seen;
  const res = await analyzeWindow(new Float32Array(4), 48000.4, {
    fetchImpl: async (url, init) => { seen = { url, init }; return { ok: true, json: async () => ({ ok: 1 }) }; } });
  assert.deepEqual(res, { ok: 1 });
  assert.equal(seen.url, '/api/live-audio/analyze?sample_rate=48000');
  assert.equal(seen.init.headers['Content-Type'], 'application/octet-stream');
});

test('analyzeWindow maps timeout, network and HTTP errors', async () => {
  const hang = (url, { signal }) => new Promise((_, rej) => signal.addEventListener('abort', () => rej(named('AbortError'))));
  await assert.rejects(analyzeWindow(new Float32Array(1), 48000, { fetchImpl: hang, timeoutMs: 20 }), (e) => e.code === 'timeout');
  await assert.rejects(analyzeWindow(new Float32Array(1), 48000, { fetchImpl: async () => { throw new TypeError('x'); } }),
    (e) => e.code === 'network');
  for (const [status, code] of [[422, 'invalid_audio'], [429, 'busy'], [504, 'timeout'], [500, 'server']]) {
    await assert.rejects(analyzeWindow(new Float32Array(1), 48000, {
      fetchImpl: async () => ({ ok: false, status, json: async () => ({ detail: 'why' }) }) }),
    (e) => e.code === code && e.message === 'why');
  }
});

// ------------------------------------------------------------------ scheduler
function filledBuffer(n = 48000) {
  const b = new RingBuffer(n * 2);
  b.push(new Float32Array(n));
  return b;
}

test('analyzer waits for a full window, then never overlaps requests', async () => {
  let release;
  const calls = [];
  const a = new LiveAnalyzer({ buffer: new RingBuffer(96000), sampleRate: 48000,
    analyze: (w) => { calls.push(w.length); return new Promise((r) => { release = () => r({ ok: 1 }); }); } });
  assert.equal(await a.tick(), 'waiting');
  a.buffer.push(new Float32Array(48000));
  const first = a.tick();
  assert.equal(await a.tick(), 'skipped');
  assert.equal(await a.tick(), 'skipped');
  release();
  assert.equal(await first, 'sent');
  assert.deepEqual(calls, [48000]);
  assert.deepEqual(a.stats, { sent: 1, skipped: 2, failed: 0 });
});

test('analyzer reports backend failures and drops results after stop', async () => {
  const errors = [];
  const results = [];
  const failing = new LiveAnalyzer({ buffer: filledBuffer(), sampleRate: 48000, onError: (e) => errors.push(e.code),
    analyze: async () => { throw new ApiError('server', 'boom', 500); } });
  await failing.tick();
  assert.deepEqual(errors, ['server']);
  assert.equal(failing.stats.failed, 1);

  let release;
  const late = new LiveAnalyzer({ buffer: filledBuffer(), sampleRate: 48000, onResult: (r) => results.push(r),
    analyze: (w, sr, { signal }) => new Promise((r, rej) => {
      release = () => r({ ok: 1 });
      signal.addEventListener('abort', () => rej(new ApiError('aborted', 'x')));
    }) });
  const p = late.tick();
  late.stop();
  release();
  await p;
  assert.deepEqual(results, []);
  assert.equal(await late.tick(), 'stopped');
  assert.equal(late.inflight, null);
});

test('busy (429) counts as skipped, not as an error', async () => {
  const errors = [];
  const a = new LiveAnalyzer({ buffer: filledBuffer(), sampleRate: 48000, onError: (e) => errors.push(e),
    analyze: async () => { throw new ApiError('busy', 'busy', 429); } });
  await a.tick();
  assert.equal(errors.length, 0);
  assert.equal(a.stats.skipped, 1);
});
