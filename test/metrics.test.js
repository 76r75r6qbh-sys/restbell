import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cleanMetrics, metricsBlock, energyBalance, closedRingDays } from '../src/metrics.js';
import { buildReviewPrompt, fmtWorkout } from '../src/coach.js';

test('cleanMetrics accepts known metrics, drops nulls and rejects the rest', () => {
  assert.deepEqual(cleanMetrics({ steps: '9120', hrv_ms: 48.456, vo2max: null }), { steps: 9120, hrv_ms: 48.46 });
  assert.throws(() => cleanMetrics({ mood: 3 }), /unknown metric mood/);
  assert.throws(() => cleanMetrics({ resting_hr: 400 }), /out of range/);
  assert.throws(() => cleanMetrics([]), /object/);
});

test('closed rings need all three goals met', () => {
  const days = {
    a: { active_kcal: 600, move_goal_kcal: 500, exercise_min: 40, exercise_goal_min: 30, stand_hours: 12, stand_goal_hours: 12 },
    b: { active_kcal: 600, move_goal_kcal: 500, exercise_min: 10, exercise_goal_min: 30, stand_hours: 12, stand_goal_hours: 12 },
  };
  assert.equal(closedRingDays(days), 1);
});

test('metrics block compares with last week', () => {
  const block = metricsBlock({ d1: { sleep_min: 420, hrv_ms: 40 }, d2: { sleep_min: 400, hrv_ms: 44 } }, { p1: { hrv_ms: 50 } });
  assert.match(block, /Sleep: 6h50/);
  assert.match(block, /HRV: 42 ms \(last week 50 ms\)/);
  assert.equal(metricsBlock({}), null);
});

test('energy balance uses days with both food and energy', () => {
  const r = energyBalance({ '2026-10-05': { active_kcal: 600, basal_kcal: 1800 }, '2026-10-06': { active_kcal: 500 } }, [{ date: '2026-10-05', kcal: 2600 }, { date: '2026-10-06', kcal: 2000 }]);
  assert.deepEqual(r.days, [{ date: '2026-10-05', outKcal: 2400, inKcal: 2600, balance: 200 }]);
  assert.equal(r.avgBalance, 200);
});

test('workout line carries pace, running dynamics and splits', () => {
  const line = fmtWorkout({ date: '2026-10-05', type: 'Running', durationMin: 30, distanceKm: 6, avgHr: 150, maxHr: 170, analysis: { intensity: 'moderate' }, effort: 6, hrRecovery: 28, details: { cadenceSpm: 172, powerW: 250, splits: [{ km: 1, sec: 300 }, { km: 1, sec: 290 }] } });
  assert.match(line, /6 km, 5:00\/km/);
  assert.match(line, /effort 6\/10/);
  assert.match(line, /HR recovery 28/);
  assert.match(line, /cadence 172 spm/);
  assert.match(line, /splits: 5:00\/km 4:50\/km/);
});

test('review prompt includes the Watch metrics, recovery and a stale-sync note', () => {
  const week = {
    fromDate: '2026-10-05', toDate: '2026-10-11', sessions: [], checkins: [], foodDays: [{ date: '2026-10-05', kcal: 2600, proteinG: 120 }], workouts: [],
    metrics: { '2026-10-05': { sleep_min: 400, active_kcal: 700, basal_kcal: 1800 } }, previousMetrics: {},
    recovery: 'Recovery today: low (40/100)', healthSyncStale: 'Note: Apple Health has not synced',
  };
  const p = buildReviewPrompt(week, { name: 'p', days: [] }, {});
  assert.match(p, /Apple Watch daily averages/);
  assert.match(p, /Energy balance .* \+100 kcal\/day/);
  assert.match(p, /Recovery today: low/);
  assert.match(p, /has not synced/);
});
