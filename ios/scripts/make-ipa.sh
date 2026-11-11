#!/usr/bin/env bash
# Builds Restbell.ipa for sideloading with AltStore (or Sideloadly): a Release build for devices,
# ad-hoc signed with the app's and the widget extension's entitlements so the installer knows which
# capabilities to request when it re-signs with your Apple ID.
# Run from ios/ after `xcodegen generate`. Usage: scripts/make-ipa.sh [out-dir]
# BUNDLE_ID_PREFIX (default com.example) sets the bundle IDs; AltStore adds your team ID to them anyway.
set -euo pipefail
OUT=${1:-build/ipa}
PREFIX=${BUNDLE_ID_PREFIX:-com.example}
GROUP="group.$PREFIX.restbell"
mkdir -p build

xcodebuild -project Restbell.xcodeproj -scheme Restbell -configuration Release \
  -sdk iphoneos -destination 'generic/platform=iOS' -derivedDataPath build/device \
  BUNDLE_ID_PREFIX="$PREFIX" CODE_SIGNING_ALLOWED=NO build 2>&1 | tee build/device.log | grep -E "error:|\*\* BUILD" || true
grep -q "BUILD SUCCEEDED" build/device.log

APP=build/device/Build/Products/Release-iphoneos/Restbell.app
WIDGETS="$APP/PlugIns/RestbellWidgets.appex"
test -d "$WIDGETS"

# Entitlements as XcodeGen wrote them, with the build variables filled in. Keychain sharing is left out:
# its team-prefixed group can't survive re-signing, and the app falls back to the App Group (Credentials.swift).
mkdir -p build/entitlements
for target in Restbell RestbellWidgets; do
  plist="build/entitlements/$target.plist"
  sed -e "s/\$(APP_GROUP)/$GROUP/g" "$target/$target.entitlements" > "$plist"
  /usr/libexec/PlistBuddy -c "Delete :keychain-access-groups" "$plist" 2>/dev/null || true
done

# Inside out: the extension first, then the app that contains it.
codesign --force --sign - --timestamp=none --entitlements build/entitlements/RestbellWidgets.plist "$WIDGETS"
codesign --force --sign - --timestamp=none --entitlements build/entitlements/Restbell.plist "$APP"
echo "== App entitlements"; codesign -d --entitlements :- "$APP" 2>/dev/null
echo "== Widget entitlements"; codesign -d --entitlements :- "$WIDGETS" 2>/dev/null

rm -rf "$OUT"
mkdir -p "$OUT/Payload"
cp -R "$APP" "$OUT/Payload/"
(cd "$OUT" && zip -qry Restbell.ipa Payload && rm -rf Payload)
echo "Wrote $OUT/Restbell.ipa ($(du -h "$OUT/Restbell.ipa" | cut -f1))"
