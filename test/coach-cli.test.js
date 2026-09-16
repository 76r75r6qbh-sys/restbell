import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { makeCliCoach, cliSchema } from '../src/coach-cli.js';
import { FoodEstimate } from '../src/coach.js';

const fake = join(dirname(fileURLToPath(import.meta.url)), '..', 'fixtures', 'fake-claude.js');
const coach = makeCliCoach({ bin: process.execPath, prefixArgs: [fake], models: { food: 'sonnet', review: 'opus' } });

test('cli coach estimates food through claude -p with a json schema', async () => {
  const r = await coach.estimateFood('2 eggs');
  assert.equal(r.kcal, 140);
  assert.equal(r.note, 'model=sonnet');
});

test('cli coach runs the weekly review with the review model', async () => {
  const week = { fromDate: '2026-10-05', toDate: '2026-10-11', sessions: [], checkins: [], foodDays: [], workouts: [] };
  const r = await coach.weeklyReview(week, { name: 'p', days: [] }, {});
  assert.equal(r.summary, 'ok for opus');
});

test('cli coach surfaces cli errors', async () => {
  await assert.rejects(coach.estimateFood('FAIL please'), (e) => e.code === 'cli' && /Not logged in/.test(e.message));
});

test('missing binary is a coach error', async () => {
  const broken = makeCliCoach({ bin: '/nonexistent/claude' });
  await assert.rejects(broken.estimateFood('x'), (e) => e.code === 'cli');
});

test('cli schema has no draft reference and keeps the properties', () => {
  const schema = cliSchema(FoodEstimate);
  assert.equal('$schema' in schema, false);
  assert.deepEqual(Object.keys(schema.properties), ['items', 'kcal', 'proteinG', 'note']);
});
