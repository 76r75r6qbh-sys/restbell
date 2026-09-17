#!/usr/bin/env bash
# Set (or clear) the app password without it appearing on screen or in shell history.
# Run on the Proxmox host in a real terminal: ssh -t root@<pve-host> 'CTID=210 bash /root/personal-trainer/deploy/set-password.sh'
set -euo pipefail
CTID="${CTID:-210}"
read -rsp "New app password (letters, digits and dashes; empty turns the password off): " PW; echo
read -rsp "Repeat: " PW2; echo
[ "$PW" = "$PW2" ] || { echo "Passwords differ, nothing changed."; exit 1; }
if [ -n "$PW" ] && ! [[ "$PW" =~ ^[A-Za-z0-9-]{12,}$ ]]; then
  echo "Use at least 12 letters, digits or dashes (systemd env files mangle quotes, spaces and \$)."; exit 1
fi
# The password travels over stdin so it never shows up in a process list.
printf '%s' "$PW" | pct exec "$CTID" -- node -e '
  const fs = require("fs");
  const file = "/etc/trainer.env";
  const pw = fs.readFileSync(0, "utf8");
  let env = fs.readFileSync(file, "utf8");
  env = /^APP_PASSWORD=/m.test(env) ? env.replace(/^APP_PASSWORD=.*$/m, () => `APP_PASSWORD=${pw}`) : `${env.trimEnd()}\nAPP_PASSWORD=${pw}\n`;
  fs.writeFileSync(file, env, { mode: 0o600 });
'
pct exec "$CTID" -- sh -c 'systemctl restart trainer && sleep 1 && systemctl is-active trainer'
[ -n "$PW" ] && echo "Password set. Sign in once on each device." || echo "Password turned off."
