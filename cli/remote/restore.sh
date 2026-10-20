#!/usr/bin/env bash
# Usage: restore.sh [snapchain_dir]. Restores the mainnet snapshot into <dir>/.rocks before the node's
# first start, one shard at a time, and can resume after any interruption.
# Upstream's restore keeps every chunk, a full .tar and the unpacked shard on disk until all shards are
# done (peak near 1.6 TB in run 1). Here chunks stream through gunzip into tar (no .tar file) and are
# deleted once their shard is unpacked, so the peak is about one shard's chunks plus the unpacked data.
# Progress goes to stdout as "fcx-restore: ..." lines; lib.sh detect_phase reads them for fcx status.
set -euo pipefail
DIR="${1:-/root/snapchain}"
URL="${FCX_SNAPSHOT_URL:-https://pub-d352dd8819104a778e20d08888c5a661.r2.dev}"
NET="${FCX_NETWORK:-FARCASTER_NETWORK_MAINNET}"
# Shard 0 first: it is the smallest, so its snapshot is the least likely to rotate out mid-restore.
read -r -a SHARDS <<<"${FCX_SHARDS:-0 1 2}"
CHUNK_MB="${FCX_CHUNK_MB:-100}"  # upstream chunks are 100 MB max; run 1 measured ~83 MB each
UNPACK_MB="${FCX_UNPACK_MB:-100}" # unpacked size per chunk; run 1 measured ~98 MB (261 GB / 2672)
MARGIN_GB="${FCX_MARGIN_GB:-20}"
DB="$DIR/.rocks"; STAGE="$DIR/.fcx-snapshot"; PIDF="$DIR/.fcx-restore.pid"

log() { echo "$(date -u +%FT%TZ) fcx-restore: $*"; }
stop() { log "stopped: $*"; exit 1; }
free_mb() { if [[ -n "${FCX_DF_CMD:-}" ]]; then eval "$FCX_DF_CMD"; else df -BM --output=avail "$DIR" | tail -1 | tr -dc 0-9; fi; }

pid=$(cat "$PIDF" 2>/dev/null || true)
if [[ "$pid" =~ ^[0-9]+$ ]] && kill -0 "$pid" 2>/dev/null; then echo "fcx restore already running (pid $pid)."; exit 75; fi
echo $$ > "$PIDF"
trap 'rm -f "$PIDF"' EXIT

mkdir -p "$DB" "$STAGE"
touch "$DB/.fcx-restore" # marks .rocks as ours: lib.sh restore_needed, and upstream sees it non-empty
# upstream's half-finished staging (.tar files and chunks) is dead weight once we take over
rm -rf "$DIR/.rocks.snapshot"

# Prints "<key_base> <chunk> <chunk> ..." from the shard's latest.json. Fetched fresh every time.
latest() {
  local j
  j=$(curl -fsS --retry 5 --retry-delay 3 "$URL/$NET/$1/latest.json") || return 1
  # names end up in paths and URLs: plain characters only, no ".."
  jq -er 'def ok: test("^[A-Za-z0-9._/-]+$") and (contains("..") | not);
    if (.key_base | ok) and (.chunks | length > 0) and all(.chunks[]; ok and (contains("/") | not))
    then [.key_base] + .chunks | join(" ") else error("bad latest.json") end' <<<"$j"
}

eta() { # done_this_run remaining elapsed_s
  (( $1 > 0 )) || return 0
  local s=$(( $3 * $2 / $1 )); printf ' ETA %dh%dm' $((s / 3600)) $((s % 3600 / 60))
}

# Downloads one chunk to .part and renames it when complete. Returns 1 if the URL fails.
fetch_chunk() {
  curl -fsS --retry 5 --retry-delay 3 -o "$2.part" "$1" || { rm -f "$2.part"; return 1; }
  mv "$2.part" "$2"
}

# Restores one shard. Returns 2 if its snapshot rotated mid-download, so the caller starts it over.
restore_shard() {
  local s="$1" here="$STAGE/shard-$1" meta kb rest n i c missing need free started got bad
  local -a chunks
  meta=$(latest "$s") || stop "cannot read the shard $s snapshot list ($URL/$NET/$s/latest.json)"
  read -r kb rest <<<"$meta"; read -r -a chunks <<<"$rest"; n=${#chunks[@]}
  if [[ -f "$here/key_base" && "$(cat "$here/key_base")" != "$kb" ]]; then
    log "shard $s snapshot changed ($(cat "$here/key_base") -> $kb), starting the shard over"
    rm -rf "$here" "${DB:?}/shard-$s"
  fi
  if ! { mkdir -p "$here" && echo "$kb" > "$here/key_base"; }; then stop "cannot write to $here"; fi
  rm -f "$here"/*.part
  log "shard $s: $n chunks from $kb"

  # a crash mid-unpack leaves a partial shard; never mix it with a fresh one, nor count it as used
  rm -rf "${DB:?}/shard-$s"
  missing=0
  for c in "${chunks[@]}"; do [[ -f "$here/$c" ]] || missing=$((missing + 1)); done
  need=$(( missing * CHUNK_MB + n * UNPACK_MB + MARGIN_GB * 1024 ))
  free=$(free_mb)
  (( free >= need )) || stop "not enough disk for shard $s: need $(((need + 1023) / 1024)) GB free, have $((free / 1024)) GB. Use a bigger disk, then run: fcx node"

  started=$SECONDS; got=0
  for ((i = 0; i < n; i++)); do
    c="${chunks[i]}"
    [[ -f "$here/$c" ]] && continue
    log "downloading shard $s chunk $((i + 1))/$n$(eta "$got" $((n - i)) $((SECONDS - started)))"
    if ! fetch_chunk "$URL/$kb/$c" "$here/$c"; then
      meta=$(latest "$s") || stop "cannot download shard $s chunk $c"
      [[ "${meta%% *}" != "$kb" ]] && return 2
      stop "cannot download shard $s chunk $c ($URL/$kb/$c)"
    fi
    got=$((got + 1))
  done

  log "unpacking shard $s"
  # each chunk is its own gzip stream of the next slice of one tar
  if ! for c in "${chunks[@]}"; do gunzip -c "$here/$c" || exit 1; done | tar -x -C "$DB"; then
    bad=0
    for c in "${chunks[@]}"; do gzip -t "$here/$c" 2>/dev/null || { rm -f "$here/$c"; bad=$((bad + 1)); }; done
    stop "unpacking shard $s failed ($bad corrupt chunks deleted). Run fcx node again: it downloads them again and retries this shard"
  fi
  touch "$DB/.fcx-restored-$s" || stop "cannot write $DB/.fcx-restored-$s"
  rm -rf "$here"
  log "shard $s done"
}

for s in "${SHARDS[@]}"; do
  if [[ -f "$DB/.fcx-restored-$s" ]]; then rm -rf "${STAGE:?}/shard-$s"; continue; fi
  for attempt in 1 2 3; do
    rc=0; restore_shard "$s" || rc=$?
    (( rc == 0 )) && break
    (( rc == 2 )) || exit "$rc"
    log "shard $s snapshot changed during download, starting the shard over"
    (( attempt < 3 )) || stop "shard $s snapshot kept changing during download"
  done
done
rm -rf "$STAGE"
log "done"
