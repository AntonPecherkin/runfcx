#!/usr/bin/env bash
# Runs on the server. Prints one JSON object describing the node.
set -uo pipefail
ETC="${FCX_ETC:-/etc/fcx}"
# shellcheck source=/dev/null
source "${FCX_LIB:-/opt/fcx/lib.sh}"
logs_cmd="${FCX_LOGS_CMD:-docker compose -f /root/snapchain/docker-compose.yml logs --no-color --tail 300 snapchain}"
info_cmd="${FCX_INFO_CMD:-curl -fsS --max-time 5 http://127.0.0.1:3381/v1/info}"
restore_log="${FCX_RESTORE_LOG:-/root/snapchain/restore.log}"
df_cmd="${FCX_DF_CMD:-df -BG --output=used,avail /mnt/fcx | tail -1 | tr -dc '0-9 '}"
now="${FCX_NOW:-$(date +%s)}"

log=$(mktemp); info=$(mktemp)
# fcx's own restore runs before the container exists; container lines, when any, come after and win
{ grep 'fcx-restore: ' "$restore_log" 2>/dev/null | tail -n 50; eval "$logs_cmd" 2>/dev/null; } > "$log"
read -r phase shard chunk chunks eta <<<"$(detect_phase "$log")"
detail=; [[ "$phase" == restore_failed ]] && detail=$(restore_message "$log")
read -r used free <<<"$(eval "$df_cmd")"
delay=null; stale=
if eval "$info_cmd" > "$info" 2>/dev/null && [[ -s "$info" ]]; then
  if delay=$(info_ready "$info" 10); then phase=ready; else phase=syncing; fi
  stale=$(stale_shard "$info" 1000000) && phase=shard_from_genesis
elif [[ ! -s "$log" ]]; then
  phase=$([[ -f /root/snapchain/install.log ]] && echo installing || echo stopped)
fi
(( free < 5 )) && phase=disk_full
deadline=$(cat "$ETC/deadline" 2>/dev/null || echo 0)
ram=$(free -g 2>/dev/null | awk '/Mem:/{print $3}'); ram=${ram:-0}
num() { [[ "$1" == - ]] && echo null || echo "$1"; }
jq -n --arg phase "$phase" --argjson shard "$(num "$shard")" --argjson chunk "$(num "$chunk")" \
  --argjson chunks "$(num "$chunks")" --arg eta "$eta" --argjson delay "$delay" \
  --argjson used "${used:-0}" --argjson free "${free:-0}" --argjson ram "$ram" \
  --argjson deadline "$deadline" --arg ttl "$(ttl_state "$deadline" "$now")" --arg stale "${stale%% *}" \
  --arg detail "$detail" \
  '{phase:$phase,shard:$shard,chunk:$chunk,chunks:$chunks,eta:(if $eta=="-" then null else $eta end),
    max_block_delay:$delay,stale_shard:(if $stale=="" then null else ($stale|tonumber) end),disk_used_gb:$used,disk_free_gb:$free,ram_used_gb:$ram,deadline:$deadline,ttl:$ttl,
    detail:(if $detail=="" then null else $detail end)}'
rm -f "$log" "$info"
