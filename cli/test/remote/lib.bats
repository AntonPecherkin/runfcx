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

@test "wait_upgrade succeeds on the success line" {
  PATH="$BATS_TEST_DIRNAME/stubs:$PATH" run wait_upgrade "$F/install-ok.txt" 3 0; [ "$status" -eq 0 ]
}
@test "wait_upgrade stops when the installer exited without success" {
  PATH="$BATS_TEST_DIRNAME/stubs:$PATH" run wait_upgrade "$F/install-died.txt" 100 0
  [ "$status" -eq 1 ]; [[ "$output" == *"Unable to determine upgrade day"* ]]
}
@test "wait_upgrade keeps waiting while the installer runs" {
  PATH="$BATS_TEST_DIRNAME/stubs:$PATH" STUB_PGREP_HIT=1 run wait_upgrade "$F/install-died.txt" 2 0
  [ "$status" -eq 1 ]; [[ "$output" == *"did not finish"* ]]
}
@test "cron_line runs upstream autoupgrade on a weekday before 7am" {
  run cron_line /root/snapchain seed1
  [[ "$output" =~ ^0\ [0-6]\ \*\ \*\ [1-5]\ root\ /root/snapchain/snapchain.sh\ autoupgrade\ \>\>\ /root/snapchain/snapchain-autoupgrade.log\ 2\>\&1$ ]]
}
@test "open_gossip_port opens 3382/udp only when ufw is active" {
  export STUB_DIR="$BATS_TMPDIR/ufw$$"; mkdir -p "$STUB_DIR"
  PATH="$BATS_TEST_DIRNAME/stubs:$PATH" STUB_UFW_ACTIVE=1 run open_gossip_port; [ "$status" -eq 0 ]
  grep -q "allow 3382/udp" "$STUB_DIR/ufw.calls"
  rm "$STUB_DIR/ufw.calls"
  PATH="$BATS_TEST_DIRNAME/stubs:$PATH" run open_gossip_port; [ "$status" -eq 0 ]
  ! grep -q allow "$STUB_DIR/ufw.calls"
}
@test "stale_shard finds a shard syncing from genesis" {
  run stale_shard "$F/info-genesis.json" 1000000; [ "$status" -eq 0 ]; [ "$output" = 0 ]
  run stale_shard "$F/info-syncing.json" 1000000; [ "$status" -eq 1 ]
}
@test "detect_phase reads fcx restore lines" {
  [ "$(detect_phase "$F/restore-downloading.txt")" = "downloading 1 1240 2672 0h56m" ]
  [ "$(detect_phase "$F/restore-unpacking.txt")" = "unpacking 2 - - -" ]
  [ "$(detect_phase "$F/restore-stopped.txt")" = "restore_failed - - - -" ]
  [ "$(detect_phase "$F/restore-done.txt")" = "starting - - - -" ]
  echo "x fcx-restore: downloading shard 0 chunk 1/371" > "$BATS_TMPDIR/first.txt"
  [ "$(detect_phase "$BATS_TMPDIR/first.txt")" = "downloading 0 1 371 -" ]
}
@test "detect_phase: container lines after the restore log win" {
  cat "$F/restore-done.txt" "$F/log-running.txt" > "$BATS_TMPDIR/both.txt"
  [ "$(detect_phase "$BATS_TMPDIR/both.txt")" = "running - - - -" ]
}
@test "restore_message prints the reason the restore stopped" {
  run restore_message "$F/restore-stopped.txt"
  [ "$output" = "not enough disk for shard 2: need 550 GB free, have 300 GB. Use a bigger disk, then run: fcx node" ]
}
@test "restore_needed: fresh, partial and finished fcx restores" {
  D="$BATS_TMPDIR/rn$$"; rm -rf "$D"; mkdir -p "$D"
  run restore_needed "$D"; [ "$status" -eq 0 ]
  mkdir -p "$D/.rocks"; run restore_needed "$D"; [ "$status" -eq 0 ]
  touch "$D/.rocks/.fcx-restore" "$D/.rocks/.fcx-restored-0" "$D/.rocks/.fcx-restored-1"; mkdir "$D/.rocks/shard-0"
  run restore_needed "$D"; [ "$status" -eq 0 ]
  touch "$D/.rocks/.fcx-restored-2"; run restore_needed "$D"; [ "$status" -eq 1 ]
  rm -rf "$D"
}
@test "restore_needed: a node restored before fcx had its own restore is left alone" {
  D="$BATS_TMPDIR/rn$$"; rm -rf "$D"; mkdir -p "$D/.rocks/shard-1" "$D/.rocks/global"
  run restore_needed "$D"; [ "$status" -eq 1 ]
  mkdir "$D/.rocks.snapshot"   # but upstream's restore never finished
  run restore_needed "$D"; [ "$status" -eq 0 ]
  rm -rf "$D"
}
@test "restore_running follows the pid file" {
  D="$BATS_TMPDIR/rr$$"; mkdir -p "$D"
  run restore_running "$D"; [ "$status" -eq 1 ]
  echo $$ > "$D/.fcx-restore.pid"; run restore_running "$D"; [ "$status" -eq 0 ]
  echo 999999 > "$D/.fcx-restore.pid"; run restore_running "$D"; [ "$status" -eq 1 ]
  rm -rf "$D"
}
@test "wait_restore_start returns once the restore logs progress" {
  run wait_restore_start "$F/restore-downloading.txt" 3 0; [ "$status" -eq 0 ]
}
@test "wait_restore_start fails with the reason when the restore stopped" {
  run wait_restore_start "$F/restore-stopped.txt" 3 0
  [ "$status" -eq 1 ]; [[ "$output" == *"not enough disk for shard 2"* ]]
}
@test "wait_restore_start fails when the restore died silently" {
  echo "bash: restore.sh: No such file" > "$BATS_TMPDIR/dead.txt"
  run wait_restore_start "$BATS_TMPDIR/dead.txt" 3 0
  [ "$status" -eq 1 ]; [[ "$output" == *"No such file"* ]]
}
