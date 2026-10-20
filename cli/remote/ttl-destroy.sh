#!/usr/bin/env bash
# Runs from cron on the server. After the deadline, deletes this run's Hetzner resources.
# The server is deleted last, and only when its volumes are gone, so cron can retry.
set -euo pipefail
ETC="${FCX_ETC:-/etc/fcx}"
API="${HCLOUD_API:-https://api.hetzner.cloud/v1}"
# shellcheck source=/dev/null
source "${FCX_LIB:-/opt/fcx/lib.sh}"

now="${FCX_NOW:-$(date +%s)}"
deadline=$(cat "$ETC/deadline"); name=$(cat "$ETC/name")
case "$(ttl_state "$deadline" "$now")" in
  none|ok) exit 0 ;;
  warn) msg="fcx: auto-destroy in $(( (deadline - now) / 60 )) min. Extend with: runfcx extend 4h"
        echo "$msg"; wall "$msg" 2>/dev/null || true; exit 0 ;;
esac
[[ -s "$ETC/token" ]] || { echo "fcx: deadline passed but no token installed. Run runfcx destroy from your laptop."; exit 1; }

auth=(-H "Authorization: Bearer $(cat "$ETC/token")" -H "Content-Type: application/json")
api() { curl -fsS "${auth[@]}" "$@"; }
server_id="${FCX_SERVER_ID:-$(curl -fsS http://169.254.169.254/hetzner/v1/metadata/instance-id)}"

echo "fcx: deadline passed, destroying run '$name'"
vols=$(api "$API/volumes?label_selector=fcx=$name" | jq -r '.volumes[].id')
for vid in $vols; do
  api -X POST "$API/volumes/$vid/actions/detach" >/dev/null || true
  sleep "${FCX_SLEEP:-15}"
  api -X DELETE "$API/volumes/$vid" >/dev/null || true
done
left=$(api "$API/volumes?label_selector=fcx=$name" | jq -r '.volumes[].id')
[[ -z "$left" ]] || { echo "fcx: volume still there ($left). Will retry in 5 min."; exit 1; }

fws=$(api "$API/firewalls?label_selector=fcx=$name" | jq -r '.firewalls[].id')
for fid in $fws; do
  api -X POST "$API/firewalls/$fid/actions/remove_from_resources" \
    -d "{\"remove_from\":[{\"type\":\"server\",\"server\":{\"id\":$server_id}}]}" >/dev/null || true
  sleep "${FCX_SLEEP:-5}"
  api -X DELETE "$API/firewalls/$fid" >/dev/null || true
done
api -X DELETE "$API/servers/$server_id" >/dev/null
