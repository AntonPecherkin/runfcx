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

# Latest snapshot phase from the snapchain container log.
detect_phase() {
  local line
  line=$(grep -E 'Downloading zipped snapshot chunk|Unzipping snapshot chunk|Unpacking snapshot file|Starting node' "$1" | tail -n 1)
  if [[ -z "$line" ]]; then echo "starting - - - -"
  elif [[ "$line" =~ Downloading\ zipped\ snapshot\ chunk\ [^\ ]+\ for\ shard\ ([0-9]+)\ \(([0-9]+)/([0-9]+)\ chunks\ in\ shard\)\ ?(Shard\ ETA:\ ([0-9]+h[0-9]+m))? ]]; then
    echo "downloading ${BASH_REMATCH[1]} ${BASH_REMATCH[2]} ${BASH_REMATCH[3]} ${BASH_REMATCH[5]:--}"
  elif [[ "$line" =~ Unzipping\ snapshot\ chunk\ .*\ for\ shard\ ([0-9]+) ]]; then echo "unzipping ${BASH_REMATCH[1]} - - -"
  elif [[ "$line" =~ Unpacking\ snapshot\ file\ .*\ for\ shard\ ([0-9]+) ]]; then echo "unpacking ${BASH_REMATCH[1]} - - -"
  else echo "running - - - -"; fi
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
