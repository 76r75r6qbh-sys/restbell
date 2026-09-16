#!/usr/bin/env bash
# Install a Claude subscription token in the trainer container and restart the service.
# Run on your workstation:  PVE=root@proxmox-host CTID=115 TRAINER_HOST=trainer-ip bash scripts/set-coach-token.sh
# Get the token first with:    claude setup-token
set -euo pipefail
PVE="${PVE:?set PVE=root@<proxmox host>}"
CTID="${CTID:-115}"
read -r -s -p "Paste the token from 'claude setup-token' (input hidden): " TOKEN; echo
[ -n "$TOKEN" ] || { echo "no token given"; exit 1; }
printf '%s' "$TOKEN" | ssh "$PVE" "export LC_ALL=C; T=\$(cat); pct exec $CTID -- bash -c '
  set -e
  f=/etc/trainer.env
  grep -q \"^CLAUDE_CODE_OAUTH_TOKEN=\" \$f || echo \"CLAUDE_CODE_OAUTH_TOKEN=\" >> \$f
  grep -q \"^DISABLE_AUTOUPDATER=\" \$f || echo \"DISABLE_AUTOUPDATER=1\" >> \$f
  sed -i \"s|^CLAUDE_CODE_OAUTH_TOKEN=.*|CLAUDE_CODE_OAUTH_TOKEN='\"\$T\"'|\" \$f
  chmod 600 \$f
  systemctl restart trainer
' 2>/dev/null"
sleep 2
HEALTH="$(curl -fsS "http://${TRAINER_HOST:?set TRAINER_HOST=<container ip>}:3000/api/health")"
echo "$HEALTH"
echo "$HEALTH" | grep -q '"coach":true' && echo "Coach is on. Try the Food tab." || echo "Coach still off: check /etc/trainer.env in the container."
