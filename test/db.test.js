import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openDb, makeRepo } from '../src/db.js';

function freshRepo() {
  const dir = mkdtempSync(join(tmpdir(), 'trainer-'));
  const path = join(dir, 'test.db');
  openDb(path).close();
  return makeRepo(openDb(path)); // opening twice must be fine
}

test('settings round-trip with fallback', () => {
  const repo = freshRepo();
  assert.deepEqual(repo.getSetting('targets', { kcal: 1 }), { kcal: 1 });
  repo.setSetting('targets', { kcal: 2600 });
  assert.deepEqual(repo.getSetting('targets', null), { kcal: 2600 });
});

test('program save and active lookup', () => {
  const repo = freshRepo();
  assert.equal(repo.activeProgram(), null);
  repo.saveProgram({ name: 'v1' });
  repo.saveProgram({ name: 'v2' });
  assert.equal(repo.activeProgram().name, 'v2');
});

test('session, sets and history round-trip', () => {
  const repo = freshRepo();
  const s = repo.startSession({ date: '2026-10-05', dayKey: 'A', type: 'lift' });
  assert.equal(repo.openSession('2026-10-05').id, s.id);
  repo.logSet(s.id, { exerciseId: 'squat', exerciseName: 'Back squat', setIndex: 0, targetReps: 5, reps: 5, weight: 60 });
  repo.logSet(s.id, { exerciseId: 'squat', exerciseName: 'Back squat', setIndex: 1, targetReps: 5, reps: 5, weight: 62.5 });
  repo.logSet(s.id, { exerciseId: 'squat', exerciseName: 'Back squat', setIndex: 1, targetReps: 5, reps: 4, weight: 62.5 }); // re-log replaces
  repo.finishSession(s.id, { feel: 4, notes: 'good' });
  assert.equal(repo.openSession('2026-10-05'), null);
  const [h] = repo.history(10);
  assert.equal(h.id, s.id);
  assert.equal(h.feel, 4);
  assert.equal(h.sets.length, 2);
  assert.equal(h.sets[1].reps, 4);
  assert.deepEqual(repo.bests().squat, { weight: 62.5, reps: 4, date: '2026-10-05' });
});

test('exercise state upsert', () => {
  const repo = freshRepo();
  assert.equal(repo.exerciseState('squat'), null);
  repo.setExerciseState('squat', 60, 0);
  repo.setExerciseState('squat', 62.5, 1);
  assert.deepEqual(repo.exerciseState('squat'), { exerciseId: 'squat', weight: 62.5, belowMinStreak: 1 });
});

test('checkins upsert by date and list newest first', () => {
  const repo = freshRepo();
  repo.addCheckin({ date: '2026-10-05', weightKg: 70 });
  repo.addCheckin({ date: '2026-10-05', weightKg: 70.4, notes: 'morning' });
  repo.addCheckin({ date: '2026-10-12', weightKg: 70.8 });
  const rows = repo.checkins(10);
  assert.equal(rows.length, 2);
  assert.equal(rows[0].date, '2026-10-12');
  assert.equal(rows[1].weightKg, 70.4);
});

test('food entries and totals per date', () => {
  const repo = freshRepo();
  repo.addFood({ date: '2026-10-05', text: 'eggs', kcal: 300, proteinG: 20 });
  repo.addFood({ date: '2026-10-05', text: 'rice', kcal: 400, proteinG: 8 });
  repo.addFood({ date: '2026-10-06', text: 'toast', kcal: 200, proteinG: 6 });
  const day = repo.foodForDate('2026-10-05');
  assert.equal(day.entries.length, 2);
  assert.deepEqual(day.totals, { kcal: 700, proteinG: 28 });
  repo.deleteFood(day.entries[0].id);
  assert.equal(repo.foodForDate('2026-10-05').entries.length, 1);
});

test('coach notes and export', () => {
  const repo = freshRepo();
  repo.addCoachNote({ weekStart: '2026-10-05', text: 'Nice week', json: { wins: ['x'] } });
  assert.equal(repo.coachNotes(5)[0].json.wins[0], 'x');
  assert.equal(repo.hasCoachNote('2026-10-05'), true);
  const dump = repo.exportAll();
  assert.ok(Array.isArray(dump.sessions));
  assert.ok(Array.isArray(dump.coachNotes));
});

test('weekData collects sessions, checkins and food in a range', () => {
  const repo = freshRepo();
  const s = repo.startSession({ date: '2026-10-06', dayKey: 'R', type: 'run' });
  repo.finishSession(s.id, { feel: 3, distanceKm: 6.2, durationMin: 38 });
  repo.addCheckin({ date: '2026-10-05', weightKg: 70 });
  repo.addFood({ date: '2026-10-07', text: 'x', kcal: 500, proteinG: 30 });
  repo.addFood({ date: '2026-10-20', text: 'out of range', kcal: 1, proteinG: 1 });
  const w = repo.weekData('2026-10-05', '2026-10-11');
  assert.equal(w.sessions.length, 1);
  assert.equal(w.sessions[0].distanceKm, 6.2);
  assert.equal(w.checkins.length, 1);
  assert.deepEqual(w.foodDays, [{ date: '2026-10-07', kcal: 500, proteinG: 30 }]);
});

test('favorites and recent meals', () => {
  const repo = freshRepo();
  repo.addFood({ date: '2026-10-05', text: 'eggs and toast', kcal: 300, proteinG: 20 });
  repo.addFood({ date: '2026-10-06', text: 'eggs and toast', kcal: 320, proteinG: 21 });
  repo.addFood({ date: '2026-10-06', text: 'kwark', kcal: 200, proteinG: 30 });
  repo.addFood({ date: '2026-08-01', text: 'old meal', kcal: 1, proteinG: 1 });
  const recent = repo.recentMeals('2026-09-06', 10);
  assert.deepEqual(recent.map((r) => [r.text, r.kcal]), [['kwark', 200], ['eggs and toast', 320]]);
  const f = repo.addFavorite({ name: 'Breakfast', text: 'eggs and toast', kcal: 320, proteinG: 21 });
  assert.equal(repo.favorites()[0].name, 'Breakfast');
  repo.deleteFavorite(f.id);
  assert.equal(repo.favorites().length, 0);
});
