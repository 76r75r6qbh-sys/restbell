# Restbell

Restbell is a self-hosted training companion for one athlete: today's session with targets, set logging with
rest timers and voice cues, runs, weekly weigh-ins, food tracking with a Claude
estimator, Apple Watch workout import with heart-rate zones, a coach you can chat with,
and a weekly coach note. One Node process, one SQLite file, no build step.
A native iOS companion app (widgets, Live Activity, automatic Apple Health sync) lives in [`ios/`](ios/README.md).

## Run locally

```bash
npm install
npm start            # http://localhost:3000, data in ./data
npm test
```

Environment variables (all optional): see `deploy/env.example`.

| Variable | Effect |
|---|---|
| `PORT`, `HOST` | Listen address (default 3000 on all interfaces) |
| `DATA_DIR` | Folder for `trainer.db` |
| `APP_PASSWORD` | Turns on the login screen |
| `CLAUDE_CODE_OAUTH_TOKEN` | Claude subscription token from `claude setup-token`; enables the food estimator and the Sunday 18:00 coach review through the Claude Code CLI |
| `ANTHROPIC_API_KEY` | Same features through the API instead of the subscription |
| `COACH_MODEL_FOOD`, `COACH_MODEL_REVIEW`, `COACH_MODEL_CHAT` | CLI backend models (default `sonnet` / `opus` / `sonnet`) |
| `HA_URL`, `HA_TOKEN`, `HA_TTS_ENTITY`, `HA_MEDIA_PLAYER` | Speaks rest-timer cues on a Home Assistant speaker |
| `HA_NOTIFY_SERVICE` | Pushes coach messages and the daily reminder through the Home Assistant Companion app (e.g. `mobile_app_iphone`) |
| `NTFY_URL`, `NTFY_TOKEN` | Same, through an ntfy topic |
| `NOTIFY_LINK_BASE` | What a tapped notification opens (default `restbell://`, the iOS app) |

## Deploy as a Proxmox LXC

On the Proxmox host, with a copy of this repo:

```bash
CTID=210 IP=192.168.2.210/24 GATEWAY=192.168.2.1 bash deploy/install-lxc.sh
```

Creates an unprivileged Debian 12 container, installs Node 24, the app under
`/opt/trainer`, data under `/var/lib/trainer`, and a systemd service. Then
`pct enter 210`, edit `/etc/trainer.env`, `systemctl restart trainer`.
Later updates: `CTID=210 bash deploy/update.sh`.

Docker alternative: `docker build -t trainer . && docker run -p 3000:3000 -v trainer-data:/data trainer`.

## iPhone

Open the URL in Safari, Share → **Add to Home Screen**. Plain HTTP on the LAN
or Tailscale works, but HTTPS is better: the screen only reliably stays on
during a session (Wake Lock API) and the offline shell only installs in a
secure context. Set logging is queued on the phone when there is no connection
and synced later.

### HTTPS through a Cloudflare Tunnel

1. Set a password first, from a real terminal on the Proxmox host:
   `CTID=210 bash deploy/set-password.sh` (input is hidden).
2. Add a public hostname on the tunnel pointing to `http://<container-ip>:3000`
   and give the container a fixed IP or DHCP reservation.
3. Re-add the home-screen icon from the HTTPS address.

Behind the tunnel the login cookie is marked `Secure`, and a client is locked
out for 15 minutes after 10 wrong passwords (keyed on `CF-Connecting-IP`).

## Coach with a Claude subscription (no API key)

On a machine where Claude Code is logged in, run `claude setup-token` and copy
the token. In the container: `pct enter 115`, put it in `/etc/trainer.env` as
`CLAUDE_CODE_OAUTH_TOKEN=...`, then `systemctl restart trainer`. The app then
runs `claude -p --json-schema ...` for food estimates (about 10 s) and the
weekly review. Never commit the token.

## Coach chat and notifications

The Coach tab has a chat: the coach answers with your program, this week's logs,
Watch metrics and the latest weekly note in mind. Replies, the Sunday review and
a short debrief after each session are pushed to your phone when
`HA_NOTIFY_SERVICE` (Home Assistant Companion app) or `NTFY_URL` is set. The
same channel sends a reminder at 20:30 (Settings) on days nothing was logged.

## Apple Watch data

The iOS app imports workouts and daily metrics (rings, steps, energy, resting
HR, HRV, VO2 max, sleep stages, wrist temperature, weight) by itself; see
[`ios/README.md`](ios/README.md). Without the app, a Shortcut can post each workout:

1. Shortcuts → new shortcut, add **Find Workouts** (Sort by Start Date, Limit 1).
2. Add **Find Health Samples**: Type Heart Rate, Start Date is after *Workout Start Date*, End Date is before *Workout End Date*.
3. Add **Repeat with Each** sample → **Dictionary** `{ "t": Start Date (ISO 8601), "hr": Value }` → add to a list.
4. Add **Dictionary** `{ "type": Workout Type, "start": Start Date (ISO 8601), "end": End Date (ISO 8601), "distanceKm": Distance (km), "kcal": Active Energy, "samples": <list> }`.
5. Add **Get Contents of URL**: `POST http://<trainer>/api/workouts`, Request Body JSON = the dictionary.
6. Automation: *When a workout ends* → run the shortcut.

The endpoint also accepts the JSON that the Health Auto Export app sends
(`{"data":{"workouts":[...]}}`); field mapping is best-effort. Zones use the
max heart rate in Settings (default 220 − age).

## Athlete profile

Settings → "About you" holds a free-text profile (age, height, weight, goals,
training history, region for portion sizes). It is sent with every food estimate
and weekly review, and it lives only in your database.

## Coaching from Claude Code

Everything is readable and editable over HTTP: `GET /api/export`,
`GET/PUT /api/program`, `PUT /api/settings`, `POST /api/coach/review`,
`GET/POST /api/chat`, `GET /api/summary`, `GET/PUT /api/metrics`, `GET /api/recovery`.
API clients that can't keep a cookie send the token from `POST /api/login` as
`Authorization: Bearer <token>`.
`scripts/export-to-folder.sh` copies an export and the coach notes to a local
folder (for example one synced to a NAS); `scripts/com.trainer.export.plist` runs
it weekly via launchd on macOS. `scripts/apple-calendar.sh <first-monday>` adds the three
weekly sessions to Apple Calendar.

## Layout

- `src/schedule.js` — which session a date gets; holiday handling
- `src/progression.js` — double-progression rules (deterministic)
- `src/hr.js` — heart-rate zone analysis
- `src/db.js` — SQLite schema and repository
- `src/program.js` — program seed, targets, progression wiring
- `src/coach.js` — prompts and Claude calls (review, food, chat)
- `src/notify.js` — pushes through Home Assistant or ntfy
- `src/metrics.js`, `src/recovery.js` — Watch metrics and the recovery score
- `src/api.js`, `src/server.js` — HTTP API, static files, Sunday cron
- `public/` — the PWA
- `ios/` — the native iOS companion app
- `docs/superpowers/` — design spec and plan
