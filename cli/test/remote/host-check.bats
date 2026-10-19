setup() {
  S="$BATS_TMPDIR/hc$$"; mkdir -p "$S"
  printf '#!/bin/sh\necho 4\n' > "$S/nproc"
  printf '#!/bin/sh\necho "Mem: 15 1 14"\n' > "$S/free"
  printf '#!/bin/sh\necho Avail; echo "${STUB_AVAIL}G"\n' > "$S/df"
  chmod +x "$S"/*
  R="$BATS_TEST_DIRNAME/../../remote/host-check.sh"
}
@test "1800 GB free passes" {
  PATH="$S:$PATH" STUB_AVAIL=1850 FCX_OS_RELEASE=/dev/null run bash "$R" "$BATS_TMPDIR/data"; [ "$status" -eq 0 ]
}
@test "a 1.5 TB disk fails: the snapshot peaks near 1.6 TB" {
  PATH="$S:$PATH" STUB_AVAIL=1450 FCX_OS_RELEASE=/dev/null run bash "$R" "$BATS_TMPDIR/data"
  [ "$status" -eq 1 ]; [[ "$output" == *"need 1800"* ]]
}
