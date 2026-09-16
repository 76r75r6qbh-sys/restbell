import { test } from 'node:test';
import assert from 'node:assert/strict';

// public/guide.js is a classic browser script; importing it registers globalThis.RestbellGuide.
await import('../public/guide.js');
const { loggedCount, openSteps, rounds } = globalThis.RestbellGuide;

const exercises = [
  { id: 'squat', sets: 3 },
  { id: 'bench', sets: 3 },
  { id: 'crunch', sets: 2 },
];
const set = (exerciseId, setIndex) => ({ exerciseId, setIndex, reps: 5, weight: 40 });
const ids = (steps) => steps.map((s) => `${exercises[s.index].id}${s.setIndex + 1}`);

test('counts logged sets per exercise, ignoring duplicates and out-of-range indexes', () => {
  const sets = [set('squat', 0), set('squat', 0), set('squat', 2), set('squat', 5), set('bench', 1)];
  assert.equal(loggedCount(exercises[0], sets), 2);
  assert.equal(loggedCount(exercises[1], sets), 1);
});

test('steps run in rounds: set 1 of every exercise, then set 2, and so on', () => {
  assert.deepEqual(ids(openSteps(exercises, [])), ['squat1', 'bench1', 'crunch1', 'squat2', 'bench2', 'crunch2', 'squat3', 'bench3']);
});

test('an exercise with fewer sets drops out of later rounds', () => {
  assert.equal(rounds(exercises), 3);
  assert.deepEqual(ids(openSteps(exercises, [])).slice(-2), ['squat3', 'bench3']);
});

test('logged sets are skipped, so the first open step is where to resume', () => {
  const sets = [set('squat', 0), set('bench', 0), set('crunch', 0), set('bench', 1)];
  assert.deepEqual(ids(openSteps(exercises, sets)), ['squat2', 'crunch2', 'squat3', 'bench3']);
});

test('no open steps when every set is logged', () => {
  const all = exercises.flatMap((e) => Array.from({ length: e.sets }, (_, i) => set(e.id, i)));
  assert.deepEqual(openSteps(exercises, all), []);
});
