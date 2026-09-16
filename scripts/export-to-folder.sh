#!/usr/bin/env bash
# Pull a full export and the coach notes from the Trainer server into a local folder (e.g. one synced to a NAS).
# Usage: TRAINER_URL=http://trainer-host:3000 DEST=~/Training scripts/export-to-folder.sh
set -euo pipefail
TRAINER_URL="${TRAINER_URL:-http://localhost:3000}"
DEST="${DEST:-$HOME/Training}"
COOKIE="${TRAINER_COOKIE:-}"   # "trainer_auth=..." when a password is set
mkdir -p "$DEST/exports"
STAMP="$(date +%Y-%m-%d)"
curl -fsS ${COOKIE:+-H "Cookie: $COOKIE"} "$TRAINER_URL/api/export" -o "$DEST/exports/trainer-$STAMP.json"
curl -fsS ${COOKIE:+-H "Cookie: $COOKIE"} "$TRAINER_URL/api/coach" | python3 -c '
import json, sys
notes = json.load(sys.stdin)["notes"]
out = ["# Coach notes", ""]
for n in notes:
    out += ["## Week of " + n["weekStart"], "", n["text"], ""]
print("\n".join(out))
' > "$DEST/coach-notes.md"
echo "exported to $DEST/exports/trainer-$STAMP.json"
