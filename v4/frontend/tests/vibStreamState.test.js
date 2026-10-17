import test from 'node:test';
import assert from 'node:assert/strict';
import { applyBatch, initialStream, reduceStream } from '../src/vibStreamState.js';

const batch = (t0, t1, n = 10) => ({
  type: 'batch', t0, t1,
  channels: { accel_x: { t: Array.from({ length: n }, (_, i) => t0 + ((t1 - t0) * i) / n), y: Array(n).fill(1) } },
});

test('display buffer stays bounded to the rolling window', () => {
  let wave = {};
  for (let i = 0; i < 200; i++) wave = applyBatch(wave, batch(i, i + 1), 4);
  const { t, y } = wave.accel_x;
  assert.equal(t.length, y.length);
  assert.ok(t.length <= 4 * 10 + 10, `kept ${t.length} points`);
  assert.ok(t[0] >= 200 - 4 && t.at(-1) < 200);
});

test('state transitions: new run clears old data, errors do not', () => {
  let s = reduceStream(initialStream, { type: 'state', state: 'running', samples: 0, settings: { window_s: 3 } });
  s = reduceStream(s, batch(0, 1));
  s = reduceStream(s, { type: 'analysis', features: {} });
  assert.ok(s.wave.accel_x && s.ana);
  s = reduceStream(s, { type: 'error', message: 'boom' });
  assert.equal(s.error, 'boom');
  assert.ok(s.wave.accel_x, 'an error must not wipe the chart');
  s = reduceStream(s, { type: 'state', state: 'idle', samples: 0, settings: { window_s: 3 } });
  assert.deepEqual(s.wave, {});
  assert.equal(s.ana, null);
  assert.equal(s.error, null);
});

test('paused state keeps the picture', () => {
  let s = reduceStream(initialStream, { type: 'state', state: 'running', samples: 0, settings: { window_s: 3 } });
  s = reduceStream(s, batch(0, 1));
  s = reduceStream(s, { type: 'state', state: 'paused', samples: 2000, settings: { window_s: 3 } });
  assert.ok(s.wave.accel_x.t.length > 0);
});

test('unknown messages are ignored', () => {
  assert.equal(reduceStream(initialStream, { type: 'mystery' }), initialStream);
});
