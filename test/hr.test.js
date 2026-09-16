import { test } from 'node:test';
import assert from 'node:assert/strict';
import { zoneOf, analyzeSamples, intensityFrom, intensityFromAvg, defaultMaxHr } from '../src/hr.js';

test('zoneOf maps percentages of max HR to zones', () => {
  assert.equal(zoneOf(90, 191), 0);
  assert.equal(zoneOf(120, 191), 1);  // 63 %
  assert.equal(zoneOf(140, 191), 2);  // 73 %
  assert.equal(zoneOf(160, 191), 3);  // 84 %
  assert.equal(zoneOf(180, 191), 4);  // 94 %
  assert.equal(defaultMaxHr(29), 191);
});

test('analyzeSamples credits time per zone with capped gaps', () => {
  const t0 = Date.parse('2026-10-10T08:00:00Z');
  const samples = [
    { t: t0, hr: 120 },              // Z1, 60 s to next
    { t: t0 + 60_000, hr: 140 },     // Z2, 10 min gap → capped to 30 s
    { t: t0 + 660_000, hr: 165 },    // Z3, last → 5 s
  ];
  const r = analyzeSamples(samples, 191);
  assert.deepEqual(r.minutesPerZone, [0, 0.5, 0.5, 0.1, 0]);
  assert.equal(r.avgHr, 142);
  assert.equal(r.maxHr, 165);
  assert.equal(r.samples, 3);
});

test('analyzeSamples handles ISO strings and empty input', () => {
  const r = analyzeSamples([{ t: '2026-10-10T08:00:00Z', hr: 150 }, { t: '2026-10-10T08:00:30Z', hr: 150 }], 191);
  assert.equal(r.minutesPerZone[2], 0.6); // 30 s + 5 s tail
  assert.equal(analyzeSamples([], 191).intensity, 'unknown');
});

test('intensity labels', () => {
  assert.equal(intensityFrom([10, 20, 5, 0, 0]), 'easy');
  assert.equal(intensityFrom([0, 10, 15, 5, 0]), 'moderate');
  assert.equal(intensityFrom([0, 5, 5, 10, 5]), 'hard');
  assert.equal(intensityFromAvg(130, 191), 'easy');
  assert.equal(intensityFromAvg(140, 191), 'moderate');
  assert.equal(intensityFromAvg(160, 191), 'hard');
});
