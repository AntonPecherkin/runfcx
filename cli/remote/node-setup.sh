#!/usr/bin/env bash
# Runs on the server as root. Installs and starts the upstream read node. Safe to re-run.
set -euo pipefail
TAG=v0.14.3
SHA=cdeb51daf31ac01f25b4be3857eeec41e2e4685ca6e77e5f52959cb8065f553a
KEEP="${1:-no}"      # yes = persistent: keep upstream auto-upgrade cron
HOST_DIR="${2:-}"    # host mode: data dir chosen by the user

cloud-init status --wait >/dev/null 2>&1 || true
command -v jq >/dev/null || { apt-get update -qq && apt-get install -y -qq jq curl; }

if [[ ! -e /mnt/fcx && -n "$HOST_DIR" && "$HOST_DIR" != /mnt/fcx ]]; then
  mkdir -p "$HOST_DIR" && ln -s "$HOST_DIR" /mnt/fcx
fi
if [[ ! -e /mnt/fcx ]]; then
  vol=$(find /mnt -maxdepth 1 -name 'HC_Volume_*' | head -1)
  if [[ -n "$vol" ]]; then ln -s "$vol" /mnt/fcx; else mkdir -p /mnt/fcx; fi
fi
mkdir -p /mnt/fcx/snapchain
[[ -e /root/snapchain ]] || ln -s /mnt/fcx/snapchain /root/snapchain
cd /root/snapchain

if docker ps --format '{{.Names}}' 2>/dev/null | grep -q snapchain; then echo "Node already running."; exit 0; fi

curl -fsSL "https://raw.githubusercontent.com/farcasterxyz/snapchain/$TAG/scripts/snapchain.sh" -o snapchain.sh
echo "$SHA  snapchain.sh" | sha256sum -c --quiet || { echo "snapchain.sh checksum mismatch"; exit 1; }
chmod +x snapchain.sh

touch .env
add() { grep -q "^$1=" .env || echo "$1=$2" >> .env; }
add AGREE_NO_REWARDS_FOR_ME true
add HUB_OPERATOR_FID 0
add SKIP_SELF_UPGRADE true
[[ "$KEEP" == yes ]] || add SKIP_CRONTAB true
cp /opt/fcx/docker-compose.override.yml ./docker-compose.override.yml

# upstream "upgrade" ends with `logs -f`; run it detached and wait for its success line
nohup ./snapchain.sh upgrade </dev/null > install.log 2>&1 &
for _ in $(seq 1 180); do
  grep -q "Upgrade complete" install.log && { echo "Node started."; exit 0; }
  grep -qE "❌|checksum mismatch" install.log && { tail -20 install.log; exit 1; }
  sleep 5
done
echo "Install did not finish in 15 min. Last lines:"; tail -20 install.log; exit 1
