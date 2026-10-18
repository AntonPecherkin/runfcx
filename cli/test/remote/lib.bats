setup() { source "$BATS_TEST_DIRNAME/../../remote/lib.sh"; F="$BATS_TEST_DIRNAME/fixtures"; }

@test "parse_ttl accepts m/h/d and 0" {
  [ "$(parse_ttl 90m)" = 5400 ]; [ "$(parse_ttl 8h)" = 28800 ]
  [ "$(parse_ttl 2d)" = 172800 ]; [ "$(parse_ttl 0)" = 0 ]
}
@test "parse_ttl rejects junk" {
  run parse_ttl 8x; [ "$status" -eq 1 ]
  run parse_ttl ""; [ "$status" -eq 1 ]
  run parse_ttl -1h; [ "$status" -eq 1 ]
}
@test "ttl_state" {
  [ "$(ttl_state 0 100)" = none ]; [ "$(ttl_state 5000 100)" = ok ]
  [ "$(ttl_state 1900 100)" = warn ]; [ "$(ttl_state 100 100)" = expired ]
}
@test "detect_phase downloading" { [ "$(detect_phase "$F/log-downloading.txt")" = "downloading 1 120 2671 7h6m" ]; }
@test "detect_phase unzipping"   { [ "$(detect_phase "$F/log-unzipping.txt")" = "unzipping 1 - - -" ]; }
@test "detect_phase unpacking"   { [ "$(detect_phase "$F/log-unpacking.txt")" = "unpacking 1 - - -" ]; }
@test "detect_phase running and empty" {
  [ "$(detect_phase "$F/log-running.txt")" = "running - - - -" ]
  : > "$BATS_TMPDIR/empty.txt"; [ "$(detect_phase "$BATS_TMPDIR/empty.txt")" = "starting - - - -" ]
}
@test "info_ready" {
  run info_ready "$F/info-syncing.json" 10; [ "$status" -eq 1 ]; [ "$output" = 5400 ]
  run info_ready "$F/info-ready.json" 10;   [ "$status" -eq 0 ]; [ "$output" = 2 ]
}
@test "find_volume returns the mounted Hetzner volume" {
  R="$BATS_TMPDIR/mnt"; rm -rf "$R"; mkdir -p "$R/HC_Volume_9"; touch "$R/HC_Volume_9/.mounted"
  PATH="$BATS_TEST_DIRNAME/stubs:$PATH" run find_volume "$R" 1 0
  [ "$status" -eq 0 ]; [ "$output" = "$R/HC_Volume_9" ]
}
@test "find_volume fails when the volume dir exists but is not mounted" {
  R="$BATS_TMPDIR/mnt"; rm -rf "$R"; mkdir -p "$R/HC_Volume_9"
  PATH="$BATS_TEST_DIRNAME/stubs:$PATH" run find_volume "$R" 2 0
  [ "$status" -eq 1 ]
}
@test "install_running detects an upgrade in progress" {
  PATH="$BATS_TEST_DIRNAME/stubs:$PATH" STUB_PGREP_HIT=1 run install_running; [ "$status" -eq 0 ]
  PATH="$BATS_TEST_DIRNAME/stubs:$PATH" run install_running; [ "$status" -eq 1 ]
}
