// The endpoints the iOS companion app uses: bearer auth, summary, chat, metrics, Health import and reminders.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { startServer, makeReminderCron } from '../src/server.js';
import { makeAuth } from '../src/auth.js';
import { openDb, makeRepo } from '../src/db.js';
import { addDays } from '../src/schedule.js';

const sent = [];
const notifier = { configured: true, channels: ['test'], send: async (n) => { sent.push(n); return true; } };
let replyText = 'Good question.';
const fakeCoach = {
  enabled: true,
  estimateFood: async () => ({ items: [], kcal: 1, proteinG: 1, note: '' }),
  weeklyReview: async () => ({ summary: 'Solid week.', wins: [], flags: [], nextWeek: [], nutrition: '', proposals: [{ kind: 'targets', kcal: 2700, proteinG: null, reason: 'flat weight' }] }),
  chat: async (history, context) => {
    if (replyText === 'FAIL') throw new Error('boom');
    return { text: `${replyText} (${history.length} msgs, ctx ${context.includes('Today is') ? 'yes' : 'no'})` };
  },
};

let srv;
let base;
let token;
const staticDir = mkdtempSync(join(tmpdir(), 'trainer-static-'));
writeFileSync(join(staticDir, 'index.html'), '<title>Restbell</title>');

before(async () => {
  srv = await startServer({
    dataDir: mkdtempSync(join(tmpdir(), 'trainer-data-')), staticDir, coach: fakeCoach, notifier, cron: false,
    auth: makeAuth({ password: 'pw' }), log: { error() {}, info() {} },
  });
  base = `http://127.0.0.1:${srv.port}`;
  const login = await fetch(`${base}/api/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ password: 'pw' }) });
  token = (await login.json()).token;
});
after(async () => srv.close());

const api = async (method, path, body, { auth = true } = {}) => {
  const headers = { 'Content-Type': 'application/json' };
  if (auth) headers.Authorization = `Bearer ${token}`;
  const res = await fetch(base + path, { method, headers, body: body ? JSON.stringify(body) : undefined });
  return { status: res.status, json: await res.json().catch(() => null) };
};

test('login returns a token that works as a bearer header', async () => {
  assert.match(token, /^[a-f0-9]{64}$/);
  assert.equal((await api('GET', '/api/summary', null, { auth: false })).status, 401);
  assert.equal((await fetch(`${base}/api/summary`, { headers: { Authorization: 'Bearer abc' } })).status, 401);
  assert.equal((await api('GET', '/api/summary')).status, 200);
  assert.equal((await api('GET', '/api/auth')).json.ok, true);
});

test('summary for a planned lift day with food logged', async () => {
  await api('POST', '/api/food', { date: '2026-10-05', text: 'oats', kcal: 450, proteinG: 20 });
  await api('POST', '/api/food/favorites', { name: 'Shake', text: 'protein shake', kcal: 200, proteinG: 40 });
  const s = (await api('GET', '/api/summary?date=2026-10-05')).json;
  assert.equal(s.food.kcal, 450);
  assert.equal(s.food.targets.kcal, 2600);
  assert.equal(s.session.status, 'planned');
  assert.equal(s.session.dayKey, 'A');
  assert.ok(s.session.setsTotal > 0);
  assert.equal(s.favorites[0].name, 'Shake');
  assert.equal(s.recovery, null);
  assert.deepEqual(s.health, { lastSync: null, stale: false });
  assert.equal((await api('GET', '/api/summary?date=2026-10-06')).json.session.status, 'rest');
});

test('chat: message is stored, the coach replies in the background and it notifies', async () => {
  sent.length = 0;
  const r = await api('POST', '/api/chat', { text: 'Can I swap Thursday?' });
  assert.equal(r.status, 200);
  assert.equal(r.json.pending, true);
  assert.equal(r.json.message.role, 'user');
  await srv.ctx.settle();
  const list = (await api('GET', `/api/chat?after=${r.json.message.id}`)).json;
  assert.equal(list.pending, false);
  assert.equal(list.messages.length, 1);
  assert.match(list.messages[0].text, /^Good question\. \(1 msgs, ctx yes\)/);
  assert.equal(list.unread, 1);
  assert.equal(sent.length, 1);
  assert.equal(sent[0].url, 'restbell://chat');
  assert.equal((await api('GET', '/api/summary?date=2026-10-05')).json.unreadChat, 1);
  assert.equal((await api('POST', '/api/chat/read', {})).json.unread, 0);
  assert.equal((await api('POST', '/api/chat', { text: '  ' })).status, 400);
});

test('chat: a coach failure becomes a visible error message, not a push', async () => {
  sent.length = 0;
  replyText = 'FAIL';
  try {
    const r = await api('POST', '/api/chat', { text: 'hello?' });
    await srv.ctx.settle();
    const [m] = (await api('GET', `/api/chat?after=${r.json.message.id}`)).json.messages;
    assert.equal(m.kind, 'error');
    assert.match(m.text, /couldn't answer/);
    assert.equal(sent.length, 0);
  } finally {
    replyText = 'Good question.';
  }
});

test('weekly review posts into the chat and notifies', async () => {
  sent.length = 0;
  const r = await api('POST', '/api/coach/review', { date: '2026-10-05' });
  assert.equal(r.status, 200);
  const tail = (await api('GET', '/api/chat?limit=1')).json.messages;
  assert.equal(tail[0].kind, 'review');
  assert.match(tail[0].text, /^Solid week\.\n\nI proposed 1 change/);
  assert.equal(sent[0].title, 'Your weekly review is in');
});

test('finishing a session links the Watch workout and posts a debrief', async () => {
  sent.length = 0;
  const s = (await api('POST', '/api/sessions', { date: '2026-10-07', dayKey: 'A' })).json;
  await api('POST', `/api/sessions/${s.id}/sets`, { exerciseId: 'squat', setIndex: 0, reps: 5, weight: 60 });
  // The Watch workout started at the same time as the session.
  const w = (await api('POST', '/api/workouts', { workouts: [{ type: 'Traditional Strength Training', start: s.startedAt, end: new Date(Date.parse(s.startedAt) + 3600_000).toISOString(), kcal: 320, avgHr: 118, externalId: 'HK-1', effort: 7 }] })).json.workouts[0];
  const fin = (await api('POST', `/api/sessions/${s.id}/finish`, { feel: 4 })).json;
  assert.equal(fin.session.workoutId, w.id);
  await srv.ctx.settle();
  const tail = (await api('GET', '/api/chat?limit=1')).json.messages;
  assert.equal(tail[0].kind, 'debrief');
  assert.equal(sent[0].title, 'Session debrief');
  assert.equal((await api('PUT', '/api/settings', { debrief: false })).json.debrief, false);
});

test('Health workouts: enrichment fields, idempotent re-import, delete by external id', async () => {
  const workout = {
    type: 'Running', start: '2026-10-08T06:00:00Z', end: '2026-10-08T06:30:00Z', distanceKm: 6, kcal: 400, source: 'healthkit',
    externalId: 'HK-RUN-1', elevationM: 42, effort: 6, hrRecovery: 31,
    details: { cadenceSpm: 170, powerW: 240, bogus: 'x', splits: [{ km: 1, sec: 300 }, { sec: 'nope' }] },
  };
  const a = (await api('POST', '/api/workouts', workout)).json.workouts[0];
  const b = (await api('POST', '/api/workouts', { ...workout, kcal: 410 })).json.workouts[0];
  assert.equal(a.id, b.id);
  assert.equal(b.kcal, 410);
  assert.equal(b.source, 'healthkit');
  assert.equal(b.hrRecovery, 31);
  assert.deepEqual(b.details, { cadenceSpm: 170, powerW: 240, splits: [{ km: 1, sec: 300 }] });
  assert.equal((await api('GET', `/api/workouts/${a.id}`)).json.elevationM, 42);
  assert.equal((await api('DELETE', '/api/workouts/external/HK-RUN-1')).json.deleted, true);
  assert.equal((await api('DELETE', '/api/workouts/external/HK-RUN-1')).json.deleted, false);
  assert.equal((await api('GET', `/api/workouts/${a.id}`)).status, 404);
});

test('metrics: batch upsert, validation, recovery and sync status', async () => {
  const days = [];
  for (let i = 28; i >= 1; i--) days.push({ date: addDays('2026-10-09', -i), metrics: { hrv_ms: 50, resting_hr: 52, sleep_min: 460 } });
  days.push({ date: '2026-10-09', metrics: { hrv_ms: 30, resting_hr: 61, sleep_min: 320, steps: 4000, active_kcal: 500, basal_kcal: 1800 } });
  const r = await api('PUT', '/api/metrics', { days });
  assert.equal(r.status, 200, JSON.stringify(r.json));
  assert.equal(r.json.days, 29);
  assert.ok(r.json.health.lastSync);
  // Re-sending a day replaces values, no duplicates.
  await api('PUT', '/api/metrics', { date: '2026-10-09', metrics: { steps: 4200 } });
  const got = (await api('GET', '/api/metrics?from=2026-10-09&to=2026-10-09')).json;
  assert.equal(got.days['2026-10-09'].steps, 4200);
  assert.equal(got.days['2026-10-09'].hrv_ms, 30);
  assert.deepEqual(got.food, []);
  assert.equal((await api('PUT', '/api/metrics', { date: '2026-10-09', metrics: { mood: 1 } })).status, 400);
  assert.equal((await api('PUT', '/api/metrics', { date: 'bad', metrics: {} })).status, 400);
  const rec = (await api('GET', '/api/recovery?date=2026-10-09')).json;
  assert.equal(rec.level, 'low');
  const sum = (await api('GET', '/api/summary?date=2026-10-09')).json;
  assert.equal(sum.recovery.level, 'low');
  assert.equal(sum.activity.steps, 4200);
  assert.deepEqual(sum.energy, { date: '2026-10-09', outKcal: 2300, inKcal: 0, balance: -2300 }); // nothing eaten yet
});

test('Health weigh-ins never overwrite a manual one', async () => {
  await api('POST', '/api/checkins', { date: '2026-10-09', weightKg: 75.5 });
  const skipped = (await api('POST', '/api/checkins', { date: '2026-10-09', weightKg: 74.9, source: 'healthkit', bodyFatPct: 15 })).json;
  assert.equal(skipped.skipped, true);
  assert.equal(skipped.weightKg, 75.5);
  const fromScale = (await api('POST', '/api/checkins', { date: '2026-10-10', weightKg: 75.1, bodyFatPct: 14.8, source: 'healthkit' })).json;
  assert.equal(fromScale.source, 'healthkit');
  assert.equal(fromScale.bodyFatPct, 14.8);
});

test('reminder settings are validated', async () => {
  assert.equal((await api('PUT', '/api/settings', { reminders: { enabled: true, time: '25:00' } })).status, 400);
  assert.deepEqual((await api('PUT', '/api/settings', { reminders: { enabled: true, time: '21:15' } })).json.reminders, { enabled: true, time: '21:15' });
});

test('reminder cron fires once, after the time, only when nothing was logged', async () => {
  const repo = makeRepo(openDb(':memory:'));
  const pushes = [];
  const ctx = { repo, linkBase: 'restbell://', notifier: { configured: true, send: async (n) => { pushes.push(n); return true; } } };
  const tick = makeReminderCron(ctx, { log: {} });
  // 2026-10-12 is a Monday; Amsterdam is UTC+2 in October.
  assert.equal(await tick(new Date('2026-10-12T18:00:00Z')), false); // 20:00, before 20:30
  assert.equal(await tick(new Date('2026-10-12T18:31:00Z')), true);
  assert.equal(await tick(new Date('2026-10-12T19:00:00Z')), false); // already sent today
  assert.equal(pushes.length, 1);
  assert.equal(pushes[0].url, 'restbell://food');
  repo.addFood({ date: '2026-10-13', text: 'eggs', kcal: 150, proteinG: 12 });
  assert.equal(await tick(new Date('2026-10-13T18:31:00Z')), false); // something logged
  repo.setSetting('reminders', { enabled: false, time: '20:30' });
  assert.equal(await tick(new Date('2026-10-14T18:31:00Z')), false);
});

test('an old database gets the new columns', () => {
  const dir = mkdtempSync(join(tmpdir(), 'trainer-old-'));
  const path = join(dir, 'old.db');
  const old = new DatabaseSync(path);
  old.exec(`CREATE TABLE workouts (id INTEGER PRIMARY KEY AUTOINCREMENT, source TEXT NOT NULL DEFAULT 'apple', date TEXT NOT NULL,
    start TEXT NOT NULL, end TEXT, type TEXT NOT NULL, duration_min REAL, distance_km REAL, avg_hr INTEGER, max_hr INTEGER, kcal REAL,
    analysis TEXT, samples INTEGER NOT NULL DEFAULT 0, created_at TEXT NOT NULL DEFAULT 'x', UNIQUE(start, type));
    CREATE TABLE checkins (id INTEGER PRIMARY KEY AUTOINCREMENT, date TEXT NOT NULL UNIQUE, weight_kg REAL NOT NULL, notes TEXT);
    INSERT INTO checkins(date, weight_kg) VALUES ('2026-01-01', 70);`);
  old.close();
  const repo = makeRepo(openDb(path));
  assert.equal(repo.checkins(1)[0].source, 'manual');
  const w = repo.addWorkout({ date: '2026-01-02', start: '2026-01-02T08:00:00Z', type: 'Running', externalId: 'X', details: { a: 1 } });
  assert.equal(w.externalId, 'X');
  repo.close();
});
