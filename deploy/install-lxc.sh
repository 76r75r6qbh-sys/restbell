#!/usr/bin/env bash
# Create a Debian 12 LXC on a Proxmox host and install Trainer into it.
# Run ON THE PROXMOX HOST as root, from a copy of this repository:
#   bash deploy/install-lxc.sh
# Tunables (env): CTID=210 HOSTNAME=trainer STORAGE=local-lvm BRIDGE=vmbr0 MEMORY=512 DISK=4 IP=dhcp
set -euo pipefail

CTID="${CTID:-210}"
HOSTNAME="${HOSTNAME:-trainer}"
STORAGE="${STORAGE:-local-lvm}"
TEMPLATE_STORAGE="${TEMPLATE_STORAGE:-local}"
BRIDGE="${BRIDGE:-vmbr0}"
MEMORY="${MEMORY:-512}"
DISK="${DISK:-4}"
IP="${IP:-dhcp}"            # e.g. 192.168.2.210/24
GATEWAY="${GATEWAY:-}"      # required when IP is static, e.g. 192.168.2.1
APP_SRC="$(cd "$(dirname "$0")/.." && pwd)"

echo "== Template"
pveam update >/dev/null
TEMPLATE="$(pveam available --section system | awk '/debian-12-standard/ {print $2}' | sort -V | tail -1)"
[ -n "$TEMPLATE" ] || { echo "no debian-12 template available"; exit 1; }
pveam list "$TEMPLATE_STORAGE" | grep -q "$TEMPLATE" || pveam download "$TEMPLATE_STORAGE" "$TEMPLATE"

if pct status "$CTID" >/dev/null 2>&1; then
  echo "== CT $CTID exists, reusing"
else
  echo "== Creating CT $CTID ($HOSTNAME)"
  NET="name=eth0,bridge=${BRIDGE},ip=${IP}"
  [ -n "$GATEWAY" ] && NET="${NET},gw=${GATEWAY}"
  pct create "$CTID" "${TEMPLATE_STORAGE}:vztmpl/${TEMPLATE}" \
    --hostname "$HOSTNAME" --unprivileged 1 --features nesting=1 \
    --memory "$MEMORY" --swap 256 --cores 1 --rootfs "${STORAGE}:${DISK}" \
    --net0 "$NET" --onboot 1 --start 1 --tags trainer
  sleep 5
fi
pct status "$CTID" | grep -q running || pct start "$CTID"

echo "== Installing Node 24 and the app"
pct exec "$CTID" -- bash -c '
  set -e
  export DEBIAN_FRONTEND=noninteractive
  apt-get update -qq
  apt-get install -y -qq curl ca-certificates gnupg rsync >/dev/null
  if ! command -v node >/dev/null || [ "$(node -v | cut -c2-3)" -lt 24 ]; then
    curl -fsSL https://deb.nodesource.com/setup_24.x | bash - >/dev/null
    apt-get install -y -qq nodejs >/dev/null
  fi
  command -v claude >/dev/null || npm install -g @anthropic-ai/claude-code >/dev/null 2>&1 || echo "claude-code install failed (subscription coach backend unavailable)"
  id trainer >/dev/null 2>&1 || useradd --system --home /var/lib/trainer --shell /usr/sbin/nologin trainer
  mkdir -p /opt/trainer /var/lib/trainer
'

echo "== Copying app files"
TAR="$(mktemp /tmp/trainer.XXXXXX.tar)"
tar -C "$APP_SRC" --exclude=node_modules --exclude=data --exclude=.git --exclude='*.db*' -cf "$TAR" .
pct push "$CTID" "$TAR" /tmp/trainer.tar
rm -f "$TAR"
pct exec "$CTID" -- bash -c '
  set -e
  rm -rf /opt/trainer/src /opt/trainer/public /opt/trainer/seed
  tar -C /opt/trainer -xf /tmp/trainer.tar && rm /tmp/trainer.tar
  cd /opt/trainer && npm ci --omit=dev --no-audit --no-fund >/dev/null
  chown -R trainer:trainer /opt/trainer /var/lib/trainer
  [ -f /etc/trainer.env ] || cp deploy/env.example /etc/trainer.env
  chmod 600 /etc/trainer.env
  cp deploy/trainer.service /etc/systemd/system/trainer.service
  systemctl daemon-reload
  systemctl enable --now trainer
  systemctl restart trainer
  sleep 2
  systemctl --no-pager --lines=5 status trainer || true
'
CT_IP="$(pct exec "$CTID" -- hostname -I | awk '{print $1}')"
echo
echo "Trainer is running at http://${CT_IP}:3000"
echo "Edit /etc/trainer.env inside the CT (pct enter $CTID) to add the API key or a password, then: systemctl restart trainer"
