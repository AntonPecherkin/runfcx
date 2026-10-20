#!/usr/bin/env bash
# Shared server-side helpers. Pure functions: no network.

parse_ttl() {
  local s="$1"
  [[ "$s" == 0 ]] && { echo 0; return 0; }
  [[ "$s" =~ ^([0-9]+)([mhd])$ ]] || return 1
  local n="${BASH_REMATCH[1]}"
  case "${BASH_REMATCH[2]}" in m) echo $((n * 60)) ;; h) echo $((n * 3600)) ;; d) echo $((n * 86400)) ;; esac
}

ttl_state() {
  local deadline="$1" now="$2"
  if (( deadline == 0 )); then echo none
  elif (( now >= deadline )); then echo expired
  elif (( deadline - now <= 1800 )); then echo warn
  else echo ok; fi
}

# Latest snapshot phase from the restore log (fcx-restore lines) and the snapchain container log.
detect_phase() {
  local line
  line=$(grep -E 'Downloading zipped snapshot chunk|Unzipping snapshot chunk|Unpacking snapshot file|Starting node|fcx-restore: (downloading|unpacking|stopped|done)' "$1" | tail -n 1)
  if [[ -z "$line" ]]; then echo "starting - - - -"
  elif [[ "$line" =~ fcx-restore:\ downloading\ shard\ ([0-9]+)\ chunk\ ([0-9]+)/([0-9]+)(\ ETA\ ([0-9]+h[0-9]+m))? ]]; then
    echo "downloading ${BASH_REMATCH[1]} ${BASH_REMATCH[2]} ${BASH_REMATCH[3]} ${BASH_REMATCH[5]:--}"
  elif [[ "$line" =~ fcx-restore:\ unpacking\ shard\ ([0-9]+) ]]; then echo "unpacking ${BASH_REMATCH[1]} - - -"
  elif [[ "$line" == *"fcx-restore: stopped"* ]]; then echo "restore_failed - - - -"
  elif [[ "$line" == *"fcx-restore: done"* ]]; then echo "starting - - - -"
  elif [[ "$line" =~ Downloading\ zipped\ snapshot\ chunk\ [^\ ]+\ for\ shard\ ([0-9]+)\ \(([0-9]+)/([0-9]+)\ chunks\ in\ shard\)\ ?(Shard\ ETA:\ ([0-9]+h[0-9]+m))? ]]; then
    echo "downloading ${BASH_REMATCH[1]} ${BASH_REMATCH[2]} ${BASH_REMATCH[3]} ${BASH_REMATCH[5]:--}"
  elif [[ "$line" =~ Unzipping\ snapshot\ chunk\ .*\ for\ shard\ ([0-9]+) ]]; then echo "unzipping ${BASH_REMATCH[1]} - - -"
  elif [[ "$line" =~ Unpacking\ snapshot\ file\ .*\ for\ shard\ ([0-9]+) ]]; then echo "unpacking ${BASH_REMATCH[1]} - - -"
  else echo "running - - - -"; fi
}

# Why the last fcx restore stopped (empty if it did not).
restore_message() { grep 'fcx-restore: stopped: ' "$1" 2>/dev/null | tail -n 1 | sed 's/.*fcx-restore: stopped: //'; }

# Exit 0 if <snapchain_dir> still needs fcx's snapshot restore before the node may start.
# Done = all three shard markers. A .rocks with data but no fcx files was restored before fcx had its
# own restore; leave it alone unless upstream's staging dir shows that restore never finished.
restore_needed() {
  local db="$1/.rocks" s
  if compgen -G "$db/.fcx-restore*" >/dev/null; then
    for s in 0 1 2; do [[ -f "$db/.fcx-restored-$s" ]] || return 0; done
    return 1
  fi
  [[ -d "$db" && -n "$(ls -A "$db")" && ! -e "$1/.rocks.snapshot" ]] && return 1
  return 0
}

# True while restore.sh runs for <snapchain_dir>.
restore_running() {
  local pid
  pid=$(cat "$1/.fcx-restore.pid" 2>/dev/null) || return 1
  [[ "$pid" =~ ^[0-9]+$ ]] && kill -0 "$pid" 2>/dev/null
}

# Waits until a background restore logs progress. Fails with its reason if it stopped or died.
wait_restore_start() {
  local log="$1" tries="$2" pause="$3" i
  for ((i = 0; i < tries; i++)); do
    if grep -q 'fcx-restore: stopped' "$log"; then echo "Snapshot restore stopped: $(restore_message "$log")"; return 1; fi
    grep -qE 'fcx-restore: (downloading|unpacking|done|shard)' "$log" && return 0
    sleep "$pause"
  done
  echo "Snapshot restore did not start. Last lines:"; tail -20 "$log"; return 1
}

info_ready() {
  local worst
  worst=$(jq '[.shardInfos[].blockDelay] | max' "$1") || return 2
  echo "$worst"
  (( worst <= $2 ))
}

# Prints the mounted Hetzner volume under <root>. Waits up to <tries> x <sleep> seconds.
find_volume() {
  local root="$1" tries="$2" pause="$3" d i
  for ((i = 0; i < tries; i++)); do
    for d in "$root"/HC_Volume_*; do
      [[ -d "$d" ]] && mountpoint -q "$d" && { echo "$d"; return 0; }
    done
    sleep "$pause"
  done
  return 1
}

# True while an upstream `snapchain.sh upgrade` is still running.
install_running() { pgrep -f 'snapchain.sh upgrade' >/dev/null; }

# Waits for upstream `snapchain.sh upgrade` to finish. Fails fast if it exits without success.
wait_upgrade() {
  local log="$1" tries="$2" pause="$3" i
  for ((i = 0; i < tries; i++)); do
    grep -q "Upgrade complete" "$log" && return 0
    if grep -qE "❌|checksum mismatch" "$log" || ! install_running; then
      grep -q "Upgrade complete" "$log" && return 0
      echo "The upstream installer stopped. Last lines:"; tail -20 "$log"; return 1
    fi
    sleep "$pause"
  done
  echo "Install did not finish in time. Last lines:"; tail -20 "$log"; return 1
}

# Upstream's own auto-upgrade schedule (a weekday, before 7am), keyed on <seed> so it is stable.
# We install it ourselves: upstream's installer can't pick a day until the node has a peer ID.
cron_line() {
  local dir="$1" n
  n=$(printf '%s' "$2" | cksum | cut -d' ' -f1)
  echo "0 $((n % 7)) * * $((n % 5 + 1)) root $dir/snapchain.sh autoupgrade >> $dir/snapchain-autoupgrade.log 2>&1"
}

# Some images (Vultr's Ubuntu) ship with ufw on. Gossip needs 3382/udp in.
open_gossip_port() {
  command -v ufw >/dev/null || return 0
  ufw status 2>/dev/null | grep -q "Status: active" && ufw allow 3382/udp >/dev/null
  return 0
}

# Prints shards far further behind than a snapshot could leave them: they skipped the snapshot
# and are syncing from block 1 (snapchain issue #1044). Exit 0 if any.
stale_shard() {
  local s
  s=$(jq -r --argjson max "$2" '[.shardInfos[] | select(.blockDelay > $max) | .shardId] | join(" ")' "$1") || return 2
  [[ -n "$s" ]] && echo "$s"
}
