setup() {
  export FCX_ETC="$BATS_TMPDIR/etc"; mkdir -p "$FCX_ETC"
  export FCX_LIB="$BATS_TEST_DIRNAME/../../remote/lib.sh"
  echo SECRET123 > "$FCX_ETC/token"; echo trial1 > "$FCX_ETC/name"
  export PATH="$BATS_TEST_DIRNAME/stubs:$PATH" STUB_LOG="$BATS_TMPDIR/curl.log"
  export FCX_SERVER_ID=7 HCLOUD_API=https://api.test/v1 FCX_SLEEP=0
  : > "$STUB_LOG"; S="$BATS_TEST_DIRNAME/../../remote/ttl-destroy.sh"
}
@test "nothing before deadline" { echo 5000 > "$FCX_ETC/deadline"; FCX_NOW=100 run bash "$S"; [ "$status" -eq 0 ]; [ ! -s "$STUB_LOG" ]; }
@test "nothing when TTL is 0"   { echo 0 > "$FCX_ETC/deadline"; FCX_NOW=999999 run bash "$S"; [ "$status" -eq 0 ]; [ ! -s "$STUB_LOG" ]; }
@test "warns in last 30 min" {
  echo 1000 > "$FCX_ETC/deadline"; FCX_NOW=100 run bash "$S"
  [[ "$output" == *"auto-destroy in 15 min"* ]]; [ ! -s "$STUB_LOG" ]
}
@test "after deadline: volume, firewall, server last" {
  echo 100 > "$FCX_ETC/deadline"; FCX_NOW=200 run bash "$S"; [ "$status" -eq 0 ]
  run cat "$STUB_LOG"
  [[ "${lines[0]}" == *"/volumes?label_selector=fcx=trial1"* ]]
  [[ "$output" == *"/volumes/11/actions/detach"* ]]
  [[ "$output" == *"-X DELETE https://api.test/v1/volumes/11"* ]]
  [[ "$output" == *"-X DELETE https://api.test/v1/firewalls/22"* ]]
  [[ "${lines[-1]}" == *"-X DELETE https://api.test/v1/servers/7"* ]]
}
@test "token never printed" { echo 100 > "$FCX_ETC/deadline"; FCX_NOW=200 run bash "$S"; [[ "$output" != *SECRET123* ]]; }
