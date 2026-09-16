import { test } from 'node:test';
import assert from 'node:assert/strict';

// public/guide.js is a classic browser script; importing it registers globalThis.RestbellGuide.
await import('../public/guide.js');
const { loggedCount, isDone, nextOpenSet, firstOpen, nextExercise } = globalThis.RestbellGuide;

const exercises = [
  { id: 'squat', sets: 3 },
  { id: 'bench', sets: 3 },
  { id: 'row', sets: 2 },
];
const set = (exerciseId, setIndex) => ({ exerciseId, setIndex, reps: 5, weight: 40 });

test('counts logged sets per exercise, ignoring duplicates and out-of-range indexes', () => {
  const sets = [set('squat', 0), set('squat', 0), set('squat', 2), set('squat', 5), set('bench', 1)];
  assert.equal(loggedCount(exercises[0], sets), 2);
  assert.equal(loggedCount(exercises[1], sets), 1);
  assert.equal(isDone(exercises[0], sets), false);
  assert.equal(isDone(exercises[2], [set('row', 0), set('row', 1)]), true);
});

test('next open set is the first unlogged index, null when done', () => {
  assert.equal(nextOpenSet(exercises[0], []), 0);
  assert.equal(nextOpenSet(exercises[0], [set('squat', 0), set('squat', 2)]), 1);
  assert.equal(nextOpenSet(exercises[2], [set('row', 0), set('row', 1)]), null);
});

test('first open exercise follows program order', () => {
  assert.equal(firstOpen(exercises, []), 0);
  const squatDone = [set('squat', 0), set('squat', 1), set('squat', 2)];
  assert.equal(firstOpen(exercises, squatDone), 1);
});

test('first open exercise is -1 when everything is logged', () => {
  const all = exercises.flatMap((e) => Array.from({ length: e.sets }, (_, i) => set(e.id, i)));
  assert.equal(firstOpen(exercises, all), -1);
});

test('next exercise skips finished ones and never returns the current one', () => {
  const benchDone = [set('bench', 0), set('bench', 1), set('bench', 2)];
  assert.equal(nextExercise(exercises, benchDone, 0), 2);
  assert.equal(nextExercise(exercises, [], 2), 0, 'wraps around to a skipped exercise');
  const onlySquatOpen = [...benchDone, set('row', 0), set('row', 1)];
  assert.equal(nextExercise(exercises, onlySquatOpen, 0), -1);
});
