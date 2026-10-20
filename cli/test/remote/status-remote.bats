setup() {
  F="$BATS_TEST_DIRNAME/fixtures"; R="$BATS_TEST_DIRNAME/../../remote/status-remote.sh"
  export FCX_ETC="$BATS_TMPDIR/etc"; mkdir -p "$FCX_ETC"; echo 0 > "$FCX_ETC/deadline"
  export FCX_LIB="$BATS_TEST_DIRNAME/../../remote/lib.sh" FCX_DF_CMD="echo 200 1300"
  export FCX_RESTORE_LOG="$BATS_TMPDIR/no-restore.log"
}
j() { echo "$output" | jq -r "$1"; }
@test "downloading" {
  FCX_LOGS_CMD="cat $F/log-downloading.txt" FCX_INFO_CMD=false run bash "$R"
  [ "$(j .phase)" = downloading ]; [ "$(j .chunk)" = 120 ]; [ "$(j .eta)" = 7h6m ]
}
@test "syncing" {
  FCX_LOGS_CMD="cat $F/log-running.txt" FCX_INFO_CMD="cat $F/info-syncing.json" run bash "$R"
  [ "$(j .phase)" = syncing ]; [ "$(j .max_block_delay)" = 5400 ]
}
@test "ready" {
  FCX_LOGS_CMD="cat $F/log-running.txt" FCX_INFO_CMD="cat $F/info-ready.json" run bash "$R"
  [ "$(j .phase)" = ready ]
}
@test "disk_full under 5 GB free" {
  FCX_DF_CMD="echo 1495 3" FCX_LOGS_CMD="cat $F/log-unpacking.txt" FCX_INFO_CMD=false run bash "$R"
  [ "$(j .phase)" = disk_full ]; [ "$(j .disk_free_gb)" = 3 ]
}
@test "ttl warn" {
  echo 1000 > "$FCX_ETC/deadline"
  FCX_NOW=100 FCX_LOGS_CMD="cat $F/log-running.txt" FCX_INFO_CMD="cat $F/info-ready.json" run bash "$R"
  [ "$(j .ttl)" = warn ]
}
@test "shard from genesis" {
  FCX_LOGS_CMD="cat $F/log-running.txt" FCX_INFO_CMD="cat $F/info-genesis.json" run bash "$R"
  [ "$(j .phase)" = shard_from_genesis ]; [ "$(j .stale_shard)" = 0 ]
}
@test "downloading during the fcx restore, before the container exists" {
  FCX_RESTORE_LOG="$F/restore-downloading.txt" FCX_LOGS_CMD=true FCX_INFO_CMD=false run bash "$R"
  [ "$(j .phase)" = downloading ]; [ "$(j .shard)" = 1 ]; [ "$(j .chunk)" = 1240 ]; [ "$(j .chunks)" = 2672 ]
  [ "$(j .eta)" = 0h56m ]
}
@test "unpacking during the fcx restore" {
  FCX_RESTORE_LOG="$F/restore-unpacking.txt" FCX_LOGS_CMD=true FCX_INFO_CMD=false run bash "$R"
  [ "$(j .phase)" = unpacking ]; [ "$(j .shard)" = 2 ]
}
@test "restore stopped carries the reason" {
  FCX_RESTORE_LOG="$F/restore-stopped.txt" FCX_LOGS_CMD=true FCX_INFO_CMD=false run bash "$R"
  [ "$(j .phase)" = restore_failed ]; [[ "$(j .detail)" == "not enough disk for shard 2"* ]]
}
@test "after the restore, the node's own state wins" {
  FCX_RESTORE_LOG="$F/restore-done.txt" FCX_LOGS_CMD="cat $F/log-running.txt" FCX_INFO_CMD="cat $F/info-syncing.json" run bash "$R"
  [ "$(j .phase)" = syncing ]; [ "$(j .detail)" = null ]
}
