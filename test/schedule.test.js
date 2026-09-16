import { test } from 'node:test';
import assert from 'node:assert/strict';
import { plannedDay, weekdayOf, todayStr } from '../src/schedule.js';

const program = {
  days: [
    { key: 'A', weekday: 1, type: 'lift', title: 'Lift A', exercises: [{ id: 'squat' }] },
    { key: 'H', weekday: 3, type: 'home', title: 'Home', exercises: [{ id: 'goblet' }] },
    { key: 'B', weekday: 4, type: 'lift', title: 'Lift B', exercises: [{ id: 'deadlift' }] },
    { key: 'R', weekday: 6, type: 'run', title: 'Run', exercises: [] },
  ],
  travel: { key: 'T', type: 'travel', title: 'Travel', exercises: [{ id: 'pushup' }] },
};

test('weekdayOf maps Monday to 1 and Sunday to 7', () => {
  assert.equal(weekdayOf('2026-10-05'), 1); // Monday
  assert.equal(weekdayOf('2026-10-11'), 7); // Sunday
});

test('plannedDay returns the program day for the weekday', () => {
  assert.equal(plannedDay(program, '2026-10-05', {}).key, 'A');
  assert.equal(plannedDay(program, '2026-10-08', {}).key, 'B');
  assert.equal(plannedDay(program, '2026-10-10', {}).key, 'R');
  assert.equal(plannedDay(program, '2026-10-07', {}).key, 'H');
});

test('plannedDay returns null on rest days', () => {
  assert.equal(plannedDay(program, '2026-10-06', {}), null);
});

test('plannedDay substitutes travel day for lifts during a holiday', () => {
  const settings = { holiday: { from: '2026-09-18', to: '2026-09-28' } };
  const day = plannedDay(program, '2026-09-21', settings); // Monday
  assert.equal(day.key, 'T');
  assert.equal(day.type, 'travel');
  assert.equal(plannedDay(program, '2026-09-26', settings).key, 'R'); // runs stay
  assert.equal(plannedDay(program, '2026-10-05', settings).key, 'A'); // after holiday
});

test('todayStr formats the Amsterdam date', () => {
  // 2026-06-30T23:30Z is already 2026-07-01 01:30 in Amsterdam (CEST)
  assert.equal(todayStr(new Date('2026-06-30T23:30:00Z')), '2026-07-01');
  assert.match(todayStr(), /^\d{4}-\d{2}-\d{2}$/);
});
