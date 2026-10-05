import http from 'node:http';
import { createReadStream, statSync } from 'node:fs';
import { join, extname, normalize, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { readFileSync } from 'node:fs';
import { openDb, makeRepo } from './db.js';
import { ensureProgram } from './program.js';
import { createApi, ensureDefaults, runWeeklyReview, DEFAULT_SETTINGS } from './api.js';
import { makeCoach } from './coach.js';
import { makeCliCoach } from './coach-cli.js';
import { makeAnnouncer } from './ha.js';
import { makeNotifier } from './notify.js';
import { makeAuth } from './auth.js';
import { todayStr, weekdayOf, weekStartOf, TIME_ZONE } from './schedule.js';

const here = fileURLToPath(new URL('.', import.meta.url));
export const ROOT = resolve(here, '..');
const VERSION = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8')).version;

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.webmanifest': 'application/manifest+json',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
};

function serveStatic(staticDir, req, res, url) {
  let pathname = decodeURIComponent(url.pathname);
  if (pathname === '/' || pathname === '') pathname = '/index.html';
  const file = normalize(join(staticDir, pathname));
  if (!file.startsWith(staticDir)) {
    res.writeHead(403).end();
    return;
  }
  let st;
  try {
    st = statSync(file);
  } catch {
    // SPA fallback: unknown paths without an extension get the shell
    if (!extname(pathname)) return serveStatic(staticDir, req, res, new URL('/index.html', url));
    res.writeHead(404, { 'Content-Type': 'text/plain' }).end('not found');
    return;
  }
  if (!st.isFile()) {
    res.writeHead(404).end();
    return;
  }
  res.writeHead(200, {
    'Content-Type': TYPES[extname(file)] ?? 'application/octet-stream',
    'Content-Length': st.size,
    'Cache-Control': 'no-cache',
  });
  if (req.method === 'HEAD') return res.end();
  createReadStream(file).pipe(res);
}

const amsterdamHour = new Intl.DateTimeFormat('en-GB', { timeZone: TIME_ZONE, hour: '2-digit', hour12: false });

/** Sunday from 18:00 Amsterdam time, once per week, at most 3 attempts. */
export function makeReviewCron(ctx, { hour = 18, weekday = 7, log = console } = {}) {
  let attempts = { weekStart: null, count: 0 };
  return async function tick(now = new Date()) {
    if (!ctx.coach.enabled) return false;
    const date = todayStr(now);
    if (weekdayOf(date) !== weekday) return false;
    if (Number(amsterdamHour.format(now)) < hour) return false;
    const weekStart = weekStartOf(date);
    // A note written earlier in the week (a manual run) is replaced by the Sunday review; one written on Sunday is final.
    const existing = ctx.repo.coachNoteFor(weekStart);
    if (existing && todayStr(new Date(existing.createdAt)) >= date) return false;
    if (attempts.weekStart !== weekStart) attempts = { weekStart, count: 0 };
    if (attempts.count >= 3) return false;
    attempts.count += 1;
    try {
      await runWeeklyReview(ctx, weekStart);
      log.info?.(`[coach] weekly review written for ${weekStart}`);
      return true;
    } catch (e) {
      log.error?.(`[coach] weekly review failed (attempt ${attempts.count}): ${e.message}`);
      return false;
    }
  };
}

const amsterdamTime = new Intl.DateTimeFormat('en-GB', { timeZone: TIME_ZONE, hour: '2-digit', minute: '2-digit', hour12: false });

const REMINDER_TEXT = [
  'Nothing logged today yet. Meals, a weigh-in or a quick note all count.',
  'Quiet day in Restbell. Log what you ate so the coach sees the full week.',
];

/** Once a day after settings.reminders.time (Amsterdam), push a reminder if nothing at all was logged that day. */
export function makeReminderCron(ctx, { log = console } = {}) {
  return async function tick(now = new Date()) {
    if (!ctx.notifier?.configured) return false;
    const r = ctx.repo.getSetting('reminders', DEFAULT_SETTINGS.reminders);
    if (!r?.enabled) return false;
    if (amsterdamTime.format(now) < r.time) return false;
    const date = todayStr(now);
    if (ctx.repo.loggedAnything(date)) return false;
    if (!ctx.repo.claimNotification(`reminder:${date}`)) return false;
    const body = REMINDER_TEXT[Number(date.slice(-2)) % REMINDER_TEXT.length];
    const ok = await ctx.notifier.send({ title: 'Restbell', body, url: `${ctx.linkBase}food`, group: 'reminder' });
    log.info?.(`[notify] daily reminder for ${date} ${ok ? 'sent' : 'failed'}`);
    return ok;
  };
}

export function buildContext({ dataDir, coach, announcer, auth, notifier = makeNotifier({}), linkBase = 'restbell://', seedPath = join(ROOT, 'seed', 'program.json') }) {
  const repo = makeRepo(openDb(join(dataDir, 'trainer.db')));
  ensureDefaults(repo);
  let program = ensureProgram(repo, seedPath);
  return {
    repo,
    coach,
    announcer,
    auth,
    notifier,
    linkBase,
    // Coach replies run after the request returns; tests and shutdown wait on these.
    background: new Set(),
    chatPending: 0,
    settle: async function settle() {
      while (this.background.size) await Promise.allSettled([...this.background]);
    },
    version: VERSION,
    program: () => program,
    saveProgram(json) {
      program = repo.saveProgram(json);
      return program;
    },
  };
}

export function startServer({
  port = 0,
  host = '0.0.0.0',
  dataDir,
  staticDir = join(ROOT, 'public'),
  coach = makeCoach({ client: null }),
  announcer = makeAnnouncer({}),
  auth = makeAuth({}),
  notifier = makeNotifier({}),
  linkBase = 'restbell://',
  cron = true,
  log = console,
} = {}) {
  const ctx = buildContext({ dataDir, coach, announcer, auth, notifier, linkBase });
  const api = createApi(ctx);
  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url, 'http://localhost');
    try {
      if (await api(req, res, url)) return;
      if (req.method !== 'GET' && req.method !== 'HEAD') {
        res.writeHead(405).end();
        return;
      }
      serveStatic(staticDir, req, res, url);
    } catch (e) {
      log.error(e);
      if (!res.headersSent) res.writeHead(500, { 'Content-Type': 'text/plain' });
      res.end('internal error');
    }
  });
  let timer = null;
  if (cron) {
    const review = makeReviewCron(ctx, { log });
    const reminder = makeReminderCron(ctx, { log });
    timer = setInterval(() => {
      review().catch((e) => log.error(e));
      reminder().catch((e) => log.error(e));
    }, 60_000);
    timer.unref();
  }
  return new Promise((resolvePromise, reject) => {
    server.once('error', reject);
    server.listen(port, host, () => {
      const address = server.address();
      resolvePromise({
        server,
        ctx,
        port: address.port,
        close: async () => {
          if (timer) clearInterval(timer);
          await ctx.settle();
          await new Promise((r) => server.close(r));
          ctx.repo.close();
        },
      });
    });
  });
}

/** API key → SDK; subscription token (or COACH_BACKEND=cli) → Claude Code CLI; else off. */
export async function pickCoach(env) {
  // A subscription token pasted into the API key slot still works: route it to the CLI backend.
  if (env.ANTHROPIC_API_KEY?.startsWith('sk-ant-oat') && !env.CLAUDE_CODE_OAUTH_TOKEN) {
    env = { ...env, CLAUDE_CODE_OAUTH_TOKEN: env.ANTHROPIC_API_KEY, ANTHROPIC_API_KEY: '' };
  }
  if (env.ANTHROPIC_API_KEY) {
    const { default: Anthropic } = await import('@anthropic-ai/sdk');
    return makeCoach({ client: new Anthropic({ apiKey: env.ANTHROPIC_API_KEY, maxRetries: 2, timeout: 120_000 }) });
  }
  if (env.CLAUDE_CODE_OAUTH_TOKEN || env.COACH_BACKEND === 'cli') {
    return makeCliCoach({ bin: env.CLAUDE_BIN ?? 'claude', models: { food: env.COACH_MODEL_FOOD, review: env.COACH_MODEL_REVIEW, chat: env.COACH_MODEL_CHAT }, env });
  }
  return makeCoach({ client: null });
}

async function main() {
  const env = process.env;
  const dataDir = resolve(env.DATA_DIR ?? join(ROOT, 'data'));
  const coach = await pickCoach(env);
  const { port } = await startServer({
    port: Number(env.PORT ?? 3000),
    host: env.HOST ?? '0.0.0.0',
    dataDir,
    coach,
    announcer: makeAnnouncer({ url: env.HA_URL, token: env.HA_TOKEN, ttsEntity: env.HA_TTS_ENTITY, mediaPlayer: env.HA_MEDIA_PLAYER }),
    auth: makeAuth({ password: env.APP_PASSWORD ?? '', secret: env.APP_SECRET }),
    notifier: makeNotifier({ haUrl: env.HA_URL, haToken: env.HA_TOKEN, haService: env.HA_NOTIFY_SERVICE, ntfyUrl: env.NTFY_URL, ntfyToken: env.NTFY_TOKEN }),
    linkBase: env.NOTIFY_LINK_BASE || 'restbell://',
  });
  console.log(`trainer ${VERSION} listening on :${port} (data: ${dataDir}, coach: ${coach.backend}, password: ${env.APP_PASSWORD ? 'on' : 'off'})`);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((e) => {
    console.error(e);
    process.exit(1);
  });
}
