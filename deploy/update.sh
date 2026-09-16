#!/usr/bin/env bash
# Push the current working tree into the running CT and restart. Run on the Proxmox host: CTID=210 bash deploy/update.sh
set -euo pipefail
CTID="${CTID:-210}"
APP_SRC="$(cd "$(dirname "$0")/.." && pwd)"
TAR="$(mktemp /tmp/trainer.XXXXXX.tar)"
tar -C "$APP_SRC" --exclude=node_modules --exclude=data --exclude=.git --exclude='*.db*' -cf "$TAR" .
pct push "$CTID" "$TAR" /tmp/trainer.tar
rm -f "$TAR"
pct exec "$CTID" -- bash -c '
  set -e
  rm -rf /opt/trainer/src /opt/trainer/public /opt/trainer/seed
  tar -C /opt/trainer -xf /tmp/trainer.tar && rm /tmp/trainer.tar
  command -v claude >/dev/null || npm install -g @anthropic-ai/claude-code >/dev/null 2>&1 || true
  cd /opt/trainer && npm ci --omit=dev --no-audit --no-fund >/dev/null
  chown -R trainer:trainer /opt/trainer
  cp deploy/trainer.service /etc/systemd/system/trainer.service && systemctl daemon-reload
  systemctl restart trainer && sleep 1 && systemctl is-active trainer
'
