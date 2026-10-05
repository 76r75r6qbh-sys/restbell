import { test } from 'node:test';
import assert from 'node:assert/strict';
import { recoveryFor, recoveryText } from '../src/recovery.js';
import { addDays } from '../src/schedule.js';

const DAY = '2026-10-20';
// 28 days of steady baseline: HRV around 50, resting HR around 52.
function baseline(extra = {}) {
  const m = {};
  for (let i = 1; i <= 28; i++) m[addDays(DAY, -i)] = { hrv_ms: 50 + (i % 3) - 1, resting_hr: 52 + (i % 2), sleep_min: 450 };
  m[DAY] = extra;
  return m;
}

test('no data gives no level', () => {
  assert.deepEqual(recoveryFor({}, DAY), { level: null, score: null, reasons: [], signals: {} });
  assert.equal(recoveryText(recoveryFor({}, DAY)), null);
});

test('a normal day against the baseline is good', () => {
  const r = recoveryFor(baseline({ hrv_ms: 50, resting_hr: 52, sleep_min: 470 }), DAY);
  assert.equal(r.level, 'good');
  assert.ok(r.score >= 70);
});

test('low HRV, high resting HR and short sleep make a low day with reasons', () => {
  const r = recoveryFor(baseline({ hrv_ms: 36, resting_hr: 60, sleep_min: 330 }), DAY);
  assert.equal(r.level, 'low');
  assert.ok(r.reasons.some((x) => x.startsWith('HRV')));
  assert.ok(r.reasons.some((x) => x.startsWith('Resting HR')));
  assert.ok(r.reasons.some((x) => x.includes('sleep')));
  assert.match(recoveryText(r), /^Recovery today: low/);
});

test('a fever-like wrist temperature caps the level even when the rest looks fine', () => {
  const r = recoveryFor(baseline({ hrv_ms: 50, resting_hr: 52, sleep_min: 480, wrist_temp_delta: 0.9 }), DAY);
  assert.equal(r.level, 'low');
  assert.ok(r.reasons.some((x) => x.includes('wrist temperature')));
});

test('HRV is ignored until there are enough baseline days; sleep alone still counts', () => {
  const m = { [addDays(DAY, -1)]: { hrv_ms: 80 }, [DAY]: { hrv_ms: 20, sleep_min: 480 } };
  const r = recoveryFor(m, DAY);
  assert.equal(r.signals.hrv_ms, undefined);
  assert.equal(r.level, 'good');
});
