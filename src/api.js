import { plannedDay, todayStr, weekStartOf, addDays } from './schedule.js';
import { dayByKey, targetsFor, applyProgression } from './program.js';
import { reviewToText, CoachError, buildChatContext, fmtSession } from './coach.js';
import { cleanMetrics, energyBalance } from './metrics.js';
import { recoveryFor, recoveryText } from './recovery.js';
import { preview } from './notify.js';
import { analyzeSamples, intensityFromAvg } from './hr.js';
import { sanitizeProposals, describeProposal, applyProposal } from './proposals.js';
import { computeStats } from './stats.js';

export const DEFAULT_SETTINGS = {
  targets: { kcal: 2600, proteinG: 140 },
  voice: true,
  haAnnounce: false,
  holiday: null,
  maxHr: 191,
  athlete: '',
  reminders: { enabled: true, time: '20:30' },
  debrief: true,
};

const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/;
const HEALTH_STALE_MS = 24 * 3600_000;

export function ensureDefaults(repo) {
  for (const [k, v] of Object.entries(DEFAULT_SETTINGS)) {
    if (!repo.hasSetting(k)) repo.setSetting(k, v);
  }
}

/** Stored settings with defaults filled in for anything missing. */
export function settingsWithDefaults(repo) {
  return { ...DEFAULT_SETTINGS, ...repo.allSettings() };
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
    externalId: w.externalId != null ? String(w.externalId).slice(0, 80) : null,
    elevationM: finiteOrNull(w.elevationM),
    effort: finiteOrNull(w.effort),
    hrRecovery: w.hrRecovery != null && Number.isFinite(Number(w.hrRecovery)) ? Math.round(Number(w.hrRecovery)) : null,
    details: cleanDetails(w.details),
  };
}

const finiteOrNull = (v) => (v != null && v !== '' && Number.isFinite(Number(v)) ? Number(v) : null);

/** Keep only the known numeric workout details, and splits as [{ km, sec }]. */
function cleanDetails(d) {
  if (!d || typeof d !== 'object') return null;
  const out = {};
  for (const k of ['cadenceSpm', 'powerW', 'strideM', 'groundContactMs', 'verticalOscillationCm', 'speedKmh', 'totalKcal', 'stepCount']) {
    const v = finiteOrNull(d[k]);
    if (v != null) out[k] = v;
  }
  if (Array.isArray(d.splits)) {
    out.splits = d.splits.slice(0, 200).map((x) => ({ km: finiteOrNull(x?.km) ?? 1, sec: finiteOrNull(x?.sec) })).filter((x) => x.sec != null && x.sec > 0);
  }
  return Object.keys(out).length ? out : null;
}

/** Run the weekly review for the week starting on weekStart (a Monday). */
export async function runWeeklyReview(ctx, weekStart) {
  const { repo, coach } = ctx;
  const week = weekWithContext(repo, weekStart);
  const previous = repo.coachNotes(1)[0];
  const review = await coach.weeklyReview(week, ctx.program(), repo.allSettings(), previous?.text ?? null, todayStr());
  const note = repo.addCoachNote({ weekStart, text: reviewToText(review), json: review });
  const program = ctx.program();
  const proposals = sanitizeProposals(review.proposals, program).map((proposal) => ({ proposal, text: describeProposal(proposal, program) }));
  repo.replaceProposals(weekStart, proposals);
  const open = repo.openProposals().filter((p) => p.weekStart === weekStart);
  // The review also lands in the chat, so it notifies like any other coach message.
  const chatText = `${review.summary}${open.length ? `\n\nI proposed ${open.length} change${open.length > 1 ? 's' : ''} to your plan: have a look in the weekly note.` : ''}`;
  await postCoachMessage(ctx, { kind: 'review', text: chatText, title: 'Your weekly review is in' });
  return { ...note, proposals: open };
}

/** weekData plus last week's metrics, today's recovery and a stale-sync warning, for coach prompts. */
export function weekWithContext(repo, weekStart, today = todayStr()) {
  const week = repo.weekData(weekStart, addDays(weekStart, 6));
  week.previousMetrics = repo.metrics(addDays(weekStart, -7), addDays(weekStart, -1));
  week.recovery = recoveryText(recoveryFor(repo.metrics(addDays(today, -28), today), today));
  week.healthSyncStale = healthStaleText(repo);
  return week;
}

export function healthStatus(repo, now = Date.now()) {
  const last = repo.getState('lastHealthSync', null);
  return { lastSync: last, stale: !!last && now - Date.parse(last) > HEALTH_STALE_MS };
}

function healthStaleText(repo) {
  const h = healthStatus(repo);
  return h.stale ? `Note: Apple Health has not synced since ${h.lastSync.slice(0, 16).replace('T', ' ')} UTC, so recent Watch data is missing — that is not missed training.` : null;
}

/** Store a coach message and push it to the phone. */
export async function postCoachMessage(ctx, { kind = 'chat', text, title = 'Coach' }) {
  const msg = ctx.repo.addChat({ role: 'coach', kind, text });
  await ctx.notifier?.send({ title, body: preview(text), url: `${ctx.linkBase ?? 'restbell://'}chat`, group: 'coach' });
  return msg;
}

function chatContext(ctx, date = todayStr()) {
  const { repo } = ctx;
  const settings = repo.allSettings();
  const program = ctx.program();
  const openSession = repo.openSession(date);
  const day = openSession ? dayByKey(program, openSession.dayKey) : plannedDay(program, date, settings);
  return buildChatContext({
    settings,
    program,
    today: date,
    day: day ? { ...day, exercises: targetsFor(repo, day) } : null,
    openSession,
    week: weekWithContext(repo, weekStartOf(date), date),
    latestNote: repo.coachNotes(1)[0] ?? null,
    proposals: repo.openProposals(),
  });
}

/** Run a coach reply in the background; failures become a visible coach message instead of a silent gap. */
function replyInBackground(ctx, history, { kind = 'chat', title = 'Coach' } = {}) {
  ctx.chatPending = (ctx.chatPending ?? 0) + 1;
  const job = (async () => {
    try {
      const { text } = await ctx.coach.chat(history, chatContext(ctx));
      await postCoachMessage(ctx, { kind, text, title });
    } catch (e) {
      if (kind === 'chat') ctx.repo.addChat({ role: 'coach', kind: 'error', text: `I couldn't answer just now (${coachHttpError(e).message}). Try again in a minute.` });
      else console.error(`[coach] ${kind} failed: ${e.message}`);
    } finally {
      ctx.chatPending -= 1;
    }
  })();
  ctx.background?.add(job);
  job.finally(() => ctx.background?.delete(job));
  return job;
}

/** Everything the widgets and the app's Today screen need, in one call. */
export function buildSummary(ctx, date) {
  const { repo } = ctx;
  const settings = settingsWithDefaults(repo);
  const program = ctx.program();
  const food = repo.foodForDate(date);
  const session = repo.sessionOn(date);
  const planned = plannedDay(program, date, settings);
  const day = session ? dayByKey(program, session.dayKey) ?? planned : planned;
  const setsTotal = day?.exercises?.reduce((a, e) => a + e.sets, 0) ?? 0;
  const status = session ? (session.finishedAt ? 'done' : 'active') : day ? 'planned' : 'rest';
  const stats = computeStats({ today: date, program, settings, sessions: repo.history(400), checkins: repo.checkins(52) });
  const metrics = repo.metrics(addDays(date, -28), date);
  const todayMetrics = metrics[date] ?? {};
  const recovery = recoveryFor(metrics, date);
  const lastWorkout = repo.workouts(1)[0] ?? null;
  const balance = energyBalance({ [date]: todayMetrics }, [{ date, kcal: food.totals.kcal }]);
  return {
    date,
    food: { kcal: Math.round(food.totals.kcal), proteinG: Math.round(food.totals.proteinG), entries: food.entries.length, targets: settings.targets },
    session: day ? {
      status, dayKey: day.key, title: day.title, type: day.type, time: day.time ?? null,
      sessionId: session?.id ?? null, setsDone: session?.sets.length ?? 0, setsTotal,
    } : { status: 'rest' },
    week: stats.week,
    streak: stats.streak,
    bodyweight: stats.bodyweight,
    unreadChat: repo.unreadChatCount(),
    lastWorkout: lastWorkout && {
      id: lastWorkout.id, date: lastWorkout.date, type: lastWorkout.type, durationMin: lastWorkout.durationMin, distanceKm: lastWorkout.distanceKm,
      kcal: lastWorkout.kcal, avgHr: lastWorkout.avgHr, intensity: lastWorkout.analysis?.intensity ?? null, minutesPerZone: lastWorkout.analysis?.minutesPerZone ?? null, effort: lastWorkout.effort,
    },
    activity: {
      moveKcal: todayMetrics.active_kcal ?? null, moveGoal: todayMetrics.move_goal_kcal ?? null,
      exerciseMin: todayMetrics.exercise_min ?? null, exerciseGoal: todayMetrics.exercise_goal_min ?? null,
      standHours: todayMetrics.stand_hours ?? null, standGoal: todayMetrics.stand_goal_hours ?? null,
      steps: todayMetrics.steps ?? null, sleepMin: todayMetrics.sleep_min ?? null,
    },
    energy: balance.days[0] ?? null,
    recovery: recovery.level ? { level: recovery.level, score: recovery.score, reasons: recovery.reasons } : null,
    health: healthStatus(repo),
    favorites: repo.favorites().slice(0, 4).map((f) => ({ id: f.id, name: f.name, kcal: f.kcal, proteinG: f.proteinG })),
  };
}

/**
 * Build the API handler. Returns an async function (req, res, url) → boolean handled.
 * ctx: { repo, program: () => programJson, saveProgram(json), coach, announcer, auth, version }
 */
export function createApi(ctx) {
  const { repo, auth } = ctx;

  const routes = [
    ['GET', /^\/api\/health$/, () => ({ ok: true, version: ctx.version, coach: ctx.coach.enabled, ha: ctx.announcer.configured, auth: auth.enabled, notify: ctx.notifier?.channels ?? [] })],
    ['GET', /^\/api\/summary$/, (req, res, m, body, url) => buildSummary(ctx, dateOf(url.searchParams.get('date')))],
    ['GET', /^\/api\/auth$/, (req) => ({ enabled: auth.enabled, ok: auth.verifyRequest(req) })],
    ['POST', /^\/api\/login$/, async (req, res, m, body) => {
      // Behind the Cloudflare tunnel every request comes from cloudflared, which passes the visitor's address along.
      const client = req.headers['cf-connecting-ip'] ?? req.socket.remoteAddress;
      const result = auth.login(body.password, client);
      if (result.locked) {
        res.setHeader('Retry-After', String(result.retryAfterSec));
        throw new HttpError(429, 'too many attempts, try again later');
      }
      if (!result.ok) throw new HttpError(401, 'wrong password');
      res.setHeader('Set-Cookie', auth.setCookieHeader(result.cookie, { secure: req.headers['x-forwarded-proto'] === 'https' }));
      // The iOS app stores this token in the Keychain and sends it as a bearer header.
      return { ok: true, token: result.cookie };
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

    ['GET', /^\/api\/stats$/, (req, res, m, body, url) => {
      const date = dateOf(url.searchParams.get('date'));
      return computeStats({ today: date, program: ctx.program(), settings: repo.allSettings(), sessions: repo.history(400), checkins: repo.checkins(52) });
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
      repo.linkSession(id);
      const finished = repo.session(id);
      if (ctx.coach.enabled && repo.getSetting('debrief', DEFAULT_SETTINGS.debrief)) {
        const ask = `I just finished this session:\n${fmtSession(finished)}${changes.some((c) => c.weight !== c.from) ? `\nThe app's progression rules changed: ${changes.filter((c) => c.weight !== c.from).map((c) => `${c.name} ${c.from ?? '?'} → ${c.weight} kg`).join(', ')}` : ''}\nGive me a short debrief: 2 to 3 sentences, what went well and one thing for next time.`;
        replyInBackground(ctx, [...repo.chatTail(10), { role: 'user', text: ask }], { kind: 'debrief', title: 'Session debrief' });
      }
      return { session: finished, changes };
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
      for (const w of imported) repo.linkWorkout(w.id);
      return { imported: imported.length, workouts: imported };
    }],
    ['DELETE', /^\/api\/workouts\/external\/([^/]+)$/, (req, res, m) => ({ deleted: repo.deleteWorkoutByExternalId(decodeURIComponent(m[1])) })],
    ['GET', /^\/api\/workouts\/(\d+)$/, (req, res, m) => {
      const w = repo.workout(Number(m[1]));
      if (!w) throw new HttpError(404, 'workout not found');
      return w;
    }],

    ['GET', /^\/api\/metrics$/, (req, res, m, body, url) => {
      const to = dateOf(url.searchParams.get('to'));
      const from = url.searchParams.get('from') ? dateOf(url.searchParams.get('from')) : addDays(to, -6);
      if (from > to) throw new HttpError(400, 'from is after to');
      if (Date.parse(to) - Date.parse(from) > 400 * 86400000) throw new HttpError(400, 'range too long');
      const metric = url.searchParams.get('metric');
      return { from, to, days: repo.metrics(from, to, metric || null), health: healthStatus(repo) };
    }],
    // Body: { days: [{ date, metrics: { steps: 9120, ... } }] } or a single { date, metrics }.
    ['PUT', /^\/api\/metrics$/, (req, res, m, body) => {
      const days = Array.isArray(body.days) ? body.days : body.date ? [body] : [];
      if (!days.length) throw new HttpError(400, 'no days in body');
      if (days.length > 400) throw new HttpError(400, 'too many days');
      const clean = days.map((d) => {
        if (!DATE_RE.test(d?.date ?? '')) throw new HttpError(400, 'each day needs a YYYY-MM-DD date');
        try {
          return { date: d.date, metrics: cleanMetrics(d.metrics) };
        } catch (e) {
          throw new HttpError(400, `${d.date}: ${e.message}`);
        }
      });
      let values = 0;
      for (const d of clean) values += repo.upsertMetrics(d.date, d.metrics);
      repo.setState('lastHealthSync', new Date().toISOString());
      return { days: clean.length, values, health: healthStatus(repo) };
    }],
    ['GET', /^\/api\/recovery$/, (req, res, m, body, url) => {
      const date = dateOf(url.searchParams.get('date'));
      return { date, ...recoveryFor(repo.metrics(addDays(date, -28), date), date) };
    }],

    ['GET', /^\/api\/checkins$/, () => ({ checkins: repo.checkins(104) })],
    ['POST', /^\/api\/checkins$/, (req, res, m, body) => {
      const date = dateOf(body.date);
      const source = body.source === 'healthkit' ? 'healthkit' : 'manual';
      // A weigh-in typed by hand wins over the scale reading synced from Apple Health.
      const existing = repo.checkinFor(date);
      if (source === 'healthkit' && existing && existing.source === 'manual') return { ...existing, skipped: true };
      return repo.addCheckin({
        date,
        weightKg: num(body.weightKg, 'weightKg', { min: 20, max: 300 }),
        notes: body.notes ? String(body.notes).slice(0, 500) : null,
        bodyFatPct: num(body.bodyFatPct, 'bodyFatPct', { allowNull: true, min: 2, max: 70 }),
        source,
      });
    }],

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

    ['GET', /^\/api\/coach$/, () => ({ notes: repo.coachNotes(12), proposals: repo.openProposals(), enabled: ctx.coach.enabled })],

    ['GET', /^\/api\/chat$/, (req, res, m, body, url) => {
      const after = num(url.searchParams.get('after') ?? 0, 'after', { min: 0 });
      const messages = after ? repo.chatSince(after) : repo.chatTail(num(url.searchParams.get('limit') ?? 50, 'limit', { min: 1, max: 500 }));
      return { messages, pending: (ctx.chatPending ?? 0) > 0, unread: repo.unreadChatCount(), enabled: ctx.coach.enabled };
    }],
    ['POST', /^\/api\/chat$/, (req, res, m, body) => {
      const text = String(body.text ?? '').trim().slice(0, 4000);
      if (!text) throw new HttpError(400, 'text is required');
      if (!ctx.coach.enabled) throw new HttpError(503, 'The coach is off: no Claude credentials on the server');
      const message = repo.addChat({ role: 'user', text });
      // Opening the chat to write counts as reading what the coach said before.
      repo.markChatRead(message.id);
      replyInBackground(ctx, repo.chatTail(30));
      return { message, pending: true };
    }],
    ['POST', /^\/api\/chat\/read$/, (req, res, m, body) => ({
      marked: repo.markChatRead(body.upToId != null ? num(body.upToId, 'upToId', { min: 0 }) : null),
      unread: repo.unreadChatCount(),
    })],
    ['POST', /^\/api\/coach\/proposals\/(\d+)\/(apply|dismiss)$/, (req, res, m) => {
      const row = repo.proposal(Number(m[1]));
      if (!row) throw new HttpError(404, 'proposal not found');
      if (row.status !== 'open') throw new HttpError(409, `proposal already ${row.status}`);
      if (m[2] === 'dismiss') return repo.resolveProposal(row.id, 'dismissed');
      const change = applyProposal(row.proposal, ctx.program(), repo.allSettings());
      if (change.program) ctx.saveProgram(change.program);
      for (const [k, v] of Object.entries(change.settings)) repo.setSetting(k, v);
      for (const [id, w] of Object.entries(change.exerciseWeights)) repo.setExerciseState(id, w, 0);
      return repo.resolveProposal(row.id, 'applied');
    }],
    ['POST', /^\/api\/coach\/review$/, async (req, res, m, body) => {
      const weekStart = weekStartOf(dateOf(body.weekStart ?? body.date));
      try {
        return await runWeeklyReview(ctx, weekStart);
      } catch (e) {
        throw coachHttpError(e);
      }
    }],

    ['GET', /^\/api\/settings$/, () => settingsWithDefaults(repo)],
    ['PUT', /^\/api\/settings$/, (req, res, m, body) => {
      for (const [k, v] of Object.entries(body)) {
        if (!(k in DEFAULT_SETTINGS)) throw new HttpError(400, `unknown setting ${k}`);
        if (k === 'holiday' && v && !(DATE_RE.test(v.from ?? '') && DATE_RE.test(v.to ?? ''))) throw new HttpError(400, 'holiday needs from and to dates');
        if (k === 'athlete') {
          repo.setSetting(k, String(v ?? '').slice(0, 1500));
        } else if (k === 'maxHr') {
          repo.setSetting(k, num(v, 'maxHr', { min: 120, max: 230 }));
        } else if (k === 'reminders') {
          if (!TIME_RE.test(v?.time ?? '')) throw new HttpError(400, 'reminders.time must be HH:MM');
          repo.setSetting(k, { enabled: !!v.enabled, time: v.time });
        } else if (k === 'debrief') {
          repo.setSetting(k, !!v);
        } else if (k === 'targets') {
          repo.setSetting(k, { kcal: num(v?.kcal, 'kcal', { min: 800, max: 8000 }), proteinG: num(v?.proteinG, 'proteinG', { min: 20, max: 400 }) });
        } else {
          repo.setSetting(k, v);
        }
      }
      return settingsWithDefaults(repo);
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
      if (!PUBLIC.has(url.pathname) && !auth.verifyRequest(req)) throw new HttpError(401, 'login required');
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
