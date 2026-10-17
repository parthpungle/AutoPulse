// Split dashboard: the Vibration analysis tab's sources (src/vibModes.js, rendered by pages/VibrationTab.jsx).
import test from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULT_MODE, VIBRATION_MODES, modeById } from '../src/vibModes.js';

test('offers Paired vehicle, Recorded CSV and Live simulation, in that order', () => {
  assert.deepEqual(VIBRATION_MODES.map((m) => m.label), ['Paired vehicle', 'Recorded CSV', 'Live simulation']);
  assert.equal(new Set(VIBRATION_MODES.map((m) => m.id)).size, 3, 'ids are unique (they key the live view)');
});

test('Live simulation renders the live view on the simulator source', () => {
  const m = modeById('sim');
  assert.equal(m.view, 'live');
  assert.equal(m.source, 'simulator');
});

test('existing modes keep their behaviour and the default', () => {
  assert.equal(DEFAULT_MODE, 'vehicle');
  assert.deepEqual([modeById('vehicle').view, modeById('vehicle').source], ['live', 'vehicle']);
  assert.equal(modeById('csv').view, 'csv');
  assert.equal(modeById('nope').id, 'vehicle', 'unknown ids fall back to the default');
});
