import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { startServer, makeReviewCron } from '../src/server.js';
import { makeAuth } from '../src/auth.js';

const fakeCoach = {
  enabled: true,
  estimateFood: async (text) => ({ items: [{ name: text, kcal: 250, proteinG: 18 }], kcal: 250, proteinG: 18, note: '' }),
  weeklyReview: async (week) => ({ summary: `Reviewed ${week.sessions.length} sessions.`, wins: ['showed up'], flags: [], nextWeek: ['add 2.5 kg'], nutrition: 'fine',
    proposals: [
      { kind: 'targets', kcal: 2700, proteinG: null, reason: 'weight flat for two weeks' },
      { kind: 'set_weight', exerciseId: 'squat', weight: 55, reason: 'missed reps twice' },
      { kind: 'move_day', dayKey: 'ZZ', weekday: 2, reason: 'invalid, should be dropped' },
    ] }),
};
const fakeAnnouncer = { configured: true, calls: [], announce: async (t) => { fakeAnnouncer.calls.push(t); } };

let srv;
let base;
const staticDir = mkdtempSync(join(tmpdir(), 'trainer-static-'));
writeFileSync(join(staticDir, 'index.html'), '<title>Trainer</title>');

before(async () => {
  srv = await startServer({ dataDir: mkdtempSync(join(tmpdir(), 'trainer-data-')), staticDir, coach: fakeCoach, announcer: fakeAnnouncer, cron: false, log: { error() {}, info() {} } });
  base = `http://127.0.0.1:${srv.port}`;
});
after(async () => srv.close());

const api = async (method, path, body, headers = {}) => {
  const res = await fetch(base + path, { method, headers: { 'Content-Type': 'application/json', ...headers }, body: body ? JSON.stringify(body) : undefined });
  return { status: res.status, headers: res.headers, json: await res.json().catch(() => null) };
};

test('health and static shell', async () => {
  const h = await api('GET', '/api/health');
  assert.equal(h.status, 200);
  assert.equal(h.json.ok, true);
  const html = await fetch(base + '/');
  assert.equal(html.status, 200);
  assert.match(await html.text(), /Trainer/);
  assert.equal((await fetch(base + '/unknown-route')).status, 200);
  assert.equal((await fetch(base + '/missing.png')).status, 404);
});

test('today → start → log → finish → history', async () => {
  const today = await api('GET', '/api/today?date=2026-10-05');
  assert.equal(today.json.day.key, 'A');
  assert.equal(today.json.day.exercises[0].id, 'squat');
  assert.equal(today.json.openSession, null);

  const start = await api('POST', '/api/sessions', { date: '2026-10-05', dayKey: 'A' });
  assert.equal(start.status, 200);
  const id = start.json.id;
  const again = await api('POST', '/api/sessions', { date: '2026-10-05', dayKey: 'A' });
  assert.equal(again.json.id, id, 'starting twice returns the open session');

  for (let i = 0; i < 3; i++) {
    const r = await api('POST', `/api/sessions/${id}/sets`, { exerciseId: 'squat', setIndex: i, targetReps: 5, reps: 5, weight: 60 });
    assert.equal(r.status, 200, JSON.stringify(r.json));
    assert.equal(r.json.exerciseName, 'Back squat');
  }
  const bad = await api('POST', `/api/sessions/${id}/sets`, { exerciseId: 'squat', setIndex: 0, reps: 'x', weight: 60 });
  assert.equal(bad.status, 400);

  const mid = await api('GET', '/api/today?date=2026-10-05');
  assert.equal(mid.json.openSession.sets.length, 3);

  const fin = await api('POST', `/api/sessions/${id}/finish`, { feel: 4, notes: 'good' });
  assert.equal(fin.status, 200);
  assert.deepEqual(fin.json.changes.map((c) => [c.exerciseId, c.change, c.weight]), [['squat', 'adopt', 60]]);
  assert.equal((await api('POST', `/api/sessions/${id}/finish`, {})).status, 409);

  const hist = await api('GET', '/api/history');
  assert.equal(hist.json.sessions[0].id, id);
  assert.equal(hist.json.bests.squat.weight, 60);

  const next = await api('GET', '/api/today?date=2026-10-12');
  assert.equal(next.json.day.exercises[0].weight, 60);
  assert.equal(next.json.lastSession.date, '2026-10-05');
});

test('holiday setting swaps lifts for the travel day', async () => {
  const put = await api('PUT', '/api/settings', { holiday: { from: '2026-09-18', to: '2026-09-27' } });
  assert.equal(put.status, 200);
  const t = await api('GET', '/api/today?date=2026-09-21');
  assert.equal(t.json.day.key, 'T');
  assert.equal((await api('PUT', '/api/settings', { holiday: { from: 'x' } })).status, 400);
  assert.equal((await api('PUT', '/api/settings', { nope: 1 })).status, 400);
  await api('PUT', '/api/settings', { holiday: null });
});

test('runs log distance and duration', async () => {
  const s = await api('POST', '/api/sessions', { date: '2026-10-10', dayKey: 'R' });
  const fin = await api('POST', `/api/sessions/${s.json.id}/finish`, { feel: 3, distanceKm: 6.4, durationMin: 39 });
  assert.equal(fin.json.session.distanceKm, 6.4);
  assert.deepEqual(fin.json.changes, []);
});

test('checkins and food', async () => {
  assert.equal((await api('POST', '/api/checkins', { date: '2026-10-05', weightKg: 70.3 })).status, 200);
  assert.equal((await api('POST', '/api/checkins', { date: '2026-10-05', weightKg: 5 })).status, 400);
  assert.equal((await api('GET', '/api/checkins')).json.checkins[0].weightKg, 70.3);

  const est = await api('POST', '/api/food/estimate', { text: '2 eggs' });
  assert.equal(est.json.kcal, 250);
  const saved = await api('POST', '/api/food', { date: '2026-10-05', text: '2 eggs', kcal: est.json.kcal, proteinG: est.json.proteinG });
  assert.equal(saved.status, 200);
  const day = await api('GET', '/api/food?date=2026-10-05');
  assert.deepEqual(day.json.totals, { kcal: 250, proteinG: 18 });
  assert.equal(day.json.targets.kcal, 2600);
  assert.equal((await api('DELETE', `/api/food/${saved.json.id}`)).status, 200);
  assert.equal((await api('GET', '/api/food?date=2026-10-05')).json.entries.length, 0);
});

test('coach review, announce, program and export', async () => {
  const r = await api('POST', '/api/coach/review', { weekStart: '2026-10-07' });
  assert.equal(r.status, 200, JSON.stringify(r.json));
  assert.equal(r.json.weekStart, '2026-10-05');
  assert.match(r.json.text, /Reviewed 2 sessions/);
  assert.equal((await api('GET', '/api/coach')).json.notes[0].weekStart, '2026-10-05');

  assert.equal((await api('POST', '/api/ha/announce', { text: 'Rest over' })).status, 200);
  assert.deepEqual(fakeAnnouncer.calls, ['Rest over']);

  const p = await api('GET', '/api/program');
  const edited = { ...p.json, name: 'Edited' };
  assert.equal((await api('PUT', '/api/program', edited)).json.name, 'Edited');
  assert.equal((await api('GET', '/api/today?date=2026-10-05')).json.programName, 'Edited');

  const dump = await api('GET', '/api/export');
  assert.equal(dump.json.sessions.length, 2);
  assert.equal(dump.json.program.name, 'Edited');
});

test('password protects the api', async () => {
  const s2 = await startServer({ dataDir: mkdtempSync(join(tmpdir(), 'trainer-data-')), staticDir, cron: false, auth: makeAuth({ password: 'pw', secret: 's' }), log: { error() {} } });
  const b = `http://127.0.0.1:${s2.port}`;
  try {
    assert.equal((await fetch(b + '/api/today')).status, 401);
    assert.equal((await fetch(b + '/api/health')).status, 200);
    const bad = await fetch(b + '/api/login', { method: 'POST', body: JSON.stringify({ password: 'no' }) });
    assert.equal(bad.status, 401);
    const ok = await fetch(b + '/api/login', { method: 'POST', body: JSON.stringify({ password: 'pw' }) });
    assert.equal(ok.status, 200);
    const cookie = ok.headers.get('set-cookie').split(';')[0];
    assert.equal((await fetch(b + '/api/today', { headers: { cookie } })).status, 200);
  } finally {
    await s2.close();
  }
});

test('review cron only fires on Sunday evening once per week', async () => {
  const notes = new Set();
  const ctx = { coach: fakeCoach, repo: { coachNoteFor: (w) => (notes.has(w) ? { createdAt: '2026-10-11T16:31:00.000Z' } : null), weekData: () => ({ sessions: [], checkins: [], foodDays: [] }), coachNotes: () => [], allSettings: () => ({}), addCoachNote: ({ weekStart }) => { notes.add(weekStart); return {}; }, replaceProposals: () => {}, openProposals: () => [] }, program: () => ({ name: 'p', days: [] }) };
  const tick = makeReviewCron(ctx, { log: {} });
  assert.equal(await tick(new Date('2026-10-10T17:00:00Z')), false); // Saturday
  assert.equal(await tick(new Date('2026-10-11T10:00:00Z')), false); // Sunday morning
  assert.equal(await tick(new Date('2026-10-11T16:30:00Z')), true);  // Sunday 18:30 Amsterdam
  assert.equal(await tick(new Date('2026-10-11T17:30:00Z')), false); // already written
});

test('review cron re-runs when the week only has a note written before Sunday', async () => {
  let created = '2026-10-14T10:00:00.000Z'; // a manual review run on Wednesday
  let runs = 0;
  const ctx = { coach: fakeCoach, repo: { coachNoteFor: () => ({ createdAt: created }), weekData: () => ({ sessions: [], checkins: [], foodDays: [] }), coachNotes: () => [], allSettings: () => ({}), addCoachNote: () => { runs += 1; created = '2026-10-18T16:05:00.000Z'; return {}; }, replaceProposals: () => {}, openProposals: () => [] }, program: () => ({ name: 'p', days: [] }) };
  const tick = makeReviewCron(ctx, { log: {} });
  assert.equal(await tick(new Date('2026-10-18T16:05:00Z')), true); // Sunday 18:05 Amsterdam: note is stale, run again
  assert.equal(await tick(new Date('2026-10-18T16:06:00Z')), false); // now written on Sunday
  assert.equal(runs, 1);
});

test('today returns the open session day even when it is not the planned day', async () => {
  const s = await api('POST', '/api/sessions', { date: '2026-10-06', dayKey: 'B' }); // Tuesday = rest day
  const t = await api('GET', '/api/today?date=2026-10-06');
  assert.equal(t.json.day.key, 'B');
  assert.equal(t.json.openSession.id, s.json.id);
  assert.equal((await api('DELETE', `/api/sessions/${s.json.id}`)).status, 200);
  assert.equal((await api('GET', '/api/today?date=2026-10-06')).json.day, null);
});

test('workout import analyzes heart rate and shows up in history and export', async () => {
  const t0 = Date.parse('2026-10-10T07:05:00Z');
  const samples = Array.from({ length: 120 }, (_, i) => ({ t: t0 + i * 10_000, hr: i < 60 ? 125 : 150 }));
  const r = await api('POST', '/api/workouts', { workouts: [{ type: 'Running', start: '2026-10-10T07:05:00Z', end: '2026-10-10T07:25:00Z', distanceKm: 3.2, kcal: 210, samples }] });
  assert.equal(r.status, 200, JSON.stringify(r.json));
  const w = r.json.workouts[0];
  assert.equal(w.date, '2026-10-10');
  assert.equal(w.durationMin, 20);
  assert.equal(w.avgHr, 138);
  assert.equal(w.analysis.intensity, 'moderate');
  assert.equal(w.analysis.minutesPerZone[1], 10);
  const again = await api('POST', '/api/workouts', { type: 'Running', start: '2026-10-10T07:05:00Z', avgHr: 140 });
  assert.equal(again.json.workouts[0].id, w.id, 'same start + type updates instead of duplicating');
  assert.equal((await api('GET', '/api/history')).json.workouts.length, 1);
  assert.equal((await api('GET', '/api/export')).json.workouts.length, 1);
  assert.equal((await api('POST', '/api/workouts', { workouts: [{ type: 'x' }] })).status, 400);
  const hae = await api('POST', '/api/workouts', { data: { workouts: [{ name: 'Walking', start: '2026-10-11 09:00:00 +0200', end: '2026-10-11 09:30:00 +0200', avgHeartRate: { qty: 101, units: 'bpm' }, distance: { qty: 2.4, units: 'km' } }] } });
  assert.equal(hae.status, 200, JSON.stringify(hae.json));
  assert.equal(hae.json.workouts[0].analysis.intensity, 'easy');
  assert.equal(hae.json.workouts[0].durationMin, 30);
  assert.equal((await api('PUT', '/api/settings', { maxHr: 185 })).json.maxHr, 185);
});

test('sdk auth failures surface as 503 with a readable message', async () => {
  const s3 = await startServer({ dataDir: mkdtempSync(join(tmpdir(), 'trainer-data-')), staticDir, cron: false, log: { error() {} },
    coach: { enabled: true, backend: 'sdk', estimateFood: async () => { throw Object.assign(new Error('401 nope'), { status: 401 }); }, weeklyReview: async () => { throw new Error('boom'); } } });
  try {
    const b = `http://127.0.0.1:${s3.port}`;
    const r = await fetch(b + '/api/food/estimate', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ text: 'x' }) });
    assert.equal(r.status, 503);
    assert.match((await r.json()).error, /token on the server/);
    const r2 = await fetch(b + '/api/coach/review', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' });
    assert.equal(r2.status, 503);
    assert.match((await r2.json()).error, /Coach unavailable: boom/);
  } finally {
    await s3.close();
  }
});

test('favorites api and recent meals', async () => {
  const today = new Date().toISOString().slice(0, 10);
  await api('POST', '/api/food', { date: today, text: 'oats with milk', kcal: 350, proteinG: 15 });
  const fav = await api('POST', '/api/food/favorites', { name: 'Breakfast', text: 'oats with milk', kcal: 350, proteinG: 15 });
  assert.equal(fav.status, 200, JSON.stringify(fav.json));
  const list = await api('GET', '/api/food/favorites');
  assert.equal(list.json.favorites[0].name, 'Breakfast');
  assert.ok(list.json.recent.some((r) => r.text === 'oats with milk'));
  assert.equal((await api('POST', '/api/food/favorites', { text: 'x', kcal: 'no' })).status, 400);
  assert.equal((await api('DELETE', `/api/food/favorites/${fav.json.id}`)).status, 200);
  assert.equal((await api('GET', '/api/food/favorites')).json.favorites.length, 0);
});

test('review proposals are listed, applied and dismissed', async () => {
  const r = await api('POST', '/api/coach/review', { weekStart: '2026-11-02' });
  assert.equal(r.status, 200, JSON.stringify(r.json));
  assert.equal(r.json.proposals.length, 2, 'invalid proposal dropped');
  const open = (await api('GET', '/api/coach')).json.proposals.filter((p) => p.weekStart === '2026-11-02');
  assert.equal(open.length, 2);
  assert.match(open[0].text, /2700 kcal/);
  const applied = await api('POST', `/api/coach/proposals/${open[0].id}/apply`);
  assert.equal(applied.json.status, 'applied');
  assert.equal((await api('GET', '/api/settings')).json.targets.kcal, 2700);
  assert.equal((await api('POST', `/api/coach/proposals/${open[0].id}/apply`)).status, 409);
  const dismissed = await api('POST', `/api/coach/proposals/${open[1].id}/dismiss`);
  assert.equal(dismissed.json.status, 'dismissed');
  assert.equal((await api('GET', '/api/coach')).json.proposals.filter((p) => p.weekStart === '2026-11-02').length, 0);
  // re-running the review replaces open proposals instead of duplicating them
  await api('POST', '/api/coach/review', { weekStart: '2026-11-02' });
  assert.equal((await api('GET', '/api/coach')).json.proposals.filter((p) => p.weekStart === '2026-11-02').length, 2);
  await api('PUT', '/api/settings', { targets: { kcal: 2600, proteinG: 140 } });
});
