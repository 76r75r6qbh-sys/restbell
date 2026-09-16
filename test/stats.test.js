import { test } from 'node:test';
import assert from 'node:assert/strict';
import { computeStats } from '../src/stats.js';

const program = { days: [{ key: 'A', type: 'lift' }, { key: 'B', type: 'lift' }, { key: 'R', type: 'run' }, { key: 'H', type: 'home' }] };
const lift = (date, dayKey, sets) => ({ date, dayKey, type: 'lift', finishedAt: 'x', sets });
const run = (date, km) => ({ date, dayKey: 'R', type: 'run', finishedAt: 'x', distanceKm: km, sets: [] });
const squat = (reps, weight, i = 0) => ({ exerciseId: 'squat', exerciseName: 'Back squat', setIndex: i, reps, weight });

test('week progress, volume and change vs last week', () => {
  const sessions = [
    lift('2026-10-05', 'A', [squat(5, 60), squat(5, 60)]),      // this week (Mon)
    lift('2026-09-28', 'A', [squat(5, 50)]), lift('2026-10-01', 'B', [squat(5, 50)]), run('2026-10-03', 6), // last week complete
  ];
  const s = computeStats({ today: '2026-10-06', program, settings: {}, sessions, checkins: [] });
  assert.deepEqual(s.week, { start: '2026-10-05', done: 1, planned: 3, remaining: 2, holiday: false });
  assert.equal(s.volume.kg, 600);
  assert.equal(s.volume.lastWeekKg, 500);
  assert.equal(s.volume.changePct, 20);
  assert.deepEqual(s.runs, { km: 6, count: 1, avgKm: 6 }, 'runs count the calendar month');
  assert.equal(s.programWeek, 2);
});

test('streak counts complete weeks, skips holiday weeks, breaks on a missed week', () => {
  const full = (mon) => [lift(mon, 'A', []), lift(mon, 'B', []), run(mon, 5)];
  const sessions = [...full('2026-08-31'), ...full('2026-09-07'), ...full('2026-09-28'), lift('2026-10-05', 'A', [])];
  const settings = { holiday: { from: '2026-09-14', to: '2026-09-27' } };
  const s = computeStats({ today: '2026-10-06', program, settings, sessions, checkins: [] });
  assert.equal(s.streak, 3, 'current week incomplete is neutral; two holiday weeks skipped');
  const broken = computeStats({ today: '2026-10-06', program, settings: {}, sessions, checkins: [] });
  assert.equal(broken.streak, 1, 'without holiday the empty weeks break the streak');
  assert.equal(s.weeks.length, 8);
  assert.equal(s.weeks[7].weekStart, '2026-10-05');
  assert.equal(s.weeks.filter((w) => w.holiday).length, 2);
});

test('bodyweight delta and bests fallback', () => {
  const checkins = [{ date: '2026-10-05', weightKg: 70.8 }, { date: '2026-09-28', weightKg: 70.5 }, { date: '2026-09-21', weightKg: 70.4 }, { date: '2026-09-14', weightKg: 70.2 }, { date: '2026-09-07', weightKg: 69 }];
  const sessions = [lift('2026-09-07', 'A', [squat(5, 60), { exerciseId: 'bench', exerciseName: 'Bench', setIndex: 0, reps: 8, weight: 40 }]), lift('2026-09-14', 'A', [squat(5, 60), squat(6, 60, 1)])];
  const s = computeStats({ today: '2026-10-06', program, settings: {}, sessions, checkins });
  assert.deepEqual(s.bodyweight, { kg: 70.8, date: '2026-10-05', delta: 0.6, over: 4 });
  assert.equal(s.bests.fresh, false);
  assert.deepEqual(s.bests.items.map((b) => [b.exerciseId, b.weight, b.reps, b.date]), [['squat', 60, 6, '2026-09-14'], ['bench', 40, 8, '2026-09-07']]);
  const fresh = computeStats({ today: '2026-09-16', program, settings: {}, sessions, checkins });
  assert.equal(fresh.bests.fresh, true);
  assert.equal(fresh.bests.items.length, 1);
});

test('empty data gives zeros, not crashes', () => {
  const s = computeStats({ today: '2026-10-06', program, settings: {}, sessions: [], checkins: [] });
  assert.equal(s.streak, 0);
  assert.equal(s.bodyweight, null);
  assert.equal(s.programWeek, null);
  assert.equal(s.volume.changePct, null);
});
