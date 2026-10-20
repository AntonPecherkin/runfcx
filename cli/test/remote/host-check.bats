setup() {
  S="$BATS_TMPDIR/hc$$"; mkdir -p "$S"
  printf '#!/bin/sh\necho 4\n' > "$S/nproc"
  printf '#!/bin/sh\necho "Mem: 15 1 14"\n' > "$S/free"
  printf '#!/bin/sh\necho Avail; echo "${STUB_AVAIL}G"\n' > "$S/df"
  chmod +x "$S"/*
  R="$BATS_TEST_DIRNAME/../../remote/host-check.sh"
}
@test "a fresh Vultr 1000 GB disk passes: run 1 measured 886 GB free on it" {
  PATH="$S:$PATH" STUB_AVAIL=886 FCX_OS_RELEASE=/dev/null run bash "$R" "$BATS_TMPDIR/data"; [ "$status" -eq 0 ]
}
@test "under 800 GB free fails: the restore peaks near 557 GB plus one shard's 222 GB of chunks" {
  PATH="$S:$PATH" STUB_AVAIL=750 FCX_OS_RELEASE=/dev/null run bash "$R" "$BATS_TMPDIR/data"
  [ "$status" -eq 1 ]; [[ "$output" == *"need 800"* ]]
}
