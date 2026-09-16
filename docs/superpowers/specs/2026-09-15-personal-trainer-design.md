# Personal Trainer — Design Spec (2026-09-15)

## Purpose

A self-hosted training companion for one athlete: shows the day's session, logs sets,
runs rest timers with voice cues, tracks runs, bodyweight and food, and carries
weekly coach notes written by Claude. Runs as one Node process in a Proxmox LXC
container on the homelab; the iPhone uses it as a home-screen web app.

Typical goals it was designed around: build strength and muscle, recomposition
(maintenance calories, high protein), returning to lifting after a running-only
period, 3 sessions/week growing to 4. The athlete's own profile lives in the
app's settings, not in the code.

## Non-goals

- No Apple Health / Apple Watch data ingestion (not accessible).
- No multi-user support, no accounts. One optional shared password.
- No food database or barcode scanning. Food is free text estimated by Claude.
- No native app. PWA only.

## Constraints

- Node >= 22.13 with built-in `node:sqlite`; runtime dependencies limited to
  `@anthropic-ai/sdk` and `zod`. No framework, no bundler.
- Single process, single SQLite file under `DATA_DIR` (default `./data`).
- Must work over plain HTTP on the LAN (no service worker required for core
  logging). Offline set logging is queued in `localStorage` and replayed.
- Time zone for scheduling: `Europe/Amsterdam`.
- Claude calls use model `claude-opus-5`; a missing `ANTHROPIC_API_KEY` disables
  the food estimator and weekly review but nothing else.

## Training program (seed data)

Week structure (weekday numbers: 1 = Monday):

| Key | Weekday | Time  | Type   | Title                          |
|-----|---------|-------|--------|--------------------------------|
| A   | 1       | 07:30 | lift   | Lift A — full body             |
| B   | 4       | 07:30 | lift   | Lift B — full body             |
| R   | 6       | 09:00 | run    | Easy run, 5–7 km               |
| H   | 3       | —     | home   | Optional home dumbbell session |

Lift A: back squat 3×5, bench press 3×6–8, seated cable row 3×8–10, Romanian
deadlift 3×8–10, hanging knee raise 3×10–15.
Lift B: deadlift 3×5, overhead press 3×6–8, lat pulldown 3×8–10, leg press
3×10–12, cable crunch 3×10–15.
Home H (25 min circuit): goblet squat, push-up, single-arm row, reverse lunge,
single-arm overhead press, dumbbell RDL, plank.
Travel T (used on lift days while `holiday` is set): push-up, bodyweight squat,
reverse lunge, pike push-up, glute bridge, plank, superman.

Progression is deterministic (no LLM):
- Each exercise has `weight`, `increment`, `repMin`, `repMax`.
- After a finished session: all sets with reps >= repMax → weight += increment.
- Any set below repMin in two consecutive sessions → weight = round to nearest
  increment of weight × 0.9.
- A `weight` of `null` means "find your working weight"; the first logged
  weight becomes the target.

Nutrition targets (settings): 2600 kcal, 140 g protein, weigh-in on Monday.

## Architecture

```
iPhone (PWA)  ──HTTP──▶  Node server (LXC)  ──▶  SQLite (DATA_DIR/trainer.db)
                            │  ├─ /api/*  JSON
                            │  ├─ /       static PWA (public/)
                            │  ├─ cron: Sunday 18:00 weekly review
                            │  ├─ Claude API (food estimate, weekly review)
                            │  └─ Home Assistant REST (optional announce)
Workstation (launchd weekly) ──▶ GET /api/export ──▶ a synced folder
```

### Modules (`src/`)

| File            | Responsibility                                                     |
|-----------------|--------------------------------------------------------------------|
| `db.js`         | Open SQLite, run migrations, typed query helpers                   |
| `schedule.js`   | Pure: what session is planned for a date (program + holiday)       |
| `progression.js`| Pure: next targets from a finished session's sets                 |
| `program.js`    | Load/seed/update the active program and exercise state             |
| `coach.js`      | Prompt building (pure) + Claude calls: food estimate, weekly review|
| `ha.js`         | Home Assistant announce via REST `tts.speak`                       |
| `auth.js`       | Optional password → signed cookie                                  |
| `api.js`        | Route table: request → handler, JSON in/out                        |
| `server.js`     | HTTP server, static files, cron loop, startup                      |
| `cli.js`        | `seed`, `review` commands for ops                                  |

### Data model (SQLite)

- `settings(key TEXT PK, value TEXT json)` — targets, holiday `{from,to}`,
  ha announce flag, voice flag.
- `program(id, json, active INTEGER, created_at)` — full program JSON.
- `exercise_state(exercise_id PK, weight REAL, below_min_streak INTEGER,
  updated_at)` — current target weight per exercise.
- `sessions(id, date, day_key, type, started_at, finished_at, feel INTEGER,
  notes, distance_km REAL, duration_min REAL)`.
- `sets(id, session_id, exercise_id, exercise_name, set_index, target_reps,
  reps, weight, done_at)`.
- `checkins(id, date UNIQUE, weight_kg, notes)`.
- `food(id, date, text, kcal, protein_g, created_at)`.
- `coach_notes(id, week_start, text, json, created_at)`.

### API

All JSON. Errors: `{error: string}` with 4xx/5xx.

| Method & path                  | Purpose                                              |
|--------------------------------|------------------------------------------------------|
| GET  /api/today?date=YYYY-MM-DD| Planned session for the date + exercise targets + open session |
| POST /api/sessions             | Start session `{date, dayKey}` → session               |
| POST /api/sessions/:id/sets    | Log a set `{exerciseId, setIndex, reps, weight}`       |
| POST /api/sessions/:id/finish  | `{feel, notes, distanceKm?, durationMin?}` → applies progression |
| GET  /api/history?limit=30     | Sessions with sets, newest first, per-exercise bests   |
| GET/POST /api/checkins         | Bodyweight entries                                     |
| GET  /api/food?date=           | Day entries + totals + targets                         |
| POST /api/food/estimate        | `{text}` → `{items, kcal, proteinG}` via Claude        |
| POST /api/food                 | Save entry `{date, text, kcal, proteinG}`              |
| GET  /api/coach                | Notes, newest first                                    |
| POST /api/coach/review         | Run the weekly review now                              |
| GET/PUT /api/settings          | Targets, holiday, flags                                |
| GET/PUT /api/program           | Active program JSON (coach edits from the Mac)         |
| POST /api/ha/announce          | `{text}` → HA tts.speak (204, or 501 when unconfigured)|
| GET  /api/export               | Everything as one JSON document                        |
| GET  /api/health               | `{ok:true, version}`                                   |

### Frontend (`public/`)

Single page, vanilla JS, five tabs: **Today**, **History**, **Check-in**,
**Food**, **Coach**. Today shows the planned session as a set checklist; tapping
a set opens reps/weight (prefilled with targets), logs it, and starts a rest
timer. When the timer ends the phone speaks the next set via
`speechSynthesis` (toggle in settings) and optionally posts to
`/api/ha/announce` when the session type is `home` and HA announce is on.
Finish asks for feel (1–5) and a note. Runs: distance, minutes, feel.
Unsent set logs are queued in `localStorage` and retried on load and online.
`manifest.webmanifest` gives the home-screen icon; `sw.js` caches the shell
when served over HTTPS (optional).

### Coach loop

- Sunday 18:00 Europe/Amsterdam (checked once a minute; guarded by
  `coach_notes.week_start` uniqueness) the server gathers the last 7 days of
  sessions, sets, check-ins, food totals and the program, and asks Claude for a
  structured review: `summary`, `wins[]`, `flags[]`, `nextWeek[]`,
  `nutrition`. Stored in `coach_notes`, shown in the Coach tab.
- Weight progression is never decided by the LLM; the review only comments.
- The athlete (via Claude Code on a workstation) can edit the program through
  `PUT /api/program` and read everything through `/api/export`.

### Auth

If `APP_PASSWORD` is set: `POST /api/login {password}` sets an HttpOnly cookie
holding an HMAC of a server secret; all other `/api/*` routes require it; the
static shell shows a password field when a request returns 401. If unset, the
app is open (LAN/tailnet only).

### Deployment

- `deploy/install-lxc.sh`: run on the Proxmox host; creates a Debian 12
  unprivileged CT, installs Node 24 (NodeSource), copies the app to
  `/opt/trainer`, writes `/etc/trainer.env` from `deploy/env.example`, installs
  and starts `trainer.service` (systemd), prints the URL.
- `deploy/update.sh`: rsync new code into the CT and restart.
- `Dockerfile` for the alternative Docker path.
- `scripts/export-to-folder.sh` + launchd plist: weekly export to a synced
  folder.
- `scripts/apple-calendar.sh`: creates recurring Apple Calendar events for the
  three fixed sessions in a "Training" calendar (run once, after the holiday).

## Error handling

- Claude unavailable/refused: food estimate returns 503 `{error}`; the UI
  falls back to manual kcal/protein fields. Weekly review logs the error and
  retries next minute for up to 3 attempts, then waits for the next week.
- HA unreachable: announce returns 502; the UI ignores it (phone voice still
  works).
- SQLite is opened with WAL and busy timeout; all writes are single statements
  or short transactions.

## Testing

`node --test test/`:
- `schedule.test.js`: weekday mapping, holiday substitution, rest days.
- `progression.test.js`: increment, hold, 10% back-off after two misses,
  null-weight adoption.
- `db.test.js`: migrations idempotent, session + sets round-trip.
- `api.test.js`: start server on port 0 with a temp DATA_DIR; exercise the
  today → start → log sets → finish → history flow and the food/checkin
  endpoints; Claude and HA are stubbed through injected functions.
- `coach.test.js`: prompt builder includes sessions and totals (pure).
