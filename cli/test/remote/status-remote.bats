setup() {
  F="$BATS_TEST_DIRNAME/fixtures"; R="$BATS_TEST_DIRNAME/../../remote/status-remote.sh"
  export FCX_ETC="$BATS_TMPDIR/etc"; mkdir -p "$FCX_ETC"; echo 0 > "$FCX_ETC/deadline"
  export FCX_LIB="$BATS_TEST_DIRNAME/../../remote/lib.sh" FCX_DF_CMD="echo 200 1300"
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
