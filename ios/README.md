# Restbell for iPhone

A native SwiftUI companion to the Restbell server. Runs on iOS 18 and later, and picks up Liquid Glass on iOS 26.

- **Today:** calories and protein rings, Activity rings, a recovery score from HRV, resting HR and sleep, today's session, week progress and streak, and the last Watch workout with its heart-rate zones.
- **Guided session:** one set at a time with steppers prefilled from the plan and from last time. Includes a rest timer that alerts you with the phone locked, offline queuing, and a debrief from the coach when you finish.
- **Live Activity:** the current set and rest countdown show on the Lock Screen and in the Dynamic Island. Buttons there log the set as prescribed, add 30 s of rest, or skip rest.
- **Food:** describe a meal and the coach estimates it. Favorites and recent meals log in one tap. Also shows today's energy balance.
- **Coach:** a chat with your coach, the weekly notes, and proposals to apply or dismiss. Unread messages show as a badge.
- **Widgets:**
  - Home Screen: small, medium and large. Medium and large have one-tap favorite buttons.
  - Lock Screen: protein, next session and recovery.
  - A **Log Food** control for Control Center, the Lock Screen and the Action Button.
- **Quick actions:** long-press the icon for "Log food", your two top favorites, and "Start session".
- **Siri and Shortcuts:** "Log food", "Log *favorite*", "Start my workout", "Log my weight" and "Sync Apple Health".
- **Apple Health:** imports these automatically:
  - workouts, with heart rate, effort, 1-minute HR recovery, elevation, km splits and running form
  - Activity rings, steps, active and resting energy, exercise minutes
  - resting HR, HRV, respiratory rate, blood oxygen, VO2 max, cardio recovery
  - sleep stages and wrist temperature
  - weight and body fat

  Optionally, it writes strength sessions and meals back to Health.
- **Trends:** sleep, HRV and resting HR against your usual range, VO2 max, steps, energy balance, bodyweight and run pace over 1 week, 1 month or 6 months.

## What you need

- A Mac with Xcode 16 or later. Xcode 26 adds the Liquid Glass look.
- [XcodeGen](https://github.com/yonaskolb/XcodeGen): `brew install xcodegen`.
- An Apple ID signed in to Xcode. A **free account works** for your own phone, with these limits:
  - The app stops opening after **7 days**. Connect the phone and press Run again, or refresh it with SideStore or AltStore.
  - There is **no push (APNs)**. Coach messages and reminders arrive through Home Assistant or ntfy instead (see below).
- Your Restbell server updated to this version, reachable from the phone. HTTPS through the Cloudflare Tunnel works best; plain http on the LAN or Tailscale also works.

## Build and install

```bash
cd ios
cp Config/Local.example.xcconfig Config/Local.xcconfig   # then edit it
xcodegen generate
open Restbell.xcodeproj
```

1. In `Config/Local.xcconfig`, set:
   - `RESTBELL_TEAM`: your team ID, shown in Xcode → Settings → Accounts.
   - `BUNDLE_ID_PREFIX`: something unique, e.g. `com.yourname`.
2. Connect the iPhone, choose it as the run destination, and press **Run** (⌘R).
3. The first time, on the phone, go to Settings → General → VPN & Device Management and trust your developer certificate.

### Step 0: check the capabilities

Xcode shows a signing error if your account can't use a capability. If it does:

| Error mentions | What to do | What you lose |
|---|---|---|
| `healthkit.background-delivery` | Delete that line in `project.yml`, run `xcodegen generate` | Instant import after a Watch workout. The Shortcuts automation below covers it. |
| `application-groups` | Delete the app group lines in `project.yml` | Widgets can't share the app's cache, so they fetch on their own |
| `keychain-access-groups` | Delete those lines | Widgets and Siri can only work if your server has no password |

## Sign in

Open the app and enter the server address and the server password (if `APP_PASSWORD` is set). The app stores a token in the Keychain; the password itself is not kept. **Try with demo data** shows the whole app with sample data, without a server.

## Notifications without a paid account

A free account can't receive pushes from the server directly, so the server sends them through an app that can:

- **Home Assistant Companion** (you already run Home Assistant). In `/etc/trainer.env`, set `HA_NOTIFY_SERVICE=mobile_app_<your_phone>`; `HA_URL` and `HA_TOKEN` are already there. Tapping a notification opens Restbell on the right screen.
- **ntfy:** install the ntfy app, subscribe to a long random topic, and set `NTFY_URL=https://ntfy.sh/<topic>`.

Then `systemctl restart trainer`. The coach's chat replies, the Sunday review, the post-session debrief and the daily "nothing logged" reminder (20:30 by default, set in More → Targets & Notifications) all come through that channel.

Without either channel, set **More → Targets & Notifications → Delivered by** to *This iPhone*. The app then checks in the background and posts the notifications itself. This is best effort, because iOS decides when the app may run.

The rest-timer alert always comes from the phone itself, and works on any account.

## Apple Health sync

Tap **Connect** on Today, or open More → Apple Health, and allow access. From then on the import runs by itself from several triggers, so it keeps working when one of them doesn't fire:

1. **HealthKit background delivery:** right after the Watch saves a workout, and hourly for sleep, HRV, resting HR, weight and activity.
2. **Background refresh:** about every hour, whenever iOS allows it.
3. **Nightly reconcile:** around 04:00 while charging, re-sending the last 30 days.
4. **Shortcuts automation:** the most reliable trigger on a free account. In Shortcuts → Automation → New:
   - **Apple Watch Workout → When Ends → Run Immediately** → action *Sync Apple Health* (Restbell).
   - **Time of Day**, for example 07:00, 13:00, 19:00 and 23:00 → *Run Immediately* → *Sync Apple Health*.
5. **Opening the app and pulling to refresh** on Today.

More → Apple Health shows each sync, which trigger ran it, and what it sent. If nothing has arrived for 24 hours, Today shows a warning and the coach is told the data is missing, so a gap isn't read as skipped training.

The old "post workout" Shortcut in the main README isn't needed any more. Remove its automation so workouts aren't sent twice. Duplicates are merged on the server, but there's no reason to send them.

## Widgets, quick actions and Siri

- **Home Screen widgets:** long-press the Home Screen → Edit → Add Widget → Restbell. The medium and large widgets have favorite buttons that log without opening the app.
- **Lock Screen widgets:** long-press the Lock Screen → Customize → add *Protein*, *Today's session* or *Recovery*.
- **Control Center and Action Button:** add *Log Food* from the controls gallery, or assign it to the Action Button.
- **Quick actions:** long-press the app icon.
- **Siri:** say "Log a protein shake in Restbell" (any favorite name) or "Start my workout in Restbell".

## Checklist on the phone

1. Check the capabilities in Step 0, then sign in.
2. Send the coach a chat message, lock the phone, and get the reply as a notification. Tap it: the app opens in the chat.
3. Set the reminder a few minutes ahead on a day with nothing logged, and get the reminder.
4. Start today's session and log a set. On the Lock Screen and in the Dynamic Island, try **Log**, **+30 s** and **Skip**. Wait out a rest with the phone locked and get the alert.
5. Add the medium widget and tap a favorite. The numbers update.
6. Long-press the app icon and try a quick action.
7. Record a short Watch workout. Within a few minutes it shows in More → History with heart-rate zones, plus splits and effort for runs.
8. Leave the phone overnight without opening the app. In the morning, Today shows last night's sleep and the recovery score, and More → Apple Health lists which triggers ran.
9. Run the *Sync Apple Health* Shortcut by hand once.

## Layout

- `project.yml`: XcodeGen spec (the `.xcodeproj` is generated, not committed).
- `RestbellKit/`: Swift package shared by the app and the widgets. It holds the API client, models, guide order (the same rules as `public/guide.js`), Health math, the offline queue and the demo server. Run `swift test` here; it also runs on Linux.
- `Shared/`: SwiftUI pieces and App Intents compiled into both the app and the widget extension.
- `Restbell/`: the app, with its screens, guided session, `HealthSync`, notifications, background tasks, quick actions and Shortcuts.
- `RestbellWidgets/`: widgets, the Live Activity, and the Control Center control.
- `scripts/screenshots.sh`: simulator screenshots in demo mode. CI runs it and uploads the images.

## CI

`.github/workflows/ios.yml` runs on every change under `ios/`:

- the RestbellKit tests on Linux and macOS
- a simulator build of the app and widgets without signing
- screenshots of the main screens in light, dark and large accessibility text sizes, uploaded as the `screenshots` artifact

On a private repository, macOS runner minutes count ten times against the Actions allowance.
