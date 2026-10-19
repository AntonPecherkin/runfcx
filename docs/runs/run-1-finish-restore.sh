#!/usr/bin/env bash
# Finish a snapshot restore that ran out of disk. Streams chunks straight into tar (no .tar file on disk).
set -euo pipefail
U=https://pub-d352dd8819104a778e20d08888c5a661.r2.dev
S=/root/snapchain/.rocks.snapshot; DB=/root/snapchain/.rocks
log() { echo "$(date -u +%H:%M:%S) $*"; }


fetch() { # shard key_base first last
  local s="$1" kb="$2" i f
  mkdir -p "$S/shard-$s"
  for ((i = $3; i <= $4; i++)); do
    f=$(printf "chunk_%04d.bin" "$i")
    curl -fsS --retry 5 --retry-delay 3 -o "$S/shard-$s/$f.part" "$U/$kb/$f" && mv "$S/shard-$s/$f.part" "$S/shard-$s/$f"
    if (( i % 50 == 0 )); then log "shard $s chunk $i/$4"; fi
  done
  return 0
}
unpack() { # shard count
  local s="$1" n="$2" i
  log "unpacking shard $s"
  for ((i = 1; i <= n; i++)); do gunzip -c "$S/shard-$s/$(printf "chunk_%04d.bin" "$i")"; done | tar -x -C "$DB"
  rm -rf "$S/shard-$s"; log "shard $s done"; df -BG --output=avail / | tail -1
}

K2=FARCASTER_NETWORK_MAINNET/2/snapshot-2026-10-18-1792310585.tar.gz
for i in $(seq 1 2648); do [[ -s "$S/shard-2/$(printf chunk_%04d.bin "$i")" ]] || { log "missing shard 2 chunk $i"; exit 1; }; done
unpack 2 2648

K0=$(curl -fsS "$U/FARCASTER_NETWORK_MAINNET/0/latest.json" | python3 -c 'import json,sys;print(json.load(sys.stdin)["key_base"])')
N0=$(curl -fsS "$U/FARCASTER_NETWORK_MAINNET/0/latest.json" | python3 -c 'import json,sys;print(len(json.load(sys.stdin)["chunks"]))')
log "shard 0: $K0 ($N0 chunks)"
fetch 0 "$K0" 1 "$N0"
unpack 0 "$N0"

rm -rf "$S"; log "ALL DONE"; ls "$DB"; du -sh "$DB"/*
