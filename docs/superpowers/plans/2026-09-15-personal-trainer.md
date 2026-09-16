# Personal Trainer Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the self-hosted training app described in the spec: Node + SQLite API, PWA frontend, deterministic progression, Claude-powered food estimates and weekly coach review, LXC deployment.

**Architecture:** One Node ESM process (`src/server.js`) serves `/api/*` JSON routes and static files from `public/`. Pure modules (`schedule.js`, `progression.js`, coach prompt builder) are tested in isolation; `api.test.js` runs the real server on port 0 against a temp SQLite file with Claude/HA injected as stubs.

**Tech Stack:** Node >= 22.13 (`node:sqlite`, `node:test`, `node:http`), `@anthropic-ai/sdk` 0.90, `zod` 4, vanilla JS PWA.

**Spec:** `docs/superpowers/specs/2026-09-15-personal-trainer-design.md`

## Global Constraints

- ESM only (`"type": "module"`), no `__dirname`; derive paths from `import.meta.url`.
- Runtime deps: `@anthropic-ai/sdk`, `zod` only.
- Model id `claude-opus-5`, adaptive thinking default (omit `thinking`), `output_config.effort: "medium"` for food, `"high"` for the review.
- Time zone `Europe/Amsterdam` for all "today" and cron logic.
- Dates are `YYYY-MM-DD` strings everywhere in the API and DB.
- Every `/api` error is `{error: string}`.

---

### Task 1: Schedule (pure)

**Files:** Create `src/schedule.js`, `test/schedule.test.js`

**Interfaces:**
- Produces: `plannedDay(program, dateStr, settings) -> {dayKey, title, type, exercises} | null` (null = rest day). While `settings.holiday = {from, to}` covers `dateStr`, lift days return the program's `travel` day with `dayKey: 'T'`. `home` days are returned as-is (optional is a UI concern).
- Produces: `weekdayOf(dateStr) -> 1..7` (Monday = 1).
- Produces: `todayStr(now = new Date()) -> 'YYYY-MM-DD'` in Europe/Amsterdam.

- [ ] Write tests: Monday maps to A, Thursday to B, Saturday to R, Tuesday null, holiday Monday → T, `todayStr` formats Amsterdam date.
- [ ] Run: `node --test test/schedule.test.js` → fails (module missing).
- [ ] Implement with `Intl.DateTimeFormat('en-CA', {timeZone})` for `todayStr`, `new Date(dateStr + 'T12:00:00Z').getUTCDay()` mapped to 1..7 for weekday.
- [ ] Run tests → pass. Commit `feat: schedule module`.

### Task 2: Progression (pure)

**Files:** Create `src/progression.js`, `test/progression.test.js`

**Interfaces:**
- Produces: `nextState(exercise, state, sets) -> {weight, belowMinStreak, change}`; `exercise = {repMin, repMax, increment}`, `state = {weight, belowMinStreak}`, `sets = [{reps, weight}]`, `change ∈ 'up'|'hold'|'down'|'adopt'`.

Rules: no sets → hold. `state.weight == null` → adopt the heaviest logged weight, streak 0. All `reps >= repMax` → weight + increment, streak 0. Any `reps < repMin` → streak + 1; if streak reaches 2 → weight = roundToIncrement(weight × 0.9), streak 0, `down`. Else hold (streak reset to 0 when all sets >= repMin).

- [ ] Write tests for each rule. Run → fail. Implement. Run → pass. Commit `feat: progression rules`.

### Task 3: Database

**Files:** Create `src/db.js`, `test/db.test.js`

**Interfaces:**
- Produces: `openDb(path) -> db` (DatabaseSync with WAL + migrations applied, idempotent).
- Produces helpers on a `repo(db)` object: `getSetting(key, fallback)`, `setSetting(key, value)`, `activeProgram()`, `saveProgram(json)`, `exerciseState(id)`, `setExerciseState(id, weight, streak)`, `startSession({date, dayKey, type})`, `openSession(date)`, `logSet(sessionId, set)`, `finishSession(id, {feel, notes, distanceKm, durationMin})`, `sessionSets(id)`, `history(limit)`, `bests()`, `addCheckin`, `checkins(limit)`, `addFood`, `foodForDate(date)`, `addCoachNote`, `coachNotes(limit)`, `exportAll()`, `weekData(fromDate, toDate)`.

- [ ] Tests: opening twice is fine; start session + log 2 sets + finish → history returns it with sets; checkin upsert by date; food totals.
- [ ] Implement schema from spec with `CREATE TABLE IF NOT EXISTS`. Commit `feat: sqlite layer`.

### Task 4: Program seed and state

**Files:** Create `seed/program.json`, `src/program.js`, `test/program.test.js`

**Interfaces:**
- Produces: `ensureProgram(repo, seedPath) -> program` (seeds when no active program).
- Produces: `targetsFor(repo, day) -> exercises with {weight}` merged from `exercise_state` (fallback to program default weight).
- Produces: `applyProgression(repo, program, sessionId) -> [{exerciseId, change, weight}]`.

- [ ] Write `seed/program.json` exactly per spec (days A, B, R, H, T with exercises: id, name, sets, repMin, repMax, weight (null for barbell lifts), increment, restSec, cue).
- [ ] Tests: seeding twice keeps one active program; applyProgression bumps weight after a session where all sets hit repMax.
- [ ] Commit `feat: program seed and progression wiring`.

### Task 5: Coach (prompt builders + Claude)

**Files:** Create `src/coach.js`, `test/coach.test.js`

**Interfaces:**
- Produces: `buildFoodPrompt(text) -> string`, `buildReviewPrompt(week, program, settings) -> string` (pure).
- Produces: `makeCoach({client}) -> {estimateFood(text), weeklyReview(week, program, settings)}` using `client.messages.parse` with `zodOutputFormat`; `client == null` → both reject with `CoachUnavailable`.
- Schemas: `FoodEstimate = {items:[{name, kcal, proteinG}], kcal, proteinG, note}`; `Review = {summary, wins[], flags[], nextWeek[], nutrition}`.

- [ ] Tests: prompts contain session titles, set counts, food totals and targets; `makeCoach({client:null}).estimateFood` rejects with code `unavailable`; a fake client returning `parsed_output` round-trips.
- [ ] Commit `feat: coach prompts and claude client`.

### Task 6: Home Assistant + auth helpers

**Files:** Create `src/ha.js`, `src/auth.js`, `test/auth.test.js`

**Interfaces:**
- `makeAnnouncer({url, token, ttsEntity, mediaPlayer, fetchImpl}) -> announce(text)`; returns `{configured:false}` when url/token/ttsEntity missing; POSTs `/api/services/tts/speak` with `{entity_id: ttsEntity, media_player_entity_id: mediaPlayer, message: text}`.
- `makeAuth({password, secret}) -> {enabled, cookieFor(password) | null, verify(cookieHeader) -> bool}` using HMAC-SHA256.

- [ ] Tests for auth: disabled when no password; wrong password → null; cookie verifies. Commit `feat: ha announcer and auth`.

### Task 7: API + server

**Files:** Create `src/api.js`, `src/server.js`, `test/api.test.js`

**Interfaces:**
- `createApp({repo, program, coach, announce, auth, version}) -> handler(req, res)` implementing the route table in the spec.
- `startServer({port, dataDir, staticDir, coach, announce, auth}) -> {server, port, close()}`; `server.js` when run directly reads env: `PORT` (3000), `DATA_DIR`, `APP_PASSWORD`, `ANTHROPIC_API_KEY`, `HA_URL`, `HA_TOKEN`, `HA_TTS_ENTITY`, `HA_MEDIA_PLAYER`, `REVIEW_CRON` (default `0 18 * * 0` semantic: Sunday 18:00).

- [ ] Test flow with fetch against port 0: health → today (Monday 2026-10-05 → A) → start → log sets → finish → history has bests → checkin → food save/list → settings put → export contains everything → coach/review with stub → login flow when password set.
- [ ] Implement JSON body parsing with 1 MB cap, static serving with content types, cron tick every 60 s calling `runWeeklyReviewIfDue`.
- [ ] Commit `feat: http api and server`.

### Task 8: Frontend PWA

**Files:** Create `public/index.html`, `public/app.js`, `public/styles.css`, `public/manifest.webmanifest`, `public/sw.js`, `public/icon.svg`

- [ ] Build the five tabs per spec; rest timer with `speechSynthesis`; offline queue (`localStorage` key `trainer.queue`) replayed on load/online; settings sheet (voice, HA announce, targets, holiday).
- [ ] Manual check in a desktop browser at phone width; commit `feat: pwa frontend`.

### Task 9: Ops: CLI, deploy, export, calendar

**Files:** Create `src/cli.js`, `deploy/install-lxc.sh`, `deploy/update.sh`, `deploy/trainer.service`, `deploy/env.example`, `Dockerfile`, `scripts/export-to-folder.sh`, `scripts/com.trainer.export.plist`, `scripts/apple-calendar.sh`, `README.md`

- [ ] `cli.js seed` and `cli.js review` (runs weekly review against DATA_DIR).
- [ ] LXC installer: `pct create` Debian 12 template, `pct exec` to install Node 24 via NodeSource, copy app with `pct push` tarball, systemd unit, env file.
- [ ] README: run locally, deploy, add to iPhone home screen, env vars.
- [ ] Commit `feat: ops scripts and docs`.
