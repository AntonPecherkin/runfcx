#!/usr/bin/env bash
# Usage: host-check.sh <data_dir>. Checks the box can run a read node.
set -euo pipefail
dir="$1"; mkdir -p "$dir"
cpus=$(nproc); ram=$(free -g | awk '/Mem:/{print $2}')
disk=$(df -BG --output=avail "$dir" | tail -1 | tr -dc 0-9)
# shellcheck source=/dev/null
os=$( (. "${FCX_OS_RELEASE:-/etc/os-release}" && echo "$ID") 2>/dev/null || echo unknown)
fail=0
check() { if (( $2 >= $3 )); then echo "ok    $1: $2 (need $3)"; else echo "FAIL  $1: $2 (need $3)"; fail=1; fi; }
check "CPUs" "$cpus" 4
check "RAM GB" "$ram" 15
# fcx's streamed restore (restore.sh) fits a 1000 GB disk: run 1 ended at 557 GB, and the peak is
# that plus one shard's chunks (222 GB), ~780 GB. A fresh Vultr 1000 GB disk has 886 GB free.
# restore.sh checks the space again before every shard. Upstream's restore needed ~1.6 TB; fcx never runs it.
check "Free disk GB in $dir" "$disk" 800
[[ "$os" == ubuntu || "$os" == debian ]] || echo "warn  OS: $os (tested on Ubuntu 24.04)"
echo "note  Open UDP 3382 in your provider firewall. Keep 3381 and 3383 closed; fcx uses an SSH tunnel."
exit $fail
