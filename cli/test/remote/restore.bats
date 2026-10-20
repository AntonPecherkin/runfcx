setup() {
  T="$BATS_TMPDIR/restore$$"; rm -rf "$T"; mkdir -p "$T"
  export STUB_DIR="$T/stub" STUB_LOG="$T/curl.log" STUB_SNAP_ROOT="$T/bucket"
  mkdir -p "$STUB_DIR" "$STUB_SNAP_ROOT"; : > "$STUB_LOG"
  export PATH="$BATS_TEST_DIRNAME/stubs:$PATH" FCX_SNAPSHOT_URL=https://snap.test FCX_DF_CMD="echo 999999"
  D="$T/snapchain"; mkdir -p "$D"; S="$D/.fcx-snapshot"; R="$BATS_TEST_DIRNAME/../../remote/restore.sh"
  N=FARCASTER_NETWORK_MAINNET
  for s in 0 1 2; do mk_snap "$s" new; done
}
teardown() { rm -rf "$T"; }

# Builds one shard snapshot the way upstream uploads it: a tar of shard-<s>/, split, each piece gzipped.
# Prints nothing; writes latest.json (or latest.json.next with next=1).
mk_snap() {
  local s="$1" tag="$2" next="${3:-}" kb src i=0 p list=""
  kb="$N/$s/snapshot-$tag.tar.gz"; src="$T/src/$s-$tag"
  mkdir -p "$src/shard-$s" "$STUB_SNAP_ROOT/$kb" "$STUB_SNAP_ROOT/$N/$s"
  echo "shard $s $tag" > "$src/shard-$s/DATA"
  yes "$s$tag" | head -c 20000 > "$src/shard-$s/blob"
  tar -cf "$T/s.tar" -C "$src" "shard-$s"
  split -b 8000 "$T/s.tar" "$T/piece."
  for p in "$T"/piece.*; do
    i=$((i + 1)); gzip -c "$p" > "$STUB_SNAP_ROOT/$kb/$(printf chunk_%04d.bin "$i")"
    list="$list${list:+,}\"$(printf chunk_%04d.bin "$i")\""
  done
  rm -f "$T"/piece.* "$T/s.tar"
  echo "{\"key_base\":\"$kb\",\"chunks\":[$list],\"timestamp\":1}" > "$STUB_SNAP_ROOT/$N/$s/latest.json${next:+.next}"
}
chunks_of() { ls "$STUB_SNAP_ROOT/$N/$1/snapshot-$2.tar.gz" | wc -l | tr -d ' '; }
requested() { grep -c "$1" "$STUB_LOG" || true; }

@test "restores shards 0, 1, 2 in order, fetching latest.json right before each shard" {
  run bash "$R" "$D"; [ "$status" -eq 0 ]
  seq=$(grep -oE "$N/[0-9]/(latest\.json|snapshot)" "$STUB_LOG" | sed -E 's#.*/([0-9])/latest.json#L\1#; s#.*/([0-9])/snapshot#C\1#' | uniq | tr '\n' ' ')
  [ "$seq" = "L0 C0 L1 C1 L2 C2 " ]
  for s in 0 1 2; do
    [ "$(cat "$D/.rocks/shard-$s/DATA")" = "shard $s new" ]; [ -f "$D/.rocks/.fcx-restored-$s" ]
  done
  [[ "$output" == *"fcx-restore: done"* ]]
}

@test "deletes each shard's chunks right after it unpacks, before the next shard downloads" {
  STUB_SNAP_FAIL="$N/1/snapshot-new.tar.gz/chunk_0002.bin" run bash "$R" "$D"
  [ "$status" -ne 0 ]
  [ -f "$D/.rocks/.fcx-restored-0" ]; [ ! -e "$S/shard-0" ]
  [ -f "$S/shard-1/chunk_0001.bin" ]; [ ! -e "$D/.rocks/.fcx-restored-1" ]
  [[ "$output" == *"fcx-restore: stopped:"* ]]
}

@test "the staging dir is gone after a full restore" {
  run bash "$R" "$D"; [ "$status" -eq 0 ]; [ ! -e "$S" ]
}

@test "never writes a .tar file: chunks stream into tar" {
  run bash "$R" "$D"; [ "$status" -eq 0 ]
  [ -z "$(find "$D" -name '*.tar')" ]
}

@test "resumes an interrupted download: keeps finished chunks, re-downloads .part files" {
  mkdir -p "$S/shard-0"; echo "$N/0/snapshot-new.tar.gz" > "$S/shard-0/key_base"
  cp "$STUB_SNAP_ROOT/$N/0/snapshot-new.tar.gz/chunk_0001.bin" "$S/shard-0/"
  echo half > "$S/shard-0/chunk_0002.bin.part"
  FCX_SHARDS=0 run bash "$R" "$D"; [ "$status" -eq 0 ]
  [ "$(requested chunk_0001.bin)" -eq 0 ]; [ "$(requested chunk_0002.bin)" -eq 1 ]
  [ "$(cat "$D/.rocks/shard-0/DATA")" = "shard 0 new" ]
  [ -z "$(find "$D" -name '*.part')" ]
}

@test "resumes after a crash mid-unpack: no marker means that shard unpacks again from clean" {
  mkdir -p "$S/shard-1" "$D/.rocks/shard-1"; echo "$N/1/snapshot-new.tar.gz" > "$S/shard-1/key_base"
  cp "$STUB_SNAP_ROOT/$N/1/snapshot-new.tar.gz/"* "$S/shard-1/"
  echo partial > "$D/.rocks/shard-1/STALE"
  FCX_SHARDS=1 run bash "$R" "$D"; [ "$status" -eq 0 ]
  [ "$(requested chunk_)" -eq 0 ]
  [ ! -e "$D/.rocks/shard-1/STALE" ]; [ "$(cat "$D/.rocks/shard-1/DATA")" = "shard 1 new" ]
  [ -f "$D/.rocks/.fcx-restored-1" ]
}

@test "skips shards that already have a marker and cleans their leftover chunks" {
  mkdir -p "$D/.rocks/shard-0" "$S/shard-0"; touch "$D/.rocks/.fcx-restored-0" "$S/shard-0/chunk_0001.bin"
  echo kept > "$D/.rocks/shard-0/DATA"
  run bash "$R" "$D"; [ "$status" -eq 0 ]
  [ "$(requested "$N/0/")" -eq 0 ]; [ "$(cat "$D/.rocks/shard-0/DATA")" = kept ]
  [ "$(cat "$D/.rocks/shard-1/DATA")" = "shard 1 new" ]
}

@test "a changed key_base drops the old chunks and restarts that shard" {
  mkdir -p "$S/shard-1" "$D/.rocks/shard-1"; echo "$N/1/snapshot-old.tar.gz" > "$S/shard-1/key_base"
  echo old > "$S/shard-1/chunk_0001.bin"; echo old > "$D/.rocks/shard-1/OLD"
  FCX_SHARDS=1 run bash "$R" "$D"; [ "$status" -eq 0 ]
  [[ "$output" == *"shard 1 snapshot changed"* ]]
  [ "$(requested "snapshot-new.tar.gz/chunk_0001.bin")" -eq 1 ]
  [ ! -e "$D/.rocks/shard-1/OLD" ]; [ "$(cat "$D/.rocks/shard-1/DATA")" = "shard 1 new" ]
}

@test "a snapshot that rotates mid-download (404) restarts the shard on the new key_base" {
  mk_snap 1 old; mk_snap 1 newer next
  STUB_SNAP_ROTATE="snapshot-old.tar.gz/chunk_0002.bin" FCX_SHARDS=1 run bash "$R" "$D"
  [ "$status" -eq 0 ]
  [[ "$output" == *"shard 1 snapshot changed"* ]]
  [ "$(cat "$D/.rocks/shard-1/DATA")" = "shard 1 newer" ]
}

@test "a corrupt chunk stops the unpack without a marker; the next run downloads the missing chunks again" {
  STUB_SNAP_CORRUPT="$N/0/snapshot-new.tar.gz/chunk_0002.bin" FCX_SHARDS=0 run bash "$R" "$D"
  [ "$status" -ne 0 ]; [[ "$output" == *"stopped: unpacking shard 0 failed (1 corrupt chunks deleted)"* ]]
  [ ! -e "$D/.rocks/.fcx-restored-0" ]; [ ! -e "$S/shard-0/chunk_0002.bin" ]; [ -f "$S/shard-0/chunk_0003.bin" ]
  : > "$STUB_LOG"
  FCX_SHARDS=0 run bash "$R" "$D"; [ "$status" -eq 0 ]
  # chunk 1 was unpacked (and deleted) before chunk 2 failed, so both come back; 3 and 4 stayed
  [ "$(requested chunk_)" -eq 2 ]; [ "$(requested chunk_0001.bin)" -eq 1 ]; [ "$(requested chunk_0002.bin)" -eq 1 ]
  [ "$(cat "$D/.rocks/shard-0/DATA")" = "shard 0 new" ]
}

@test "disk guard stops before a shard that would not fit, without downloading" {
  # chunks are deleted as they unpack, so the peak is the downloads plus how much bigger the data
  # gets unpacked: 4 chunks x (100 MB download + 20 MB growth) + 20 GB margin = 20960 MB
  FCX_DF_CMD="echo 20000" FCX_SHARDS=0 run bash "$R" "$D"
  [ "$status" -ne 0 ]
  [[ "$output" == *"fcx-restore: stopped: not enough disk for shard 0: need 21 GB free, have 19 GB"* ]]
  [ "$(requested chunk_)" -eq 0 ]; [ ! -e "$D/.rocks/.fcx-restored-0" ]
  FCX_DF_CMD="echo 20959" FCX_SHARDS=0 run bash "$R" "$D"; [ "$status" -ne 0 ]
  FCX_DF_CMD="echo 20960" FCX_SHARDS=0 run bash "$R" "$D"; [ "$status" -eq 0 ]
}

@test "disk guard does not count a partial shard left by a crash mid-unpack" {
  # free space = exactly what shard 0 needs, minus whatever the partial shard still holds
  mkdir -p "$D/.rocks/shard-0"; head -c 3000000 /dev/zero > "$D/.rocks/shard-0/partial"
  FCX_DF_CMD="echo \$(( 20960 - \$(du -sm '$D/.rocks/shard-0' 2>/dev/null | cut -f1) + 0 ))" FCX_SHARDS=0 run bash "$R" "$D"
  [ "$status" -eq 0 ]
}

@test "disk guard counts only chunks still to download" {
  mkdir -p "$S/shard-0"; echo "$N/0/snapshot-new.tar.gz" > "$S/shard-0/key_base"
  cp "$STUB_SNAP_ROOT/$N/0/snapshot-new.tar.gz/"* "$S/shard-0/"
  # nothing to download: only growth (4 x 20 MB) + margin = 20560 MB
  FCX_DF_CMD="echo 20559" FCX_SHARDS=0 run bash "$R" "$D"; [ "$status" -ne 0 ]
  FCX_DF_CMD="echo 20560" FCX_SHARDS=0 run bash "$R" "$D"; [ "$status" -eq 0 ]
}

@test "deletes each chunk as soon as it is unpacked, so downloads and unpacked data never pile up" {
  STUB_SNAP_CORRUPT="$N/0/snapshot-new.tar.gz/chunk_0003.bin" FCX_SHARDS=0 run bash "$R" "$D"
  [ "$status" -ne 0 ]
  [ ! -e "$S/shard-0/chunk_0001.bin" ]; [ ! -e "$S/shard-0/chunk_0002.bin" ]   # unpacked, then deleted
  [ ! -e "$S/shard-0/chunk_0003.bin" ]                                          # corrupt, deleted
  [ -f "$S/shard-0/chunk_0004.bin" ]                                            # never reached
}

@test "removes upstream's half-finished staging dir" {
  mkdir -p "$D/.rocks.snapshot/shard-1"; echo x > "$D/.rocks.snapshot/shard_1_snapshot.tar"
  run bash "$R" "$D"; [ "$status" -eq 0 ]; [ ! -e "$D/.rocks.snapshot" ]
}

@test "refuses to run twice at once" {
  echo $$ > "$D/.fcx-restore.pid"
  run bash "$R" "$D"; [ "$status" -eq 75 ]; [[ "$output" == *"already running"* ]]
  [ ! -s "$STUB_LOG" ]
}

@test "a stale pid file from a dead run does not block" {
  echo 999999 > "$D/.fcx-restore.pid"
  run bash "$R" "$D"; [ "$status" -eq 0 ]; [ ! -e "$D/.fcx-restore.pid" ]
}

@test "log lines are what detect_phase reads" {
  source "$BATS_TEST_DIRNAME/../../remote/lib.sh"
  run bash "$R" "$D"; [ "$status" -eq 0 ]; echo "$output" > "$T/log"
  sed '/downloading shard 1 chunk 2\//q' "$T/log" > "$T/mid"
  read -r ph sh ch n _ <<<"$(detect_phase "$T/mid")"
  [ "$ph $sh $ch $n" = "downloading 1 2 $(chunks_of 1 new)" ]
  sed '/unpacking shard 2/q' "$T/log" > "$T/unp"
  [ "$(detect_phase "$T/unp")" = "unpacking 2 - - -" ]
  [ "$(detect_phase "$T/log")" = "starting - - - -" ]
  rm -rf "$D/.rocks"; FCX_DF_CMD="echo 1" run bash "$R" "$D"; echo "$output" > "$T/fail"
  [ "$(detect_phase "$T/fail")" = "restore_failed - - - -" ]
}
