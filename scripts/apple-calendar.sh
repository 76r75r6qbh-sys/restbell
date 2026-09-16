#!/usr/bin/env bash
# Create the weekly training events in Apple Calendar (calendar "Training", created if missing).
# Usage: scripts/apple-calendar.sh 2026-10-05   (the Monday the gym program starts)
set -euo pipefail
START="${1:?usage: apple-calendar.sh YYYY-MM-DD (first Monday)}"
CAL="${CAL:-Training}"
add() { # add <weekday-offset-from-monday> <HH:MM> <minutes> <title> <notes>
  local off="$1" time="$2" dur="$3" title="$4" notes="$5"
  local day; day="$(date -j -v+"${off}"d -f '%Y-%m-%d' "$START" '+%Y %m %d')"
  read -r y m d <<<"$day"
  local hh="${time%%:*}" mm="${time##*:}"
  osascript - "$CAL" "$y" "$m" "$d" "$hh" "$mm" "$dur" "$title" "$notes" <<'APPLESCRIPT'
on run argv
  set calName to item 1 of argv
  set startDate to current date
  set year of startDate to (item 2 of argv) as integer
  set month of startDate to (item 3 of argv) as integer
  set day of startDate to (item 4 of argv) as integer
  set hours of startDate to (item 5 of argv) as integer
  set minutes of startDate to (item 6 of argv) as integer
  set seconds of startDate to 0
  set durMin to (item 7 of argv) as integer
  set theTitle to item 8 of argv
  set theNotes to item 9 of argv
  tell application "Calendar"
    if not (exists calendar calName) then make new calendar with properties {name:calName}
    tell calendar calName
      set ev to make new event with properties {summary:theTitle, start date:startDate, end date:startDate + durMin * minutes, description:theNotes}
      tell ev
        make new display alarm at end with properties {trigger interval:-30}
      end tell
      set recurrence of ev to "FREQ=WEEKLY;INTERVAL=1"
    end tell
  end tell
  return (startDate as text)
end run
APPLESCRIPT
}
add 0 "07:30" 75 "🏋️ Lift A · full body" "Squat, bench, cable row, RDL, knee raise. Open Trainer for targets."
add 3 "07:30" 75 "🏋️ Lift B · full body" "Deadlift, overhead press, lat pulldown, leg press, cable crunch."
add 5 "09:00" 60 "🏃 Easy run · 5–7 km" "Conversational pace. Log km and minutes in Trainer."
