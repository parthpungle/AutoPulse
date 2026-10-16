// The vibration WebSocket lifecycle (src/vibSocket.js) against a fake socket and a manual clock.
import test from 'node:test';
import assert from 'node:assert/strict';
import { connectVibration, vibrationUrl } from '../src/vibSocket.js';

function harness() {
  const sockets = [];
  class FakeWS {
    constructor(url) { this.url = url; this.readyState = 0; this.sent = []; this.closed = false; sockets.push(this); }
    send(d) { this.sent.push(JSON.parse(d)); }
    close() { if (this.closed) return; this.closed = true; this.readyState = 3; this.onclose?.(); }
    // test helpers
    open() { this.readyState = 1; this.onopen?.(); }
    drop() { this.close(); }
    emit(data) { this.onmessage?.({ data }); }
  }
  const timers = new Map();
  let next = 1;
  const clock = {
    setTimer: (fn) => { const id = next++; timers.set(id, fn); return id; },
    clearTimer: (id) => timers.delete(id),
    runAll: () => { const fns = [...timers.values()]; timers.clear(); fns.forEach((f) => f()); },
    pending: () => timers.size,
  };
  const live = () => sockets.filter((s) => !s.closed);
  return { FakeWS, sockets, live, clock };
}

const connect = (h, extra = {}) => {
  const messages = [], status = [];
  const c = connectVibration({ url: 'ws://x/api/vibration/live', WS: h.FakeWS, onMessage: (m) => messages.push(m),
    onStatus: (v) => status.push(v), setTimer: h.clock.setTimer, clearTimer: h.clock.clearTimer, ...extra });
  return { c, messages, status };
};

test('opens exactly one socket and only sends once it is open', () => {
  const h = harness();
  const { c, status } = connect(h);
  assert.equal(h.sockets.length, 1);
  assert.equal(c.send({ cmd: 'start' }), false, 'not sent while connecting');
  h.sockets[0].open();
  assert.deepEqual(status, [true]);
  assert.equal(c.send({ cmd: 'start', source: 'simulator' }), true);
  assert.deepEqual(h.sockets[0].sent, [{ cmd: 'start', source: 'simulator' }]);
});

test('reconnects after a drop, never with two sockets alive', () => {
  const h = harness();
  const { status } = connect(h);
  h.sockets[0].open();
  h.sockets[0].drop();
  assert.deepEqual(status, [true, false]);
  assert.equal(h.live().length, 0);
  assert.equal(h.clock.pending(), 1, 'one reconnect scheduled');
  h.clock.runAll();
  assert.equal(h.sockets.length, 2);
  assert.equal(h.live().length, 1);
});

test('close() cancels the socket and a pending reconnect: switching modes leaves nothing running', () => {
  const h = harness();
  const a = connect(h);                      // e.g. the Paired vehicle view
  h.sockets[0].open();
  h.sockets[0].drop();                       // a reconnect is pending ...
  a.c.close();                               // ... when the user switches tab (view unmounts)
  assert.equal(h.clock.pending(), 0);
  h.clock.runAll();
  assert.equal(h.sockets.length, 1, 'no reconnect after close');

  const b = connect(h);                      // the Live simulation view mounts
  h.sockets[1].open();
  assert.equal(h.live().length, 1);
  b.c.close();
  assert.equal(h.live().length, 0);
  assert.equal(h.clock.pending(), 0);
});

test('ignores events from a closed socket and messages that are not JSON', () => {
  const h = harness();
  const { c, messages, status } = connect(h);
  const s = h.sockets[0];
  s.open();
  s.emit('{"type":"state","state":"idle"}');
  s.emit('not json');
  c.close();
  s.emit('{"type":"batch"}');                // late message after close
  s.onclose?.();                             // late close event
  assert.deepEqual(messages, [{ type: 'state', state: 'idle' }]);
  assert.deepEqual(status, [true]);
  assert.equal(c.send({ cmd: 'stop' }), false);
});

test('builds the endpoint URL from the page location', () => {
  assert.equal(vibrationUrl({ protocol: 'http:', host: 'localhost:5173' }), 'ws://localhost:5173/api/vibration/live');
  assert.equal(vibrationUrl({ protocol: 'https:', host: 'a.b' }), 'wss://a.b/api/vibration/live');
});
