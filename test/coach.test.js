import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildReviewPrompt, buildFoodPrompt, makeCoach, reviewToText, toChatTurns, buildChatContext } from '../src/coach.js';

const week = {
  fromDate: '2026-10-05', toDate: '2026-10-11',
  sessions: [
    { date: '2026-10-05', dayKey: 'A', type: 'lift', feel: 4, notes: 'solid', sets: [{ exerciseName: 'Back squat', reps: 5, weight: 60 }, { exerciseName: 'Back squat', reps: 5, weight: 60 }] },
    { date: '2026-10-10', dayKey: 'R', type: 'run', feel: 3, distanceKm: 6.1, durationMin: 37, sets: [] },
  ],
  checkins: [{ date: '2026-10-05', weightKg: 70.2 }],
  foodDays: [{ date: '2026-10-06', kcal: 2480, proteinG: 138 }],
};
const program = { name: 'Test', days: [{ key: 'A', title: 'Lift A' }, { key: 'R', title: 'Run' }] };
const settings = { targets: { kcal: 2600, proteinG: 140 }, athlete: '30 y, 180 cm, 75 kg, intermediate lifter' };

test('review prompt includes sessions, sets, weigh-ins, food and targets', () => {
  const p = buildReviewPrompt(week, program, settings);
  assert.match(p, /Back squat: 5×60, 5×60/);
  assert.match(p, /6\.1 km in 37 min/);
  assert.match(p, /70\.2 kg/);
  assert.match(p, /2480 kcal \/ 138 g/);
  assert.match(p, /2600 kcal, 140 g protein/);
  assert.match(p, /^Athlete: 30 y, 180 cm/);
});

test('food prompt carries the athlete context when given', () => {
  assert.equal(buildFoodPrompt('rice', 'lives in Portugal'), 'Athlete: lives in Portugal\nMeal: rice');
});

test('review prompt tells the model which planned days are still ahead', () => {
  assert.match(buildReviewPrompt(week, program, settings, null, '2026-10-07'), /Today is 2026-10-07\. The week is not over/);
  assert.doesNotMatch(buildReviewPrompt(week, program, settings, null, '2026-10-11'), /not over/);
});

test('food prompt wraps the text', () => {
  assert.equal(buildFoodPrompt('  2 eggs '), 'Meal: 2 eggs');
});

test('coach without a client rejects with unavailable', async () => {
  const coach = makeCoach({ client: null });
  assert.equal(coach.enabled, false);
  await assert.rejects(coach.estimateFood('x'), (e) => e.code === 'unavailable');
});

test('coach with a fake client returns parsed output', async () => {
  const calls = [];
  const client = { messages: { parse: async (params) => { calls.push(params); return { stop_reason: 'end_turn', parsed_output: { items: [], kcal: 300, proteinG: 20, note: '' } }; } } };
  const coach = makeCoach({ client });
  const r = await coach.estimateFood('2 eggs');
  assert.equal(r.kcal, 300);
  assert.equal(calls[0].model, 'claude-opus-5');
  assert.ok(calls[0].output_config.format);
});

test('coach surfaces refusals as an error', async () => {
  const client = { messages: { parse: async () => ({ stop_reason: 'refusal', parsed_output: null }) } };
  await assert.rejects(makeCoach({ client }).weeklyReview(week, program, settings), (e) => e.code === 'refused');
});

test('reviewToText renders sections', () => {
  const t = reviewToText({ summary: 'Good week.', wins: ['a'], flags: [], nextWeek: ['b'], nutrition: 'More protein.' });
  assert.equal(t, 'Good week.\n\nWins\n- a\n\nNext week\n- b\n\nNutrition\nMore protein.');
});

test('chat turns start with the user; earlier coach messages move to the context', () => {
  const { turns, lead } = toChatTurns([{ role: 'coach', text: 'review' }, { role: 'user', text: 'hi' }, { role: 'coach', text: 'hey' }, { role: 'user', text: 'q' }]);
  assert.deepEqual(lead, ['review']);
  assert.deepEqual(turns.map((t) => t.role), ['user', 'assistant', 'user']);
});

test('sdk chat sends history and context, returns the text', async () => {
  const calls = [];
  const client = { messages: { create: async (params) => { calls.push(params); return { stop_reason: 'end_turn', content: [{ type: 'thinking', thinking: '' }, { type: 'text', text: 'Rest tomorrow.' }] }; } } };
  const r = await makeCoach({ client }).chat([{ role: 'coach', text: 'Weekly note' }, { role: 'user', text: 'Should I run?' }], 'Today is 2026-10-05.');
  assert.equal(r.text, 'Rest tomorrow.');
  assert.equal(calls[0].messages.length, 1);
  assert.match(calls[0].system, /Current data:\nToday is 2026-10-05/);
  assert.match(calls[0].system, /Your earlier messages:\nWeekly note/);
  assert.equal(calls[0].output_config.effort, 'low');
});

test('sdk chat surfaces refusals', async () => {
  const client = { messages: { create: async () => ({ stop_reason: 'refusal', content: [] }) } };
  await assert.rejects(makeCoach({ client }).chat([{ role: 'user', text: 'x' }]), (e) => e.code === 'refused');
});

test('chat context summarizes today, the week and open proposals', () => {
  const c = buildChatContext({
    settings, program, today: '2026-10-05',
    day: { title: 'Lift A', exercises: [{ name: 'Back squat', sets: 3, repMin: 5, repMax: 5, weight: 60 }] },
    week: { ...week, workouts: [] }, proposals: [{ text: 'Raise calories to 2700' }], recovery: 'Recovery today: ok (60/100)',
  });
  assert.match(c, /Planned today: Lift A — Back squat 3×5 @ 60 kg/);
  assert.match(c, /This week \(2026-10-05 to 2026-10-11\)/);
  assert.match(c, /Open proposals: Raise calories to 2700/);
  assert.match(c, /Recovery today: ok/);
});
