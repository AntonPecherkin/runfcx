setup() {
  S="$BATS_TMPDIR/hc$$"; mkdir -p "$S"
  printf '#!/bin/sh\necho 4\n' > "$S/nproc"
  printf '#!/bin/sh\necho "Mem: 15 1 14"\n' > "$S/free"
  printf '#!/bin/sh\necho Avail; echo "${STUB_AVAIL}G"\n' > "$S/df"
  chmod +x "$S"/*
  R="$BATS_TEST_DIRNAME/../../remote/host-check.sh"
}
@test "a 1000 GB disk passes: run 1 finished its streamed restore in 557 GB" {
  PATH="$S:$PATH" STUB_AVAIL=980 FCX_OS_RELEASE=/dev/null run bash "$R" "$BATS_TMPDIR/data"; [ "$status" -eq 0 ]
}
@test "under 900 GB free fails" {
  PATH="$S:$PATH" STUB_AVAIL=800 FCX_OS_RELEASE=/dev/null run bash "$R" "$BATS_TMPDIR/data"
  [ "$status" -eq 1 ]; [[ "$output" == *"need 900"* ]]
}
