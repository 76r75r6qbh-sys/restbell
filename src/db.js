import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';

const SCHEMA = `
CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS program (
  id INTEGER PRIMARY KEY AUTOINCREMENT, json TEXT NOT NULL, active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')));
CREATE TABLE IF NOT EXISTS exercise_state (
  exercise_id TEXT PRIMARY KEY, weight REAL, below_min_streak INTEGER NOT NULL DEFAULT 0,
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')));
CREATE TABLE IF NOT EXISTS sessions (
  id INTEGER PRIMARY KEY AUTOINCREMENT, date TEXT NOT NULL, day_key TEXT NOT NULL, type TEXT NOT NULL,
  started_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')), finished_at TEXT,
  feel INTEGER, notes TEXT, distance_km REAL, duration_min REAL);
CREATE INDEX IF NOT EXISTS sessions_date ON sessions(date);
CREATE TABLE IF NOT EXISTS sets (
  id INTEGER PRIMARY KEY AUTOINCREMENT, session_id INTEGER NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
  exercise_id TEXT NOT NULL, exercise_name TEXT NOT NULL, set_index INTEGER NOT NULL,
  target_reps INTEGER, reps INTEGER NOT NULL, weight REAL NOT NULL,
  done_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  UNIQUE(session_id, exercise_id, set_index));
CREATE TABLE IF NOT EXISTS checkins (
  id INTEGER PRIMARY KEY AUTOINCREMENT, date TEXT NOT NULL UNIQUE, weight_kg REAL NOT NULL, notes TEXT);
CREATE TABLE IF NOT EXISTS food (
  id INTEGER PRIMARY KEY AUTOINCREMENT, date TEXT NOT NULL, text TEXT NOT NULL,
  kcal REAL NOT NULL, protein_g REAL NOT NULL,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')));
CREATE INDEX IF NOT EXISTS food_date ON food(date);
CREATE TABLE IF NOT EXISTS favorites (
  id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL, text TEXT NOT NULL,
  kcal REAL NOT NULL, protein_g REAL NOT NULL,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')));
CREATE TABLE IF NOT EXISTS workouts (
  id INTEGER PRIMARY KEY AUTOINCREMENT, source TEXT NOT NULL DEFAULT 'apple', date TEXT NOT NULL,
  start TEXT NOT NULL, end TEXT, type TEXT NOT NULL, duration_min REAL, distance_km REAL,
  avg_hr INTEGER, max_hr INTEGER, kcal REAL, analysis TEXT, samples INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  UNIQUE(start, type));
CREATE INDEX IF NOT EXISTS workouts_date ON workouts(date);
CREATE TABLE IF NOT EXISTS proposals (
  id INTEGER PRIMARY KEY AUTOINCREMENT, week_start TEXT NOT NULL, json TEXT NOT NULL, text TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'open', created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')), resolved_at TEXT);
CREATE TABLE IF NOT EXISTS coach_notes (
  id INTEGER PRIMARY KEY AUTOINCREMENT, week_start TEXT NOT NULL UNIQUE, text TEXT NOT NULL, json TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')));
CREATE TABLE IF NOT EXISTS chat_messages (
  id INTEGER PRIMARY KEY AUTOINCREMENT, role TEXT NOT NULL, kind TEXT NOT NULL DEFAULT 'chat', text TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')), read_at TEXT);
CREATE TABLE IF NOT EXISTS state (key TEXT PRIMARY KEY, value TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS sent_notifications (key TEXT PRIMARY KEY, sent_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')));
CREATE TABLE IF NOT EXISTS daily_metrics (
  date TEXT NOT NULL, metric TEXT NOT NULL, value REAL NOT NULL,
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  PRIMARY KEY (date, metric));
`;

// Columns added after the first release. CREATE TABLE IF NOT EXISTS leaves old databases alone, so add them here.
const COLUMNS = {
  workouts: { external_id: 'TEXT', elevation_m: 'REAL', effort: 'REAL', hr_recovery: 'INTEGER', details: 'TEXT' },
  sessions: { workout_id: 'INTEGER' },
  checkins: { body_fat_pct: 'REAL', source: "TEXT NOT NULL DEFAULT 'manual'" },
};

function migrate(db) {
  for (const [table, cols] of Object.entries(COLUMNS)) {
    const have = new Set(db.prepare(`PRAGMA table_info(${table})`).all().map((c) => c.name));
    for (const [name, type] of Object.entries(cols)) if (!have.has(name)) db.exec(`ALTER TABLE ${table} ADD COLUMN ${name} ${type}`);
  }
  db.exec('CREATE UNIQUE INDEX IF NOT EXISTS workouts_external ON workouts(external_id) WHERE external_id IS NOT NULL');
}

/** Open (and migrate) the SQLite database at path. ':memory:' is allowed. */
export function openDb(path) {
  if (path !== ':memory:') mkdirSync(dirname(path), { recursive: true });
  const db = new DatabaseSync(path);
  db.exec('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000;');
  db.exec(SCHEMA);
  migrate(db);
  return db;
}

const sessionRow = (r) => ({
  id: r.id,
  date: r.date,
  dayKey: r.day_key,
  type: r.type,
  startedAt: r.started_at,
  finishedAt: r.finished_at,
  feel: r.feel,
  notes: r.notes,
  distanceKm: r.distance_km,
  durationMin: r.duration_min,
  workoutId: r.workout_id ?? null,
});

const setRow = (r) => ({
  id: r.id,
  sessionId: r.session_id,
  exerciseId: r.exercise_id,
  exerciseName: r.exercise_name,
  setIndex: r.set_index,
  targetReps: r.target_reps,
  reps: r.reps,
  weight: r.weight,
  doneAt: r.done_at,
});

const checkinRow = (r) => ({ id: r.id, date: r.date, weightKg: r.weight_kg, notes: r.notes, bodyFatPct: r.body_fat_pct ?? null, source: r.source ?? 'manual' });
const foodRow = (r) => ({ id: r.id, date: r.date, text: r.text, kcal: r.kcal, proteinG: r.protein_g, createdAt: r.created_at });
const workoutRow = (r) => ({
  id: r.id, source: r.source, date: r.date, start: r.start, end: r.end, type: r.type, durationMin: r.duration_min,
  distanceKm: r.distance_km, avgHr: r.avg_hr, maxHr: r.max_hr, kcal: r.kcal, analysis: r.analysis ? JSON.parse(r.analysis) : null,
  samples: r.samples, createdAt: r.created_at, externalId: r.external_id ?? null, elevationM: r.elevation_m ?? null,
  effort: r.effort ?? null, hrRecovery: r.hr_recovery ?? null, details: r.details ? JSON.parse(r.details) : null,
});
const chatRow = (r) => ({ id: r.id, role: r.role, kind: r.kind, text: r.text, createdAt: r.created_at, readAt: r.read_at });
const favoriteRow = (r) => ({ id: r.id, name: r.name, text: r.text, kcal: r.kcal, proteinG: r.protein_g, createdAt: r.created_at });
const proposalRow = (r) => ({ id: r.id, weekStart: r.week_start, proposal: JSON.parse(r.json), text: r.text, status: r.status, createdAt: r.created_at, resolvedAt: r.resolved_at });
const noteRow = (r) => ({ id: r.id, weekStart: r.week_start, text: r.text, json: r.json ? JSON.parse(r.json) : null, createdAt: r.created_at });

/** Typed data-access helpers over an open database. */
export function makeRepo(db) {
  const q = (sql) => db.prepare(sql);

  const repo = {
    db,
    close: () => db.close(),

    getSetting(key, fallback = null) {
      const r = q('SELECT value FROM settings WHERE key = ?').get(key);
      return r ? JSON.parse(r.value) : fallback;
    },
    hasSetting(key) {
      return !!q('SELECT 1 FROM settings WHERE key = ?').get(key);
    },
    setSetting(key, value) {
      q('INSERT INTO settings(key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value').run(key, JSON.stringify(value));
    },
    allSettings() {
      const out = {};
      for (const r of q('SELECT key, value FROM settings').all()) out[r.key] = JSON.parse(r.value);
      return out;
    },

    /** Internal server state (not user settings): sync timestamps and the like. */
    getState(key, fallback = null) {
      const r = q('SELECT value FROM state WHERE key = ?').get(key);
      return r ? JSON.parse(r.value) : fallback;
    },
    setState(key, value) {
      q('INSERT INTO state(key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value').run(key, JSON.stringify(value));
    },

    activeProgram() {
      const r = q('SELECT json FROM program WHERE active = 1 ORDER BY id DESC LIMIT 1').get();
      return r ? JSON.parse(r.json) : null;
    },
    saveProgram(json) {
      db.exec('BEGIN');
      try {
        q('UPDATE program SET active = 0 WHERE active = 1').run();
        q('INSERT INTO program(json, active) VALUES (?, 1)').run(JSON.stringify(json));
        db.exec('COMMIT');
      } catch (e) {
        db.exec('ROLLBACK');
        throw e;
      }
      return json;
    },

    exerciseState(exerciseId) {
      const r = q('SELECT exercise_id, weight, below_min_streak FROM exercise_state WHERE exercise_id = ?').get(exerciseId);
      return r ? { exerciseId: r.exercise_id, weight: r.weight, belowMinStreak: r.below_min_streak } : null;
    },
    allExerciseState() {
      const out = {};
      for (const r of q('SELECT exercise_id, weight, below_min_streak FROM exercise_state').all()) {
        out[r.exercise_id] = { weight: r.weight, belowMinStreak: r.below_min_streak };
      }
      return out;
    },
    setExerciseState(exerciseId, weight, belowMinStreak = 0) {
      q(`INSERT INTO exercise_state(exercise_id, weight, below_min_streak, updated_at)
         VALUES (?, ?, ?, strftime('%Y-%m-%dT%H:%M:%fZ','now'))
         ON CONFLICT(exercise_id) DO UPDATE SET weight = excluded.weight,
           below_min_streak = excluded.below_min_streak, updated_at = excluded.updated_at`).run(exerciseId, weight, belowMinStreak);
    },

    startSession({ date, dayKey, type }) {
      const r = q('INSERT INTO sessions(date, day_key, type) VALUES (?, ?, ?) RETURNING *').get(date, dayKey, type);
      return sessionRow(r);
    },
    session(id) {
      const r = q('SELECT * FROM sessions WHERE id = ?').get(id);
      return r ? { ...sessionRow(r), sets: repo.sessionSets(id) } : null;
    },
    openSession(date) {
      const r = q('SELECT * FROM sessions WHERE date = ? AND finished_at IS NULL ORDER BY id DESC LIMIT 1').get(date);
      return r ? { ...sessionRow(r), sets: repo.sessionSets(r.id) } : null;
    },
    /** Latest session on a date, open or finished. */
    sessionOn(date) {
      const r = q('SELECT * FROM sessions WHERE date = ? ORDER BY id DESC LIMIT 1').get(date);
      return r ? { ...sessionRow(r), sets: repo.sessionSets(r.id) } : null;
    },
    deleteSession(id) {
      q('DELETE FROM sessions WHERE id = ?').run(id);
    },
    logSet(sessionId, s) {
      const r = q(`INSERT INTO sets(session_id, exercise_id, exercise_name, set_index, target_reps, reps, weight)
         VALUES (?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(session_id, exercise_id, set_index) DO UPDATE SET reps = excluded.reps, weight = excluded.weight,
           target_reps = excluded.target_reps, done_at = strftime('%Y-%m-%dT%H:%M:%fZ','now')
         RETURNING *`).get(sessionId, s.exerciseId, s.exerciseName, s.setIndex, s.targetReps ?? null, s.reps, s.weight);
      return setRow(r);
    },
    deleteSet(sessionId, exerciseId, setIndex) {
      q('DELETE FROM sets WHERE session_id = ? AND exercise_id = ? AND set_index = ?').run(sessionId, exerciseId, setIndex);
    },
    sessionSets(sessionId) {
      return q('SELECT * FROM sets WHERE session_id = ? ORDER BY exercise_id, set_index').all(sessionId).map(setRow);
    },
    finishSession(id, { feel = null, notes = null, distanceKm = null, durationMin = null } = {}) {
      const r = q(`UPDATE sessions SET finished_at = strftime('%Y-%m-%dT%H:%M:%fZ','now'), feel = ?, notes = ?,
         distance_km = ?, duration_min = ? WHERE id = ? RETURNING *`).get(feel, notes, distanceKm, durationMin, id);
      return r ? sessionRow(r) : null;
    },
    history(limit = 30) {
      const rows = q('SELECT * FROM sessions WHERE finished_at IS NOT NULL ORDER BY date DESC, id DESC LIMIT ?').all(limit);
      return rows.map((r) => ({ ...sessionRow(r), sets: repo.sessionSets(r.id) }));
    },
    lastSessionForDay(dayKey) {
      const r = q('SELECT * FROM sessions WHERE day_key = ? AND finished_at IS NOT NULL ORDER BY date DESC, id DESC LIMIT 1').get(dayKey);
      return r ? { ...sessionRow(r), sets: repo.sessionSets(r.id) } : null;
    },
    bests() {
      const rows = q(`SELECT s.exercise_id, s.weight, s.reps, se.date FROM sets s JOIN sessions se ON se.id = s.session_id
         WHERE se.finished_at IS NOT NULL ORDER BY s.weight DESC, s.reps DESC, se.date ASC`).all();
      const out = {};
      for (const r of rows) if (!out[r.exercise_id]) out[r.exercise_id] = { weight: r.weight, reps: r.reps, date: r.date };
      return out;
    },

    addCheckin({ date, weightKg, notes = null, bodyFatPct = null, source = 'manual' }) {
      const r = q(`INSERT INTO checkins(date, weight_kg, notes, body_fat_pct, source) VALUES (?, ?, ?, ?, ?)
         ON CONFLICT(date) DO UPDATE SET weight_kg = excluded.weight_kg, notes = excluded.notes,
           body_fat_pct = COALESCE(excluded.body_fat_pct, checkins.body_fat_pct), source = excluded.source RETURNING *`).get(date, weightKg, notes, bodyFatPct, source);
      return checkinRow(r);
    },
    checkinFor(date) {
      const r = q('SELECT * FROM checkins WHERE date = ?').get(date);
      return r ? checkinRow(r) : null;
    },
    checkins(limit = 52) {
      return q('SELECT * FROM checkins ORDER BY date DESC LIMIT ?').all(limit).map(checkinRow);
    },

    addFood({ date, text, kcal, proteinG }) {
      const r = q('INSERT INTO food(date, text, kcal, protein_g) VALUES (?, ?, ?, ?) RETURNING *').get(date, text, kcal, proteinG);
      return foodRow(r);
    },
    deleteFood(id) {
      q('DELETE FROM food WHERE id = ?').run(id);
    },
    foodForDate(date) {
      const entries = q('SELECT * FROM food WHERE date = ? ORDER BY id').all(date).map(foodRow);
      const totals = entries.reduce((t, e) => ({ kcal: t.kcal + e.kcal, proteinG: t.proteinG + e.proteinG }), { kcal: 0, proteinG: 0 });
      return { date, entries, totals };
    },
    foodDays(fromDate, toDate) {
      return q('SELECT date, SUM(kcal) AS kcal, SUM(protein_g) AS protein_g FROM food WHERE date BETWEEN ? AND ? GROUP BY date ORDER BY date')
        .all(fromDate, toDate)
        .map((r) => ({ date: r.date, kcal: r.kcal, proteinG: r.protein_g }));
    },

    addFavorite({ name, text, kcal, proteinG }) {
      return favoriteRow(q('INSERT INTO favorites(name, text, kcal, protein_g) VALUES (?, ?, ?, ?) RETURNING *').get(name, text, kcal, proteinG));
    },
    favorites() {
      return q('SELECT * FROM favorites ORDER BY name COLLATE NOCASE').all().map(favoriteRow);
    },
    deleteFavorite(id) {
      q('DELETE FROM favorites WHERE id = ?').run(id);
    },
    /** Distinct recent meals (by text), newest first, with the values of the latest entry. */
    recentMeals(fromDate, limit = 12) {
      return q(`SELECT f.text, f.kcal, f.protein_g, f.date FROM food f
         JOIN (SELECT text, MAX(id) AS id FROM food WHERE date >= ? GROUP BY text) last ON last.id = f.id
         ORDER BY f.id DESC LIMIT ?`).all(fromDate, limit)
        .map((r) => ({ text: r.text, kcal: r.kcal, proteinG: r.protein_g, date: r.date }));
    },

    addCoachNote({ weekStart, text, json = null }) {
      const r = q(`INSERT INTO coach_notes(week_start, text, json) VALUES (?, ?, ?)
         ON CONFLICT(week_start) DO UPDATE SET text = excluded.text, json = excluded.json,
           created_at = strftime('%Y-%m-%dT%H:%M:%fZ','now') RETURNING *`).get(weekStart, text, json ? JSON.stringify(json) : null);
      return noteRow(r);
    },
    replaceProposals(weekStart, items) {
      db.exec('BEGIN');
      try {
        q("DELETE FROM proposals WHERE week_start = ? AND status = 'open'").run(weekStart);
        for (const it of items) q('INSERT INTO proposals(week_start, json, text) VALUES (?, ?, ?)').run(weekStart, JSON.stringify(it.proposal), it.text);
        db.exec('COMMIT');
      } catch (e) {
        db.exec('ROLLBACK');
        throw e;
      }
    },
    openProposals() {
      return q("SELECT * FROM proposals WHERE status = 'open' ORDER BY id").all().map(proposalRow);
    },
    proposal(id) {
      const r = q('SELECT * FROM proposals WHERE id = ?').get(id);
      return r ? proposalRow(r) : null;
    },
    resolveProposal(id, status) {
      const r = q("UPDATE proposals SET status = ?, resolved_at = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id = ? RETURNING *").get(status, id);
      return r ? proposalRow(r) : null;
    },
    hasCoachNote(weekStart) {
      return !!q('SELECT 1 FROM coach_notes WHERE week_start = ?').get(weekStart);
    },
    coachNoteFor(weekStart) {
      const r = q('SELECT * FROM coach_notes WHERE week_start = ?').get(weekStart);
      return r ? noteRow(r) : null;
    },
    coachNotes(limit = 12) {
      return q('SELECT * FROM coach_notes ORDER BY week_start DESC LIMIT ?').all(limit).map(noteRow);
    },

    addWorkout(w) {
      const r = q(`INSERT INTO workouts(source, date, start, end, type, duration_min, distance_km, avg_hr, max_hr, kcal, analysis, samples,
           external_id, elevation_m, effort, hr_recovery, details)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(start, type) DO UPDATE SET end = excluded.end, duration_min = excluded.duration_min, distance_km = excluded.distance_km,
           avg_hr = excluded.avg_hr, max_hr = excluded.max_hr, kcal = excluded.kcal, analysis = excluded.analysis, samples = excluded.samples,
           source = excluded.source, external_id = COALESCE(excluded.external_id, workouts.external_id),
           elevation_m = COALESCE(excluded.elevation_m, workouts.elevation_m), effort = COALESCE(excluded.effort, workouts.effort),
           hr_recovery = COALESCE(excluded.hr_recovery, workouts.hr_recovery), details = COALESCE(excluded.details, workouts.details)
         RETURNING *`).get(w.source ?? 'apple', w.date, w.start, w.end ?? null, w.type, w.durationMin ?? null, w.distanceKm ?? null,
        w.avgHr ?? null, w.maxHr ?? null, w.kcal ?? null, w.analysis ? JSON.stringify(w.analysis) : null, w.samples ?? 0,
        w.externalId ?? null, w.elevationM ?? null, w.effort ?? null, w.hrRecovery ?? null, w.details ? JSON.stringify(w.details) : null);
      return workoutRow(r);
    },
    workout(id) {
      const r = q('SELECT * FROM workouts WHERE id = ?').get(id);
      return r ? workoutRow(r) : null;
    },
    deleteWorkoutByExternalId(externalId) {
      const r = q('DELETE FROM workouts WHERE external_id = ? RETURNING id').get(externalId);
      if (r) q('UPDATE sessions SET workout_id = NULL WHERE workout_id = ?').run(r.id);
      return !!r;
    },
    /**
     * Link a workout to the session it overlaps (started within 90 minutes of each other).
     * Returns the linked session id or null.
     */
    linkWorkout(workoutId) {
      const w = q('SELECT * FROM workouts WHERE id = ?').get(workoutId);
      if (!w) return null;
      const s = q(`SELECT id FROM sessions WHERE (workout_id IS NULL OR workout_id = ?)
         AND ABS(julianday(started_at) - julianday(?)) * 1440 <= 90
         ORDER BY ABS(julianday(started_at) - julianday(?)) LIMIT 1`).get(workoutId, w.start, w.start);
      if (!s) return null;
      q('UPDATE sessions SET workout_id = ? WHERE id = ?').run(workoutId, s.id);
      return s.id;
    },
    /** Link the closest unlinked workout to a session (used when a session finishes after the Watch already synced). */
    linkSession(sessionId) {
      const s = q('SELECT * FROM sessions WHERE id = ?').get(sessionId);
      if (!s) return null;
      const w = q(`SELECT id FROM workouts WHERE id NOT IN (SELECT workout_id FROM sessions WHERE workout_id IS NOT NULL)
         AND ABS(julianday(start) - julianday(?)) * 1440 <= 90
         ORDER BY ABS(julianday(start) - julianday(?)) LIMIT 1`).get(s.started_at, s.started_at);
      if (!w) return null;
      q('UPDATE sessions SET workout_id = ? WHERE id = ?').run(w.id, sessionId);
      return w.id;
    },
    workouts(limit = 30) {
      return q('SELECT * FROM workouts ORDER BY start DESC LIMIT ?').all(limit).map(workoutRow);
    },
    workoutsBetween(fromDate, toDate) {
      return q('SELECT * FROM workouts WHERE date BETWEEN ? AND ? ORDER BY start').all(fromDate, toDate).map(workoutRow);
    },

    upsertMetrics(date, metrics) {
      const stmt = q(`INSERT INTO daily_metrics(date, metric, value) VALUES (?, ?, ?)
         ON CONFLICT(date, metric) DO UPDATE SET value = excluded.value, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now')`);
      let n = 0;
      for (const [metric, value] of Object.entries(metrics)) {
        stmt.run(date, metric, value);
        n += 1;
      }
      return n;
    },
    /** { 'YYYY-MM-DD': { metric: value } } for a date range, optionally one metric. */
    metrics(fromDate, toDate, metric = null) {
      const rows = metric
        ? q('SELECT date, metric, value FROM daily_metrics WHERE date BETWEEN ? AND ? AND metric = ? ORDER BY date').all(fromDate, toDate, metric)
        : q('SELECT date, metric, value FROM daily_metrics WHERE date BETWEEN ? AND ? ORDER BY date').all(fromDate, toDate);
      const out = {};
      for (const r of rows) (out[r.date] ??= {})[r.metric] = r.value;
      return out;
    },

    addChat({ role, kind = 'chat', text }) {
      // Your own messages count as read; coach messages wait for you.
      const r = q(`INSERT INTO chat_messages(role, kind, text, read_at) VALUES (?, ?, ?, CASE WHEN ? = 'user' THEN strftime('%Y-%m-%dT%H:%M:%fZ','now') END) RETURNING *`)
        .get(role, kind, text, role);
      return chatRow(r);
    },
    chatSince(afterId = 0, limit = 200) {
      return q('SELECT * FROM chat_messages WHERE id > ? ORDER BY id LIMIT ?').all(afterId, limit).map(chatRow);
    },
    /** The latest n messages, oldest first. */
    chatTail(n = 30) {
      return q('SELECT * FROM (SELECT * FROM chat_messages ORDER BY id DESC LIMIT ?) ORDER BY id').all(n).map(chatRow);
    },
    markChatRead(upToId = null) {
      const sql = "UPDATE chat_messages SET read_at = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE read_at IS NULL";
      return upToId == null ? q(sql).run().changes : q(`${sql} AND id <= ?`).run(upToId).changes;
    },
    unreadChatCount() {
      return q('SELECT COUNT(*) AS n FROM chat_messages WHERE read_at IS NULL').get().n;
    },

    /** Record a one-off notification key; returns false when it was already sent. */
    claimNotification(key) {
      return q('INSERT INTO sent_notifications(key) VALUES (?) ON CONFLICT(key) DO NOTHING').run(key).changes === 1;
    },

    /** Did anything get logged on this date? Food, a session, a weigh-in or a workout. */
    loggedAnything(date) {
      return !!q(`SELECT 1 FROM food WHERE date = ?1 UNION ALL SELECT 1 FROM sessions WHERE date = ?1
         UNION ALL SELECT 1 FROM checkins WHERE date = ?1 UNION ALL SELECT 1 FROM workouts WHERE date = ?1 LIMIT 1`).get(date);
    },

    weekData(fromDate, toDate) {
      const sessions = q('SELECT * FROM sessions WHERE date BETWEEN ? AND ? AND finished_at IS NOT NULL ORDER BY date').all(fromDate, toDate)
        .map((r) => ({ ...sessionRow(r), sets: repo.sessionSets(r.id) }));
      const checkins = q('SELECT * FROM checkins WHERE date BETWEEN ? AND ? ORDER BY date').all(fromDate, toDate).map(checkinRow);
      return {
        fromDate, toDate, sessions, checkins, foodDays: repo.foodDays(fromDate, toDate), workouts: repo.workoutsBetween(fromDate, toDate),
        metrics: repo.metrics(fromDate, toDate),
      };
    },

    exportAll() {
      return {
        exportedAt: new Date().toISOString(),
        settings: repo.allSettings(),
        program: repo.activeProgram(),
        exerciseState: repo.allExerciseState(),
        sessions: q('SELECT * FROM sessions ORDER BY id').all().map(sessionRow),
        sets: q('SELECT * FROM sets ORDER BY id').all().map(setRow),
        checkins: q('SELECT * FROM checkins ORDER BY date').all().map(checkinRow),
        food: q('SELECT * FROM food ORDER BY id').all().map(foodRow),
        favorites: q('SELECT * FROM favorites ORDER BY id').all().map(favoriteRow),
        workouts: q('SELECT * FROM workouts ORDER BY start').all().map(workoutRow),
        coachNotes: q('SELECT * FROM coach_notes ORDER BY week_start').all().map(noteRow),
        proposals: q('SELECT * FROM proposals ORDER BY id').all().map(proposalRow),
        chat: q('SELECT * FROM chat_messages ORDER BY id').all().map(chatRow),
        dailyMetrics: q('SELECT date, metric, value FROM daily_metrics ORDER BY date, metric').all().map((r) => ({ ...r })),
      };
    },
  };
  return repo;
}
