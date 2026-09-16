import { plannedDay, todayStr, weekStartOf, addDays } from './schedule.js';
import { dayByKey, targetsFor, applyProgression } from './program.js';
import { reviewToText, CoachError } from './coach.js';
import { analyzeSamples, intensityFromAvg } from './hr.js';

export const DEFAULT_SETTINGS = {
  targets: { kcal: 2600, proteinG: 140 },
  voice: true,
  haAnnounce: false,
  holiday: null,
  maxHr: 191,
  athlete: '',
};

export function ensureDefaults(repo) {
  for (const [k, v] of Object.entries(DEFAULT_SETTINGS)) {
    if (repo.getSetting(k, undefined) === undefined) repo.setSetting(k, v);
  }
}

class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const num = (v, name, { min = -Infinity, max = Infinity, allowNull = false } = {}) => {
  if (v == null || v === '') {
    if (allowNull) return null;
    throw new HttpError(400, `${name} is required`);
  }
  const n = Number(v);
  if (!Number.isFinite(n) || n < min || n > max) throw new HttpError(400, `${name} is out of range`);
  return n;
};
const dateOf = (v) => {
  if (!v) return todayStr();
  if (!DATE_RE.test(v)) throw new HttpError(400, 'date must be YYYY-MM-DD');
  return v;
};

function readJson(req, limit = 1024 * 1024) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on('data', (c) => {
      size += c.length;
      if (size > limit) {
        reject(new HttpError(413, 'body too large'));
        req.destroy();
        return;
      }
      chunks.push(c);
    });
    req.on('end', () => {
      if (chunks.length === 0) return resolve({});
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString('utf8')));
      } catch {
        reject(new HttpError(400, 'invalid JSON'));
      }
    });
    req.on('error', reject);
  });
}

/** Any coach failure becomes a 503 with a readable message (SDK auth errors, network, CLI problems). */
function coachHttpError(e) {
  if (e instanceof HttpError) return e;
  if (e instanceof CoachError) return new HttpError(503, e.message);
  const status = e?.status;
  if (status === 401 || status === 403) return new HttpError(503, 'Coach credentials were rejected: check the token on the server');
  console.error(e);
  return new HttpError(503, `Coach unavailable: ${e?.message ?? 'unknown error'}`);
}

/** Accept {workouts:[...]}, a bare array, a single workout, or a Health Auto Export payload ({data:{workouts:[...]}}). */
export function normalizeWorkouts(body) {
  if (Array.isArray(body)) return body;
  if (Array.isArray(body?.workouts)) return body.workouts;
  if (Array.isArray(body?.data?.workouts)) return body.data.workouts.map(fromHealthAutoExport);
  if (body && (body.start || body.startDate)) return [body];
  return [];
}

const qty = (v) => (v && typeof v === 'object' ? Number(v.qty) : v == null ? null : Number(v));
function fromHealthAutoExport(w) {
  return {
    type: w.name ?? w.type ?? 'Workout',
    start: w.start ?? w.startDate,
    end: w.end ?? w.endDate,
    durationMin: w.duration != null ? Number(w.duration) / 60 : null,
    distanceKm: qty(w.distance),
    kcal: qty(w.activeEnergyBurned ?? w.activeEnergy),
    avgHr: qty(w.avgHeartRate),
    maxHr: qty(w.maxHeartRate),
    samples: Array.isArray(w.heartRateData) ? w.heartRateData.map((p) => ({ t: p.date, hr: p.Avg ?? p.avg ?? p.qty })) : [],
  };
}

/** Validate one workout and attach the zone analysis. */
export function prepareWorkout(w, maxHrSetting) {
  const startMs = Date.parse(w.start ?? w.startDate ?? '');
  if (!Number.isFinite(startMs)) throw new HttpError(400, 'workout needs a valid start');
  const endMs = Date.parse(w.end ?? w.endDate ?? '');
  const start = new Date(startMs).toISOString();
  const end = Number.isFinite(endMs) ? new Date(endMs).toISOString() : null;
  const samples = Array.isArray(w.samples) ? w.samples.slice(0, 50000) : [];
  const analysis = samples.length ? analyzeSamples(samples, maxHrSetting) : null;
  const avgHr = analysis?.avgHr ?? (w.avgHr != null ? Math.round(Number(w.avgHr)) : null);
  const maxHr = analysis?.maxHr ?? (w.maxHr != null ? Math.round(Number(w.maxHr)) : null);
  const durationMin = w.durationMin != null ? Number(w.durationMin) : end ? Math.round(((endMs - startMs) / 60000) * 10) / 10 : null;
  return {
    source: String(w.source ?? 'apple').slice(0, 40),
    date: todayStr(new Date(startMs)),
    start,
    end,
    type: String(w.type ?? 'Workout').slice(0, 60),
    durationMin: Number.isFinite(durationMin) ? durationMin : null,
    distanceKm: w.distanceKm != null && Number.isFinite(Number(w.distanceKm)) ? Number(w.distanceKm) : null,
    avgHr,
    maxHr,
    kcal: w.kcal != null && Number.isFinite(Number(w.kcal)) ? Number(w.kcal) : null,
    analysis: analysis ?? { minutesPerZone: null, intensity: intensityFromAvg(avgHr, maxHrSetting), avgHr, maxHr, samples: 0 },
    samples: samples.length,
  };
}

/** Run the weekly review for the week starting on weekStart (a Monday). */
export async function runWeeklyReview(ctx, weekStart) {
  const { repo, coach } = ctx;
  const week = repo.weekData(weekStart, addDays(weekStart, 6));
  const previous = repo.coachNotes(1)[0];
  const review = await coach.weeklyReview(week, ctx.program(), repo.allSettings(), previous?.text ?? null);
  return repo.addCoachNote({ weekStart, text: reviewToText(review), json: review });
}

/**
 * Build the API handler. Returns an async function (req, res, url) → boolean handled.
 * ctx: { repo, program: () => programJson, saveProgram(json), coach, announcer, auth, version }
 */
export function createApi(ctx) {
  const { repo, auth } = ctx;

  const routes = [
    ['GET', /^\/api\/health$/, () => ({ ok: true, version: ctx.version, coach: ctx.coach.enabled, ha: ctx.announcer.configured, auth: auth.enabled })],
    ['GET', /^\/api\/auth$/, (req) => ({ enabled: auth.enabled, ok: auth.verify(req.headers.cookie) })],
    ['POST', /^\/api\/login$/, async (req, res, m, body) => {
      const cookie = auth.cookieFor(body.password);
      if (!cookie) throw new HttpError(401, 'wrong password');
      res.setHeader('Set-Cookie', auth.setCookieHeader(cookie));
      return { ok: true };
    }],

    ['GET', /^\/api\/today$/, (req, res, m, body, url) => {
      const date = dateOf(url.searchParams.get('date'));
      const settings = repo.allSettings();
      const program = ctx.program();
      const openSession = repo.openSession(date);
      // An open session wins over the planned day (e.g. Lift A started on a rest day).
      const day = openSession ? dayByKey(program, openSession.dayKey) : plannedDay(program, date, settings);
      const last = day ? repo.lastSessionForDay(day.key) : null;
      return {
        date,
        holiday: settings.holiday ?? null,
        programName: program.name,
        programNotes: program.notes ?? null,
        day: day ? { ...day, exercises: targetsFor(repo, day) } : null,
        openSession,
        lastSession: last ? { date: last.date, feel: last.feel, notes: last.notes, sets: last.sets } : null,
        days: program.days.map((d) => ({ key: d.key, weekday: d.weekday, title: d.title, type: d.type, time: d.time })),
      };
    }],

    ['POST', /^\/api\/sessions$/, (req, res, m, body) => {
      const date = dateOf(body.date);
      const day = dayByKey(ctx.program(), String(body.dayKey ?? ''));
      if (!day) throw new HttpError(400, 'unknown dayKey');
      const open = repo.openSession(date);
      if (open) return open;
      const s = repo.startSession({ date, dayKey: day.key, type: day.type });
      return { ...s, sets: [] };
    }],
    ['DELETE', /^\/api\/sessions\/(\d+)$/, (req, res, m) => {
      repo.deleteSession(Number(m[1]));
      return { ok: true };
    }],
    ['POST', /^\/api\/sessions\/(\d+)\/sets$/, (req, res, m, body) => {
      const id = Number(m[1]);
      const session = repo.session(id);
      if (!session) throw new HttpError(404, 'session not found');
      if (session.finishedAt) throw new HttpError(409, 'session already finished');
      const day = dayByKey(ctx.program(), session.dayKey);
      const ex = day?.exercises.find((e) => e.id === body.exerciseId);
      const exerciseName = body.exerciseName ?? ex?.name;
      if (!exerciseName) throw new HttpError(400, 'unknown exerciseId');
      return repo.logSet(id, {
        exerciseId: String(body.exerciseId),
        exerciseName: String(exerciseName),
        setIndex: num(body.setIndex, 'setIndex', { min: 0, max: 20 }),
        targetReps: num(body.targetReps, 'targetReps', { allowNull: true, min: 0, max: 600 }),
        reps: num(body.reps, 'reps', { min: 0, max: 600 }),
        weight: num(body.weight, 'weight', { min: 0, max: 1000 }),
      });
    }],
    ['DELETE', /^\/api\/sessions\/(\d+)\/sets$/, (req, res, m, body) => {
      repo.deleteSet(Number(m[1]), String(body.exerciseId), num(body.setIndex, 'setIndex', { min: 0, max: 20 }));
      return { ok: true };
    }],
    ['POST', /^\/api\/sessions\/(\d+)\/finish$/, (req, res, m, body) => {
      const id = Number(m[1]);
      const existing = repo.session(id);
      if (!existing) throw new HttpError(404, 'session not found');
      if (existing.finishedAt) throw new HttpError(409, 'session already finished');
      const session = repo.finishSession(id, {
        feel: num(body.feel, 'feel', { allowNull: true, min: 1, max: 5 }),
        notes: body.notes ? String(body.notes).slice(0, 2000) : null,
        distanceKm: num(body.distanceKm, 'distanceKm', { allowNull: true, min: 0, max: 200 }),
        durationMin: num(body.durationMin, 'durationMin', { allowNull: true, min: 0, max: 1440 }),
      });
      const changes = applyProgression(repo, ctx.program(), id);
      return { session: { ...session, sets: repo.sessionSets(id) }, changes };
    }],

    ['GET', /^\/api\/history$/, (req, res, m, body, url) => {
      const limit = num(url.searchParams.get('limit') ?? 30, 'limit', { min: 1, max: 500 });
      return { sessions: repo.history(limit), bests: repo.bests(), workouts: repo.workouts(limit) };
    }],

    ['GET', /^\/api\/workouts$/, (req, res, m, body, url) => ({ workouts: repo.workouts(num(url.searchParams.get('limit') ?? 30, 'limit', { min: 1, max: 500 })) })],
    ['POST', /^\/api\/workouts$/, (req, res, m, body) => {
      const list = normalizeWorkouts(body);
      if (!list.length) throw new HttpError(400, 'no workouts in body');
      const maxHr = repo.getSetting('maxHr', DEFAULT_SETTINGS.maxHr);
      const imported = list.map((w) => repo.addWorkout(prepareWorkout(w, maxHr)));
      return { imported: imported.length, workouts: imported };
    }],

    ['GET', /^\/api\/checkins$/, () => ({ checkins: repo.checkins(104) })],
    ['POST', /^\/api\/checkins$/, (req, res, m, body) => repo.addCheckin({
      date: dateOf(body.date),
      weightKg: num(body.weightKg, 'weightKg', { min: 20, max: 300 }),
      notes: body.notes ? String(body.notes).slice(0, 500) : null,
    })],

    ['GET', /^\/api\/food$/, (req, res, m, body, url) => {
      const date = dateOf(url.searchParams.get('date'));
      return { ...repo.foodForDate(date), targets: repo.getSetting('targets', DEFAULT_SETTINGS.targets), estimator: ctx.coach.enabled };
    }],
    ['GET', /^\/api\/food\/favorites$/, () => ({
      favorites: repo.favorites(),
      recent: repo.recentMeals(addDays(todayStr(), -30), 12),
    })],
    ['POST', /^\/api\/food\/favorites$/, (req, res, m, body) => repo.addFavorite({
      name: String(body.name ?? '').trim().slice(0, 60) || String(body.text ?? '').trim().slice(0, 30) || 'Meal',
      text: String(body.text ?? '').trim().slice(0, 1000) || 'meal',
      kcal: num(body.kcal, 'kcal', { min: 0, max: 20000 }),
      proteinG: num(body.proteinG, 'proteinG', { min: 0, max: 1000 }),
    })],
    ['DELETE', /^\/api\/food\/favorites\/(\d+)$/, (req, res, m) => {
      repo.deleteFavorite(Number(m[1]));
      return { ok: true };
    }],
    ['POST', /^\/api\/food\/estimate$/, async (req, res, m, body) => {
      const text = String(body.text ?? '').trim();
      if (!text) throw new HttpError(400, 'text is required');
      try {
        return await ctx.coach.estimateFood(text.slice(0, 1000), repo.getSetting('athlete', ''));
      } catch (e) {
        throw coachHttpError(e);
      }
    }],
    ['POST', /^\/api\/food$/, (req, res, m, body) => repo.addFood({
      date: dateOf(body.date),
      text: String(body.text ?? '').trim().slice(0, 1000) || 'meal',
      kcal: num(body.kcal, 'kcal', { min: 0, max: 20000 }),
      proteinG: num(body.proteinG, 'proteinG', { min: 0, max: 1000 }),
    })],
    ['DELETE', /^\/api\/food\/(\d+)$/, (req, res, m) => {
      repo.deleteFood(Number(m[1]));
      return { ok: true };
    }],

    ['GET', /^\/api\/coach$/, () => ({ notes: repo.coachNotes(12), enabled: ctx.coach.enabled })],
    ['POST', /^\/api\/coach\/review$/, async (req, res, m, body) => {
      const weekStart = weekStartOf(dateOf(body.weekStart ?? body.date));
      try {
        return await runWeeklyReview(ctx, weekStart);
      } catch (e) {
        throw coachHttpError(e);
      }
    }],

    ['GET', /^\/api\/settings$/, () => repo.allSettings()],
    ['PUT', /^\/api\/settings$/, (req, res, m, body) => {
      for (const [k, v] of Object.entries(body)) {
        if (!(k in DEFAULT_SETTINGS)) throw new HttpError(400, `unknown setting ${k}`);
        if (k === 'holiday' && v && !(DATE_RE.test(v.from ?? '') && DATE_RE.test(v.to ?? ''))) throw new HttpError(400, 'holiday needs from and to dates');
        if (k === 'athlete') {
          repo.setSetting(k, String(v ?? '').slice(0, 1500));
        } else if (k === 'maxHr') {
          repo.setSetting(k, num(v, 'maxHr', { min: 120, max: 230 }));
        } else if (k === 'targets') {
          repo.setSetting(k, { kcal: num(v?.kcal, 'kcal', { min: 800, max: 8000 }), proteinG: num(v?.proteinG, 'proteinG', { min: 20, max: 400 }) });
        } else {
          repo.setSetting(k, v);
        }
      }
      return repo.allSettings();
    }],

    ['GET', /^\/api\/program$/, () => ctx.program()],
    ['PUT', /^\/api\/program$/, (req, res, m, body) => {
      if (!Array.isArray(body.days) || !body.name) throw new HttpError(400, 'program needs name and days');
      return ctx.saveProgram(body);
    }],

    ['POST', /^\/api\/ha\/announce$/, async (req, res, m, body) => {
      if (!ctx.announcer.configured) throw new HttpError(501, 'Home Assistant announce is not configured');
      try {
        await ctx.announcer.announce(String(body.text ?? '').slice(0, 300));
      } catch (e) {
        throw new HttpError(502, e.message);
      }
      return { ok: true };
    }],

    ['GET', /^\/api\/export$/, () => repo.exportAll()],
  ];

  const PUBLIC = new Set(['/api/health', '/api/auth', '/api/login']);

  return async function handleApi(req, res, url) {
    if (!url.pathname.startsWith('/api/')) return false;
    const send = (status, payload) => {
      const json = JSON.stringify(payload);
      res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
      res.end(json);
    };
    try {
      if (!PUBLIC.has(url.pathname) && !auth.verify(req.headers.cookie)) throw new HttpError(401, 'login required');
      for (const [method, re, handler] of routes) {
        const m = re.exec(url.pathname);
        if (!m || method !== req.method) continue;
        const body = method === 'GET' ? {} : await readJson(req);
        const result = await handler(req, res, m, body, url);
        send(200, result);
        return true;
      }
      throw new HttpError(404, 'not found');
    } catch (e) {
      if (e instanceof HttpError) send(e.status, { error: e.message });
      else {
        console.error(e);
        send(500, { error: 'internal error' });
      }
      return true;
    }
  };
}
