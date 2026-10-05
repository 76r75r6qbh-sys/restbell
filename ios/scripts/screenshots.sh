#!/usr/bin/env bash
# Screenshots of the main screens with demo data, in light and dark and at a large accessibility text size.
# Usage: scripts/screenshots.sh <simulator-udid> <path/to/Restbell.app> <out-dir>
set -euo pipefail
UDID=$1
APP=$2
OUT=$3
mkdir -p "$OUT"
BUNDLE=$(/usr/libexec/PlistBuddy -c "Print CFBundleIdentifier" "$APP/Info.plist")

xcrun simctl boot "$UDID" 2>/dev/null || true
xcrun simctl bootstatus "$UDID" -b
xcrun simctl status_bar "$UDID" override --time "9:41" --batteryState charged --batteryLevel 100 --cellularBars 4 || true
xcrun simctl install "$UDID" "$APP"

shot() { # name, appearance, content size, launch args...
  local name=$1 appearance=$2 size=$3
  shift 3
  xcrun simctl ui "$UDID" appearance "$appearance"
  xcrun simctl ui "$UDID" content_size "$size"
  xcrun simctl terminate "$UDID" "$BUNDLE" 2>/dev/null || true
  xcrun simctl launch "$UDID" "$BUNDLE" -demo "$@" >/dev/null
  sleep 6
  xcrun simctl io "$UDID" screenshot "$OUT/$name.png" >/dev/null
  echo "captured $name"
}

for appearance in light dark; do
  shot "today-$appearance" "$appearance" large -tab today
  shot "food-$appearance" "$appearance" large -tab food
  shot "coach-$appearance" "$appearance" large -tab coach
  shot "more-$appearance" "$appearance" large -tab more
  shot "session-$appearance" "$appearance" large -screen session
  shot "logfood-$appearance" "$appearance" large -screen logFood
done
shot "today-xxl" light accessibility-extra-large -tab today
shot "session-xxl" light accessibility-extra-large -screen session
xcrun simctl ui "$UDID" content_size large
