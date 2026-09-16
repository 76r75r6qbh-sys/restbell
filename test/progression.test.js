import { test } from 'node:test';
import assert from 'node:assert/strict';
import { nextState, roundToIncrement } from '../src/progression.js';

const ex = { repMin: 6, repMax: 8, increment: 2.5 };

test('no sets holds the state', () => {
  const r = nextState(ex, { weight: 40, belowMinStreak: 0 }, []);
  assert.deepEqual(r, { weight: 40, belowMinStreak: 0, change: 'hold' });
});

test('null weight adopts the heaviest logged weight', () => {
  const r = nextState(ex, { weight: null, belowMinStreak: 0 }, [{ reps: 8, weight: 40 }, { reps: 8, weight: 42.5 }]);
  assert.deepEqual(r, { weight: 42.5, belowMinStreak: 0, change: 'adopt' });
});

test('all sets at the top of the range increases the weight', () => {
  const r = nextState(ex, { weight: 40, belowMinStreak: 1 }, [{ reps: 8, weight: 40 }, { reps: 9, weight: 40 }, { reps: 8, weight: 40 }]);
  assert.deepEqual(r, { weight: 42.5, belowMinStreak: 0, change: 'up' });
});

test('sets inside the range hold and reset the streak', () => {
  const r = nextState(ex, { weight: 40, belowMinStreak: 1 }, [{ reps: 8, weight: 40 }, { reps: 7, weight: 40 }]);
  assert.deepEqual(r, { weight: 40, belowMinStreak: 0, change: 'hold' });
});

test('a set below the minimum increments the streak', () => {
  const r = nextState(ex, { weight: 40, belowMinStreak: 0 }, [{ reps: 5, weight: 40 }, { reps: 8, weight: 40 }]);
  assert.deepEqual(r, { weight: 40, belowMinStreak: 1, change: 'hold' });
});

test('two consecutive misses back the weight off by 10 percent', () => {
  const r = nextState(ex, { weight: 60, belowMinStreak: 1 }, [{ reps: 4, weight: 60 }]);
  assert.deepEqual(r, { weight: 55, belowMinStreak: 0, change: 'down' });
});

test('roundToIncrement rounds to the nearest step', () => {
  assert.equal(roundToIncrement(54, 2.5), 55);
  assert.equal(roundToIncrement(53.6, 2.5), 52.5);
  assert.equal(roundToIncrement(9.3, 1), 9);
});
