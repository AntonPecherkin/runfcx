# The node must never run upstream's own restore: fcx restores first. A second safeguard on top of
# a non-empty .rocks: snapchain reads SNAPCHAIN_* env over config.toml (figment, "__" nests).
@test "compose override turns off upstream's snapshot load" {
  grep -qE '^\s+SNAPCHAIN_SNAPSHOT__LOAD_DB_FROM_SNAPSHOT: "false"$' "$BATS_TEST_DIRNAME/../../remote/docker-compose.override.yml"
}
