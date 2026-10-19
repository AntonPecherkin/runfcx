#!/usr/bin/env bash
# Runs on the server as root. Installs and starts the upstream read node. Safe to re-run.
set -euo pipefail
TAG=v0.14.3
SHA=cdeb51daf31ac01f25b4be3857eeec41e2e4685ca6e77e5f52959cb8065f553a
KEEP="${1:-no}"      # yes = persistent: keep upstream auto-upgrade cron
DATA_DIR="${2:-/mnt/fcx}"
MODE="${3:-hetzner}" # hetzner: data must live on the attached volume
# shellcheck source=/dev/null
source /opt/fcx/lib.sh

cloud-init status --wait >/dev/null 2>&1 || true
command -v jq >/dev/null || { apt-get update -qq && apt-get install -y -qq jq curl; }

if [[ ! -e /mnt/fcx ]]; then
  if [[ "$MODE" == hetzner ]]; then
    # never fall back to the small root disk: the snapshot would fill it hours later
    vol=$(find_volume /mnt 24 5) || { echo "The 2 TB volume is not mounted. Run: fcx destroy, then fcx provision again."; exit 1; }
    ln -s "$vol" /mnt/fcx
  elif [[ "$DATA_DIR" != /mnt/fcx ]]; then
    mkdir -p "$DATA_DIR" && ln -s "$DATA_DIR" /mnt/fcx
  else
    mkdir -p /mnt/fcx
  fi
fi
mkdir -p /mnt/fcx/snapchain
[[ -e /root/snapchain ]] || ln -s /mnt/fcx/snapchain /root/snapchain
cd /root/snapchain

if docker ps --format '{{.Names}}' 2>/dev/null | grep -q snapchain; then echo "Node already running."; exit 0; fi
if install_running; then echo "Install already in progress."; exit 0; fi

curl -fsSL "https://raw.githubusercontent.com/farcasterxyz/snapchain/$TAG/scripts/snapchain.sh" -o snapchain.sh
echo "$SHA  snapchain.sh" | sha256sum -c --quiet || { echo "snapchain.sh checksum mismatch"; exit 1; }
chmod +x snapchain.sh

touch .env
add() { grep -q "^$1=" .env || echo "$1=$2" >> .env; }
add AGREE_NO_REWARDS_FOR_ME true
add HUB_OPERATOR_FID 0
add SKIP_SELF_UPGRADE true
# Upstream can only schedule auto-upgrades once the node has a peer ID, so we always skip its
# cron on install and add the same schedule ourselves after the node starts (keep mode).
add SKIP_CRONTAB true
open_gossip_port
cp /opt/fcx/docker-compose.override.yml ./docker-compose.override.yml

# upstream "upgrade" ends with `logs -f`; run it detached and wait for its success line
nohup ./snapchain.sh upgrade </dev/null > install.log 2>&1 &
sleep 2
wait_upgrade install.log 180 5 || exit 1
[[ "$KEEP" == yes ]] && cron_line /root/snapchain "$(hostname)" > /etc/cron.d/fcx-autoupgrade
echo "Node started."
