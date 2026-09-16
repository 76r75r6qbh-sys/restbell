import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { openDb, makeRepo } from '../src/db.js';
import { ensureProgram, targetsFor, applyProgression, dayByKey } from '../src/program.js';

const seedPath = join(dirname(fileURLToPath(import.meta.url)), '..', 'seed', 'program.json');

test('ensureProgram seeds once', () => {
  const repo = makeRepo(openDb(':memory:'));
  const p1 = ensureProgram(repo, seedPath);
  const p2 = ensureProgram(repo, seedPath);
  assert.equal(p1.name, p2.name);
  assert.equal(repo.db.prepare('SELECT COUNT(*) AS n FROM program').get().n, 1);
  assert.equal(dayByKey(p1, 'T').type, 'travel');
  assert.equal(dayByKey(p1, 'B').weekday, 4);
});

test('targetsFor merges exercise state', () => {
  const repo = makeRepo(openDb(':memory:'));
  const program = ensureProgram(repo, seedPath);
  repo.setExerciseState('squat', 60, 0);
  const targets = targetsFor(repo, dayByKey(program, 'A'));
  assert.equal(targets.find((t) => t.id === 'squat').weight, 60);
  assert.equal(targets.find((t) => t.id === 'bench').weight, null);
});

test('applyProgression adopts, then bumps, and skips bodyweight work', () => {
  const repo = makeRepo(openDb(':memory:'));
  const program = ensureProgram(repo, seedPath);
  const s1 = repo.startSession({ date: '2026-10-05', dayKey: 'A', type: 'lift' });
  for (let i = 0; i < 3; i++) repo.logSet(s1.id, { exerciseId: 'squat', exerciseName: 'Back squat', setIndex: i, targetReps: 5, reps: 5, weight: 60 });
  repo.logSet(s1.id, { exerciseId: 'knee_raise', exerciseName: 'Hanging knee raise', setIndex: 0, targetReps: 15, reps: 15, weight: 0 });
  repo.finishSession(s1.id, { feel: 4 });
  const c1 = applyProgression(repo, program, s1.id);
  assert.deepEqual(c1.map((c) => [c.exerciseId, c.change, c.weight]), [['squat', 'adopt', 60]]);

  const s2 = repo.startSession({ date: '2026-10-12', dayKey: 'A', type: 'lift' });
  for (let i = 0; i < 3; i++) repo.logSet(s2.id, { exerciseId: 'squat', exerciseName: 'Back squat', setIndex: i, targetReps: 5, reps: 5, weight: 60 });
  repo.finishSession(s2.id, { feel: 4 });
  const c2 = applyProgression(repo, program, s2.id);
  assert.deepEqual(c2.map((c) => [c.exerciseId, c.change, c.weight]), [['squat', 'up', 62.5]]);
  assert.equal(repo.exerciseState('squat').weight, 62.5);
});
