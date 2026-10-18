# Plan 1: Infra Scripts + Run 1 — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Commands (0) and (1): provision a Hetzner server (or use your own box), run an upstream Snapchain read node on it, report sync progress, auto-destroy on a TTL. Then do run 1 and record real numbers and API fixtures.

**Architecture:** Bash scripts on the laptop (`infra/*.sh`) drive the `hcloud` CLI and SSH. Pure logic (TTL parsing, phase detection, readiness) lives in `infra/lib.sh` and is unit-tested with bats. Remote work runs as uploaded scripts (`infra/remote/*.sh`). The node itself is the untouched upstream `snapchain.sh` at a pinned tag, configured through `.env` and a `docker-compose.override.yml` that binds every port except gossip to 127.0.0.1.

**Tech Stack:** bash 5, jq, hcloud CLI, ssh/scp, cloud-init, cron, bats-core, shellcheck. Upstream: `farcasterxyz/snapchain` tag `v0.14.3`.

**Spec:** `docs/superpowers/specs/2026-10-18-farcaster-3-commands-design.md`

## Global Constraints

- No API keys for the node. The only credential is the user's own Hetzner token, used for provisioning and the TTL.
- Trial mode needs a **dedicated Hetzner project** (tokens are project-wide).
- Public inbound ports: **22/tcp from the caller's IP only** and **3382/udp** (gossip, QUIC). Everything else (3381 HTTP, 3383 gRPC, 3000 Grafana, 8125/8126 statsd) is bound to 127.0.0.1 and reached through SSH.
- Upstream `snapchain.sh` pinned to tag `v0.14.3`, sha256 `cdeb51daf31ac01f25b4be3857eeec41e2e4685ca6e77e5f52959cb8065f553a`, `SKIP_SELF_UPGRADE=true`. The compose file and Docker image still follow upstream `@latest` (needed to follow network upgrades); the tutorial says so.
- Volume: 1500 GB. Server type default `ccx23` (4 dedicated vCPU, 16 GB). Image `ubuntu-24.04`.
- Every Hetzner resource gets label `fcx=<name>`. `destroy.sh` and the TTL find resources only by that label.
- No interactive prompts in remote scripts (they run under agents). Human-only steps print what to do and exit non-zero.
- Writing rules for all user-facing output: short sentences, no hype, no "not X, but Y".

## Review Focus

1. **Laptop IP changes mid-run** (wifi switch, VPN): SSH is blocked by the firewall. Expected: `status.sh` says "SSH blocked — your IP changed. Run `./infra/allow-ip.sh`" instead of hanging. → test in Task 5.
2. **TTL fires while the user is mid-session.** Expected: a warning 30 min before, and `extend.sh 4h` works. → test in Task 2.
3. **Re-running `provision.sh` with the same name** after a partial failure. Expected: reuse existing labelled resources or tell the user to run `destroy.sh` first, never create duplicates silently. → test in Task 3.
4. **`node.sh` run twice** (agent retries). Expected: idempotent; it detects a running node and goes straight to progress. → test in Task 4.
5. **Disk fills during snapshot unpack.** Expected: `status.sh` reports `disk_full` with free bytes, not "syncing" forever. → test in Task 5.

---

## File Structure

```
infra/
  lib.sh                    # pure functions: parse_ttl, ttl_state, detect_phase, info_ready, ip_cidr
  provision.sh              # (0) Hetzner create  |  --host user@box
  node.sh                   # (1) upload + start node, then wait (unless --no-wait)
  status.sh                 # progress, phase, disk, TTL  [--json]
  extend.sh                 # push the TTL deadline out
  allow-ip.sh               # update firewall SSH rule to current IP
  destroy.sh                # delete everything with label fcx=<name>
  remote/
    ttl-destroy.sh          # runs on the server from cron; deletes own resources via API
    node-setup.sh           # runs on the server: mount, .env, pinned snapchain.sh, start
    status-remote.sh        # runs on the server: emits one JSON object
    docker-compose.override.yml
  templates/cloud-init.yaml.tpl
test/infra/
  lib.bats
  ttl-destroy.bats
  provision.bats
  destroy.bats
  status.bats
  fixtures/
    log-downloading.txt  log-unzipping.txt  log-unpacking.txt  log-running.txt
    info-syncing.json    info-ready.json
  stubs/                    # fake hcloud, curl, ssh for tests
.fcx/                       # local state, gitignored: state.env per run
docs/runs/run-1.md          # measured results
client/test/fixtures/node/  # real API responses recorded in run 1
```

---

### Task 1: Repo scaffold + `lib.sh` pure functions

**Files:**
- Create: `LICENSE` (MIT), `.gitignore`, `README.md` (one paragraph + quickstart placeholder line linking to the site — filled in Plan 3), `infra/lib.sh`, `test/infra/lib.bats`, `test/infra/fixtures/*`

**Interfaces:**
- Produces (sourced by every script):
  - `parse_ttl <str>` → prints seconds; accepts `90m`, `8h`, `2d`, `0` (= no TTL); exit 1 on anything else.
  - `ttl_state <deadline_epoch> <now_epoch>` → prints `none` (deadline 0), `ok`, `warn` (≤1800 s left), `expired`.
  - `detect_phase <logfile>` → prints one line: `<phase> <shard> <i> <n> <eta>` where phase ∈ `starting|downloading|unzipping|unpacking|running`; unknown fields are `-`.
  - `info_ready <info.json> <max_delay>` → exit 0 if every shard in `.shardInfos` has `blockDelay <= max_delay`; prints max delay.
  - `ip_cidr <ip>` → `1.2.3.4/32` or `2001:db8::1/128`.
  - `die <msg>` → prints `error: <msg>` to stderr, exit 1.

- [ ] **Step 1: Install tools**

```bash
brew install bats-core shellcheck hcloud
```

- [ ] **Step 2: Scaffold**

`.gitignore`:
```
.fcx/
node_modules/
dist/
.DS_Store
```

`LICENSE`: standard MIT text, `Copyright (c) 2026 <owner>` (owner name decided in spec open items; use the GitHub owner once chosen).

- [ ] **Step 3: Write fixtures (formats copied from `src/storage/db/snapshot.rs` at v0.14.3)**

`test/infra/fixtures/log-downloading.txt`:
```
snapchain-1  | 2026-10-18T10:00:01Z INFO snapchain::storage::db::snapshot: Downloading snapshots (legacy method)
snapchain-1  | 2026-10-18T10:00:05Z INFO snapchain::storage::db::snapshot: Downloading zipped snapshot chunk chunk_0001.bin for shard 1 (1/2671 chunks in shard) 
snapchain-1  | 2026-10-18T10:20:05Z INFO snapchain::storage::db::snapshot: Downloading zipped snapshot chunk chunk_0120.bin for shard 1 (120/2671 chunks in shard) Shard ETA: 7h6m
```

`test/infra/fixtures/log-unzipping.txt`:
```
snapchain-1  | 2026-10-18T12:00:05Z INFO snapchain::storage::db::snapshot: Downloading zipped snapshot chunk chunk_2671.bin for shard 1 (2671/2671 chunks in shard) Shard ETA: 0h0m
snapchain-1  | 2026-10-18T12:00:09Z INFO snapchain::storage::db::snapshot: Unzipping snapshot chunk .rocks.snapshot/shard-1/chunk_0042.bin for shard 1
```

`test/infra/fixtures/log-unpacking.txt`:
```
snapchain-1  | 2026-10-18T12:30:00Z INFO snapchain::storage::db::snapshot: Unpacking snapshot file .rocks.snapshot/shard_1_snapshot.tar for shard 1
```

`test/infra/fixtures/log-running.txt`:
```
snapchain-1  | 2026-10-18T14:00:00Z INFO snapchain: Starting node
```

`test/infra/fixtures/info-syncing.json`:
```json
{"dbStats":{"numMessages":1,"numFidRegistrations":1,"approxSize":1},"numShards":2,"shardInfos":[{"shardId":0,"maxHeight":100,"numMessages":0,"numFidRegistrations":0,"approxSize":0,"blockDelay":3,"mempoolSize":0},{"shardId":1,"maxHeight":200,"numMessages":0,"numFidRegistrations":0,"approxSize":0,"blockDelay":5400,"mempoolSize":4294967295},{"shardId":2,"maxHeight":200,"numMessages":0,"numFidRegistrations":0,"approxSize":0,"blockDelay":12,"mempoolSize":4294967295}]}
```

`test/infra/fixtures/info-ready.json`: same as above with all `blockDelay` values `2`.

- [ ] **Step 4: Write failing tests** — `test/infra/lib.bats`:

```bash
setup() { source "$BATS_TEST_DIRNAME/../../infra/lib.sh"; F="$BATS_TEST_DIRNAME/fixtures"; }

@test "parse_ttl accepts m/h/d and 0" {
  [ "$(parse_ttl 90m)" = 5400 ]
  [ "$(parse_ttl 8h)" = 28800 ]
  [ "$(parse_ttl 2d)" = 172800 ]
  [ "$(parse_ttl 0)" = 0 ]
}
@test "parse_ttl rejects junk" {
  run parse_ttl 8x;   [ "$status" -eq 1 ]
  run parse_ttl "";   [ "$status" -eq 1 ]
  run parse_ttl -1h;  [ "$status" -eq 1 ]
}
@test "ttl_state" {
  [ "$(ttl_state 0 100)" = none ]
  [ "$(ttl_state 5000 100)" = ok ]
  [ "$(ttl_state 1900 100)" = warn ]
  [ "$(ttl_state 100 100)" = expired ]
}
@test "detect_phase downloading" {
  [ "$(detect_phase "$F/log-downloading.txt")" = "downloading 1 120 2671 7h6m" ]
}
@test "detect_phase unzipping" {
  [ "$(detect_phase "$F/log-unzipping.txt")" = "unzipping 1 - - -" ]
}
@test "detect_phase unpacking" {
  [ "$(detect_phase "$F/log-unpacking.txt")" = "unpacking 1 - - -" ]
}
@test "detect_phase running and empty" {
  [ "$(detect_phase "$F/log-running.txt")" = "running - - - -" ]
  : > "$BATS_TMPDIR/empty.txt"
  [ "$(detect_phase "$BATS_TMPDIR/empty.txt")" = "starting - - - -" ]
}
@test "info_ready" {
  run info_ready "$F/info-syncing.json" 10; [ "$status" -eq 1 ]; [ "$output" = 5400 ]
  run info_ready "$F/info-ready.json" 10;   [ "$status" -eq 0 ]; [ "$output" = 2 ]
}
@test "ip_cidr" {
  [ "$(ip_cidr 1.2.3.4)" = 1.2.3.4/32 ]
  [ "$(ip_cidr 2001:db8::1)" = 2001:db8::1/128 ]
}
```

- [ ] **Step 5: Run — expect FAIL** (`bats test/infra/lib.bats` → "lib.sh: No such file").

- [ ] **Step 6: Implement `infra/lib.sh`**

```bash
#!/usr/bin/env bash
# Shared helpers. Pure functions only; no network, no hcloud.

die() { echo "error: $*" >&2; exit 1; }

parse_ttl() {
  local s="$1"
  [[ "$s" == 0 ]] && { echo 0; return 0; }
  [[ "$s" =~ ^([0-9]+)([mhd])$ ]] || return 1
  local n="${BASH_REMATCH[1]}" u="${BASH_REMATCH[2]}"
  case "$u" in m) echo $((n * 60)) ;; h) echo $((n * 3600)) ;; d) echo $((n * 86400)) ;; esac
}

ttl_state() {
  local deadline="$1" now="$2"
  if (( deadline == 0 )); then echo none
  elif (( now >= deadline )); then echo expired
  elif (( deadline - now <= 1800 )); then echo warn
  else echo ok; fi
}

# Reads docker logs of the snapchain container; reports the latest snapshot phase.
detect_phase() {
  local log="$1" line
  line=$(grep -E 'Downloading zipped snapshot chunk|Unzipping snapshot chunk|Unpacking snapshot file|Starting node' "$log" | tail -n 1)
  if [[ -z "$line" ]]; then echo "starting - - - -"
  elif [[ "$line" =~ Downloading\ zipped\ snapshot\ chunk\ [^ ]+\ for\ shard\ ([0-9]+)\ \(([0-9]+)/([0-9]+)\ chunks\ in\ shard\)\ ?(Shard\ ETA:\ ([0-9]+h[0-9]+m))? ]]; then
    echo "downloading ${BASH_REMATCH[1]} ${BASH_REMATCH[2]} ${BASH_REMATCH[3]} ${BASH_REMATCH[5]:--}"
  elif [[ "$line" =~ Unzipping\ snapshot\ chunk\ .*\ for\ shard\ ([0-9]+) ]]; then
    echo "unzipping ${BASH_REMATCH[1]} - - -"
  elif [[ "$line" =~ Unpacking\ snapshot\ file\ .*\ for\ shard\ ([0-9]+) ]]; then
    echo "unpacking ${BASH_REMATCH[1]} - - -"
  else echo "running - - - -"; fi
}

info_ready() {
  local f="$1" max="$2" worst
  worst=$(jq '[.shardInfos[].blockDelay] | max' "$f") || return 2
  echo "$worst"
  (( worst <= max ))
}

ip_cidr() { [[ "$1" == *:* ]] && echo "$1/128" || echo "$1/32"; }
```

- [ ] **Step 7: Run — expect PASS.** `bats test/infra/lib.bats && shellcheck infra/lib.sh`

- [ ] **Step 8: Commit**

```bash
git add LICENSE .gitignore README.md infra/lib.sh test/infra
git commit -m "feat(infra): scaffold and pure helpers for TTL, phase, readiness"
```

---

### Task 2: On-server TTL destroy + `extend.sh`

**Files:**
- Create: `infra/remote/ttl-destroy.sh`, `infra/extend.sh`, `test/infra/ttl-destroy.bats`, `test/infra/stubs/curl`

**Interfaces:**
- Consumes: `parse_ttl`, `ttl_state`, `die` from `infra/lib.sh` (copied to the server as `/etc/fcx/lib.sh`).
- Produces:
  - Server files: `/etc/fcx/token` (0600), `/etc/fcx/name`, `/etc/fcx/deadline` (epoch, 0 = none), `/etc/fcx/lib.sh`, `/usr/local/bin/fcx-ttl-destroy`.
  - Cron line: `*/5 * * * * root /usr/local/bin/fcx-ttl-destroy >> /var/log/fcx-ttl.log 2>&1`.
  - `ttl-destroy.sh` env overrides for tests: `FCX_ETC` (default `/etc/fcx`), `HCLOUD_API` (default `https://api.hetzner.cloud/v1`), `FCX_NOW` (default `date +%s`), `FCX_SERVER_ID` (default from `http://169.254.169.254/hetzner/v1/metadata/instance-id`).
  - `extend.sh <ttl>` → sets deadline to now + ttl on the server (via `state.env`, Task 3).

- [ ] **Step 1: Write the curl stub** — `test/infra/stubs/curl` logs every call and returns canned JSON:

```bash
#!/usr/bin/env bash
echo "$*" >> "$STUB_LOG"
case "$*" in
  *"/volumes?label_selector"*)   echo '{"volumes":[{"id":11,"server":7}]}' ;;
  *"/firewalls?label_selector"*) echo '{"firewalls":[{"id":22}]}' ;;
  *) echo '{}' ;;
esac
```

- [ ] **Step 2: Write failing tests** — `test/infra/ttl-destroy.bats`:

```bash
setup() {
  export FCX_ETC="$BATS_TMPDIR/etc"; mkdir -p "$FCX_ETC"
  cp "$BATS_TEST_DIRNAME/../../infra/lib.sh" "$FCX_ETC/lib.sh"
  echo SECRET123 > "$FCX_ETC/token"; echo trial1 > "$FCX_ETC/name"
  export PATH="$BATS_TEST_DIRNAME/stubs:$PATH" STUB_LOG="$BATS_TMPDIR/curl.log" FCX_SERVER_ID=7
  export HCLOUD_API=https://api.test/v1 FCX_SLEEP=0
  : > "$STUB_LOG"
  S="$BATS_TEST_DIRNAME/../../infra/remote/ttl-destroy.sh"
}
@test "does nothing before deadline" {
  echo 5000 > "$FCX_ETC/deadline"; FCX_NOW=100 run bash "$S"
  [ "$status" -eq 0 ]; [ ! -s "$STUB_LOG" ]
}
@test "does nothing when TTL is 0" {
  echo 0 > "$FCX_ETC/deadline"; FCX_NOW=999999 run bash "$S"
  [ ! -s "$STUB_LOG" ]
}
@test "warns once in the last 30 minutes" {
  echo 1000 > "$FCX_ETC/deadline"; FCX_NOW=100 run bash "$S"
  [[ "$output" == *"auto-destroy in 15 min"* ]]; [ ! -s "$STUB_LOG" ]
}
@test "after deadline deletes volume, firewall, then server last" {
  echo 100 > "$FCX_ETC/deadline"; FCX_NOW=200 run bash "$S"
  [ "$status" -eq 0 ]
  run cat "$STUB_LOG"
  [[ "${lines[0]}" == *"/volumes?label_selector=fcx=trial1"* ]]
  [[ "$output" == *"/volumes/11/actions/detach"* ]]
  [[ "$output" == *"-X DELETE https://api.test/v1/volumes/11"* ]]
  [[ "$output" == *"/firewalls/22/actions/remove_from_resources"* ]]
  [[ "$output" == *"-X DELETE https://api.test/v1/firewalls/22"* ]]
  [[ "${lines[-1]}" == *"-X DELETE https://api.test/v1/servers/7"* ]]
}
@test "token is never printed" {
  echo 100 > "$FCX_ETC/deadline"; FCX_NOW=200 run bash "$S"
  [[ "$output" != *SECRET123* ]]
}
```

- [ ] **Step 3: Run — expect FAIL.**

- [ ] **Step 4: Implement `infra/remote/ttl-destroy.sh`**

```bash
#!/usr/bin/env bash
# Runs from cron on the server. Deletes this run's Hetzner resources after the deadline.
set -euo pipefail
ETC="${FCX_ETC:-/etc/fcx}"
API="${HCLOUD_API:-https://api.hetzner.cloud/v1}"
# shellcheck source=/dev/null
source "$ETC/lib.sh"

now="${FCX_NOW:-$(date +%s)}"
deadline=$(cat "$ETC/deadline")
name=$(cat "$ETC/name")
state=$(ttl_state "$deadline" "$now")

case "$state" in
  none|ok) exit 0 ;;
  warn)
    msg="fcx: auto-destroy in $(( (deadline - now) / 60 )) min. Extend with ./infra/extend.sh 4h"
    echo "$msg"; wall "$msg" 2>/dev/null || true; exit 0 ;;
esac

auth=(-H "Authorization: Bearer $(cat "$ETC/token")" -H "Content-Type: application/json")
api() { curl -fsS "${auth[@]}" "$@"; }
server_id="${FCX_SERVER_ID:-$(curl -fsS http://169.254.169.254/hetzner/v1/metadata/instance-id)}"

echo "fcx: deadline passed, destroying run '$name'"
for vid in $(api "$API/volumes?label_selector=fcx=$name" | jq -r '.volumes[].id'); do
  api -X POST "$API/volumes/$vid/actions/detach" >/dev/null || true
  sleep "${FCX_SLEEP:-15}"
  api -X DELETE "$API/volumes/$vid" >/dev/null || true
done
for fid in $(api "$API/firewalls?label_selector=fcx=$name" | jq -r '.firewalls[].id'); do
  api -X POST "$API/firewalls/$fid/actions/remove_from_resources" \
    -d "{\"remove_from\":[{\"type\":\"server\",\"server\":{\"id\":$server_id}}]}" >/dev/null || true
  sleep "${FCX_SLEEP:-5}"
  api -X DELETE "$API/firewalls/$fid" >/dev/null || true
done
api -X DELETE "$API/servers/$server_id" >/dev/null
```

Note: the stub ignores `-H` order; tests match on URL and `-X DELETE <url>` because `api` passes `-X DELETE` immediately before the URL.

- [ ] **Step 5: Implement `infra/extend.sh`**

```bash
#!/usr/bin/env bash
# Usage: ./infra/extend.sh 4h   — moves the auto-destroy deadline to now + 4h.
set -euo pipefail
cd "$(dirname "$0")/.."
source infra/lib.sh
source .fcx/state.env 2>/dev/null || die "no run found. Run ./infra/provision.sh first."
secs=$(parse_ttl "${1:-}") || die "usage: ./infra/extend.sh <90m|8h|2d|0>"
new=$(( secs == 0 ? 0 : $(date +%s) + secs ))
ssh "${SSH_OPTS[@]}" "$SSH_TARGET" "echo $new | sudo tee /etc/fcx/deadline >/dev/null"
if (( new == 0 )); then echo "Auto-destroy is off. Remember ./infra/destroy.sh."
else echo "Auto-destroy at $(date -r "$new" '+%a %H:%M' 2>/dev/null || date -d "@$new" '+%a %H:%M')."; fi
```

- [ ] **Step 6: Run — expect PASS.** `bats test/infra/ttl-destroy.bats && shellcheck infra/remote/ttl-destroy.sh infra/extend.sh`

- [ ] **Step 7: Commit**

```bash
git add infra/remote/ttl-destroy.sh infra/extend.sh test/infra/ttl-destroy.bats test/infra/stubs/curl
git commit -m "feat(infra): on-server TTL auto-destroy and extend"
```

---

### Task 3: `provision.sh` (Hetzner + `--host`) and cloud-init

**Files:**
- Create: `infra/provision.sh`, `infra/allow-ip.sh`, `infra/templates/cloud-init.yaml.tpl`, `test/infra/provision.bats`, `test/infra/stubs/hcloud`

**Interfaces:**
- Consumes: `parse_ttl`, `ip_cidr`, `die` (lib.sh); `infra/remote/ttl-destroy.sh` (Task 2).
- Produces: `.fcx/state.env` with:
  ```
  NAME=trial-20261018-1012
  MODE=hetzner            # or host
  SSH_TARGET=root@1.2.3.4
  SSH_OPTS=(-o StrictHostKeyChecking=accept-new -o ConnectTimeout=10 -i ~/.ssh/fcx_ed25519)
  DATA_DIR=/mnt/fcx       # where ~/snapchain lives on the box
  DEADLINE=1792300000     # 0 = none
  ```
- CLI:
  ```
  ./infra/provision.sh [--ttl 8h] [--name N] [--type ccx23] [--location fsn1] [--keep]
  ./infra/provision.sh --host user@box [--data-dir /path]
  ```
  `--keep` = `--ttl 0` (persistent). Default TTL `8h`.
- Token: read from env `HCLOUD_TOKEN`, else from `~/.config/fcx/hcloud-token` (0600). Never printed, never passed on the command line.

- [ ] **Step 1: Write the hcloud stub** — `test/infra/stubs/hcloud`: logs args to `$STUB_LOG`; returns `1.2.3.4` for `server ip`, `[]` for `server list -o json` unless `$STUB_EXISTING=1`, then `[{"id":7,"name":"trial1"}]`; exit 0 otherwise.

```bash
#!/usr/bin/env bash
echo "hcloud $*" >> "$STUB_LOG"
case "$*" in
  "server list"*) [[ "${STUB_EXISTING:-0}" == 1 ]] && echo '[{"id":7,"name":"trial1"}]' || echo '[]' ;;
  "server ip"*) echo 1.2.3.4 ;;
  "firewall describe"*|"volume describe"*) echo '{"id":11}' ;;
esac
exit 0
```

- [ ] **Step 2: Write failing tests** — `test/infra/provision.bats`:

```bash
setup() {
  export PATH="$BATS_TEST_DIRNAME/stubs:$PATH" STUB_LOG="$BATS_TMPDIR/hc.log" HCLOUD_TOKEN=SECRET123
  export FCX_MY_IP=5.6.7.8 FCX_SKIP_WAIT=1 FCX_ROOT="$BATS_TMPDIR/repo" FCX_SSH_KEY="$BATS_TMPDIR/key"
  rm -rf "$FCX_ROOT"; mkdir -p "$FCX_ROOT"; cp -R "$BATS_TEST_DIRNAME/../../infra" "$FCX_ROOT/"
  : > "$STUB_LOG"; P="$FCX_ROOT/infra/provision.sh"
}
@test "creates labelled firewall, server, volume with locked-down rules" {
  run bash "$P" --name trial1 --ttl 2h
  [ "$status" -eq 0 ]
  run cat "$STUB_LOG"
  [[ "$output" == *"firewall create --name fcx-trial1 --label fcx=trial1"* ]]
  [[ "$output" == *"--protocol tcp --port 22 --source-ips 5.6.7.8/32"* ]]
  [[ "$output" == *"--protocol udp --port 3382 --source-ips 0.0.0.0/0 --source-ips ::/0"* ]]
  [[ "$output" != *"--port 3381"* ]]
  [[ "$output" != *"--port 3383"* ]]
  [[ "$output" == *"server create --name fcx-trial1 --type ccx23 --image ubuntu-24.04"* ]]
  [[ "$output" == *"volume create --name fcx-trial1 --size 1500 --server fcx-trial1 --automount --format ext4 --label fcx=trial1"* ]]
}
@test "writes state.env with TTL deadline" {
  run bash "$P" --name trial1 --ttl 2h
  grep -q '^NAME=trial1$' "$FCX_ROOT/.fcx/state.env"
  grep -q '^SSH_TARGET=root@1.2.3.4$' "$FCX_ROOT/.fcx/state.env"
  grep -qE '^DEADLINE=[1-9][0-9]+$' "$FCX_ROOT/.fcx/state.env"
}
@test "token never appears in hcloud args or output" {
  run bash "$P" --name trial1
  [[ "$output" != *SECRET123* ]]; ! grep -q SECRET123 "$STUB_LOG"
}
@test "refuses to duplicate an existing run" {
  STUB_EXISTING=1 run bash "$P" --name trial1
  [ "$status" -eq 1 ]; [[ "$output" == *"already exists"*"destroy.sh"* ]]
}
@test "rejects bad ttl" {
  run bash "$P" --ttl soon; [ "$status" -eq 1 ]
}
@test "--keep means no deadline" {
  run bash "$P" --name trial1 --keep
  grep -q '^DEADLINE=0$' "$FCX_ROOT/.fcx/state.env"
}
@test "--keep puts no token on the server" {
  FCX_KEEP_USERDATA="$BATS_TMPDIR/ud.yaml" run bash "$P" --name trial1 --keep
  ! grep -q "fcx/token" "$BATS_TMPDIR/ud.yaml"
  ! grep -q "fcx-ttl" "$BATS_TMPDIR/ud.yaml"
}
@test "--host mode creates nothing in Hetzner" {
  FCX_HOST_CHECK=skip run bash "$P" --host ubuntu@9.9.9.9
  [ "$status" -eq 0 ]; [ ! -s "$STUB_LOG" ]
  grep -q '^MODE=host$' "$FCX_ROOT/.fcx/state.env"
}
```

- [ ] **Step 3: Run — expect FAIL.**

- [ ] **Step 4: Write `infra/templates/cloud-init.yaml.tpl`** (placeholders `@NAME@`, `@DEADLINE@`, `@TOKEN_B64@`, `@LIB_B64@`, `@TTL_B64@` are replaced by `provision.sh` with `sed`; base64 avoids YAML quoting problems):

```yaml
#cloud-config
package_update: true
packages: [jq, curl, cron]
write_files:
  - path: /etc/fcx/name
    content: "@NAME@\n"
  - path: /etc/fcx/deadline
    content: "@DEADLINE@\n"
  # TTL-BEGIN
  - path: /etc/fcx/token
    permissions: "0600"
    encoding: b64
    content: "@TOKEN_B64@"
  - path: /etc/fcx/lib.sh
    encoding: b64
    content: "@LIB_B64@"
  - path: /usr/local/bin/fcx-ttl-destroy
    permissions: "0755"
    encoding: b64
    content: "@TTL_B64@"
  - path: /etc/cron.d/fcx-ttl
    content: "*/5 * * * * root /usr/local/bin/fcx-ttl-destroy >> /var/log/fcx-ttl.log 2>&1\n"
  # TTL-END
```

- [ ] **Step 5: Implement `infra/provision.sh`**

```bash
#!/usr/bin/env bash
# (0) Get a server. Default: Hetzner Cloud, auto-destroy after 8h.
set -euo pipefail
ROOT="${FCX_ROOT:-$(cd "$(dirname "$0")/.." && pwd)}"; cd "$ROOT"
source infra/lib.sh

ttl=8h name="trial-$(date +%Y%m%d-%H%M)" type=ccx23 location=fsn1 host="" data_dir=""
while (( $# )); do case "$1" in
  --ttl) ttl="$2"; shift 2 ;;  --keep) ttl=0; shift ;;
  --name) name="$2"; shift 2 ;; --type) type="$2"; shift 2 ;;
  --location) location="$2"; shift 2 ;;
  --host) host="$2"; shift 2 ;; --data-dir) data_dir="$2"; shift 2 ;;
  *) die "unknown option $1" ;; esac; done
secs=$(parse_ttl "$ttl") || die "bad --ttl '$ttl'. Use 90m, 8h, 2d or 0."
mkdir -p .fcx
key="${FCX_SSH_KEY:-$HOME/.ssh/fcx_ed25519}"
[[ -f $key ]] || ssh-keygen -q -t ed25519 -N "" -f "$key" -C fcx

write_state() {  # $1 mode, $2 target, $3 data dir, $4 deadline
  cat > .fcx/state.env <<EOF
NAME=$name
MODE=$1
SSH_TARGET=$2
SSH_OPTS=(-o StrictHostKeyChecking=accept-new -o ConnectTimeout=10 -i $key)
DATA_DIR=$3
DEADLINE=$4
EOF
}

if [[ -n "$host" ]]; then
  [[ "${FCX_HOST_CHECK:-}" == skip ]] || infra/remote/host-check.sh "$host" "$key" "${data_dir:-/mnt/fcx}"
  write_state host "$host" "${data_dir:-/mnt/fcx}" 0
  echo "Using your server $host. Next: ./infra/node.sh"; exit 0
fi

token="${HCLOUD_TOKEN:-$(cat ~/.config/fcx/hcloud-token 2>/dev/null || true)}"
[[ -n "$token" ]] || die "no Hetzner token. Create one in a NEW project (Security → API tokens, Read & Write),
then save it:  mkdir -p ~/.config/fcx && pbpaste > ~/.config/fcx/hcloud-token && chmod 600 ~/.config/fcx/hcloud-token"
export HCLOUD_TOKEN="$token"

[[ "$(hcloud server list -l "fcx=$name" -o json)" == "[]" ]] \
  || die "run '$name' already exists. Use it, or run ./infra/destroy.sh first."

my_ip="${FCX_MY_IP:-$(curl -fsS https://api.ipify.org)}"
deadline=$(( secs == 0 ? 0 : $(date +%s) + secs ))
b64() { base64 < "$1" | tr -d '\n'; }
ud=$(mktemp)
sed -e "s|@NAME@|$name|" -e "s|@DEADLINE@|$deadline|" \
    -e "s|@TOKEN_B64@|$(printf %s "$token" | base64 | tr -d '\n')|" \
    -e "s|@LIB_B64@|$(b64 infra/lib.sh)|" -e "s|@TTL_B64@|$(b64 infra/remote/ttl-destroy.sh)|" \
    infra/templates/cloud-init.yaml.tpl > "$ud"
if (( secs == 0 )); then sed -i.bak '/# TTL-BEGIN/,/# TTL-END/d' "$ud"; fi

echo "Creating firewall, server ($type, $location) and 1.5 TB volume…"
hcloud ssh-key describe fcx >/dev/null 2>&1 || hcloud ssh-key create --name fcx --public-key-from-file "$key.pub" >/dev/null
hcloud firewall create --name "fcx-$name" --label "fcx=$name" >/dev/null
hcloud firewall add-rule "fcx-$name" --direction in --protocol tcp --port 22 --source-ips "$(ip_cidr "$my_ip")" >/dev/null
hcloud firewall add-rule "fcx-$name" --direction in --protocol udp --port 3382 --source-ips 0.0.0.0/0 --source-ips ::/0 >/dev/null
hcloud server create --name "fcx-$name" --type "$type" --image ubuntu-24.04 --location "$location" \
  --ssh-key fcx --firewall "fcx-$name" --label "fcx=$name" --user-data-from-file "$ud" >/dev/null
hcloud volume create --name "fcx-$name" --size 1500 --server "fcx-$name" --automount --format ext4 --label "fcx=$name" >/dev/null
[[ -n "${FCX_KEEP_USERDATA:-}" ]] && cp "$ud" "$FCX_KEEP_USERDATA"
rm -f "$ud" "$ud.bak"

ip=$(hcloud server ip "fcx-$name")
write_state hetzner "root@$ip" /mnt/fcx "$deadline"
[[ -n "${FCX_SKIP_WAIT:-}" ]] || until ssh -o StrictHostKeyChecking=accept-new -o ConnectTimeout=5 -i "$key" "root@$ip" true 2>/dev/null; do sleep 5; done
echo "Server ready at $ip."
(( deadline == 0 )) && echo "No auto-destroy. You pay until you run ./infra/destroy.sh." \
                    || echo "Auto-destroy in $ttl. Extend: ./infra/extend.sh 4h"
echo "Next: ./infra/node.sh"
```

Notes for the implementer:
- `--keep` deletes the `# TTL-BEGIN … # TTL-END` block (token, TTL script, cron) from cloud-init, so a persistent server never holds the API token.
- `sed -i.bak` keeps it portable between macOS and Linux.
- The automounted volume lands at `/mnt/HC_Volume_<id>`; `node-setup.sh` (Task 4) symlinks it to `/mnt/fcx`.

- [ ] **Step 6: Implement `infra/remote/host-check.sh`** (bring-your-own-box; runs checks over SSH and prints a clear table, non-zero exit if a hard requirement fails):

```bash
#!/usr/bin/env bash
# Usage: host-check.sh user@box keyfile data_dir
set -euo pipefail
host="$1" key="$2" dir="$3"
out=$(ssh -o StrictHostKeyChecking=accept-new -i "$key" "$host" \
  "nproc; free -g | awk '/Mem:/{print \$2}'; mkdir -p $dir && df -BG --output=avail $dir | tail -1 | tr -dc 0-9; echo; lsb_release -is 2>/dev/null || echo unknown")
read -r cpus ram disk os <<<"$(echo "$out" | tr '\n' ' ')"
fail=0
check() { if (( $2 >= $3 )); then echo "ok    $1: $2 (need $3)"; else echo "FAIL  $1: $2 (need $3)"; fail=1; fi; }
check "CPUs" "$cpus" 4
check "RAM GB" "$ram" 15
check "Free disk GB in $dir" "$disk" 1400
[[ "$os" == Ubuntu || "$os" == Debian ]] || echo "warn  OS: $os (tested on Ubuntu 24.04)"
echo "note  Open UDP 3382 in your provider's firewall. Keep 3381/3383 closed; fcx uses an SSH tunnel."
exit $fail
```

- [ ] **Step 7: Implement `infra/allow-ip.sh`** (Review Focus 1):

```bash
#!/usr/bin/env bash
# Your IP changed? Re-allow SSH from your current IP.
set -euo pipefail
cd "$(dirname "$0")/.."; source infra/lib.sh; source .fcx/state.env
[[ "$MODE" == hetzner ]] || die "only for Hetzner runs."
export HCLOUD_TOKEN="${HCLOUD_TOKEN:-$(cat ~/.config/fcx/hcloud-token)}"
ip=$(ip_cidr "$(curl -fsS https://api.ipify.org)")
hcloud firewall replace-rules "fcx-$NAME" --rules-file <(jq -n --arg ip "$ip" '[
  {direction:"in",protocol:"tcp",port:"22",source_ips:[$ip]},
  {direction:"in",protocol:"udp",port:"3382",source_ips:["0.0.0.0/0","::/0"]}]') >/dev/null
echo "SSH allowed from $ip."
```

- [ ] **Step 8: Run — expect PASS.** `bats test/infra/provision.bats && shellcheck infra/*.sh infra/remote/*.sh`

- [ ] **Step 9: Commit**

```bash
git add infra test/infra
git commit -m "feat(infra): provision Hetzner run or bring-your-own host"
```

---

### Task 4: `node.sh` + `node-setup.sh` + compose override

**Files:**
- Create: `infra/node.sh`, `infra/remote/node-setup.sh`, `infra/remote/docker-compose.override.yml`

**Interfaces:**
- Consumes: `.fcx/state.env` (Task 3); `status.sh --json` (Task 5) for waiting.
- Produces: on the server, `$DATA_DIR/snapchain` with upstream files, `.env`, override; node running; `/root/snapchain` symlink.
- CLI: `./infra/node.sh [--no-wait]`. Exit 0 when ready (or immediately with `--no-wait` once started).

- [ ] **Step 1: Write `infra/remote/docker-compose.override.yml`** (binds everything except gossip to localhost; `!override` needs Docker Compose ≥ 2.24):

```yaml
services:
  snapchain:
    ports: !override
      - "127.0.0.1:3381:3381/tcp"
      - "3382:3382/udp"
      - "127.0.0.1:3383:3383/tcp"
  statsd:
    ports: !override
      - "127.0.0.1:8125:8125/udp"
      - "127.0.0.1:8126:8126"
  grafana:
    ports: !override
      - "127.0.0.1:3000:3000"
```

- [ ] **Step 2: Write `infra/remote/node-setup.sh`** (idempotent — Review Focus 4):

```bash
#!/usr/bin/env bash
# Runs on the server as root. Installs and starts the upstream read node. Safe to re-run.
set -euo pipefail
TAG=v0.14.3
SHA=cdeb51daf31ac01f25b4be3857eeec41e2e4685ca6e77e5f52959cb8065f553a
KEEP="${1:-no}"          # "yes" = persistent: allow upstream auto-upgrade cron
HOST_DIR="${2:-}"        # host mode: user-chosen data dir

cloud-init status --wait >/dev/null 2>&1 || true
command -v jq >/dev/null || { apt-get update -qq && apt-get install -y -qq jq curl; }

if [[ ! -e /mnt/fcx && -n "$HOST_DIR" && "$HOST_DIR" != /mnt/fcx ]]; then
  mkdir -p "$HOST_DIR" && ln -s "$HOST_DIR" /mnt/fcx
fi
if [[ ! -e /mnt/fcx ]]; then
  vol=$(ls -d /mnt/HC_Volume_* 2>/dev/null | head -1 || true)
  if [[ -n "$vol" ]]; then ln -s "$vol" /mnt/fcx; else mkdir -p /mnt/fcx; fi
fi
mkdir -p /mnt/fcx/snapchain
[[ -e /root/snapchain ]] || ln -s /mnt/fcx/snapchain /root/snapchain
cd /root/snapchain

if docker ps --format '{{.Names}}' 2>/dev/null | grep -q snapchain; then
  echo "Node already running."; exit 0
fi

curl -fsSL "https://raw.githubusercontent.com/farcasterxyz/snapchain/$TAG/scripts/snapchain.sh" -o snapchain.sh
echo "$SHA  snapchain.sh" | sha256sum -c --quiet || { echo "snapchain.sh checksum mismatch"; exit 1; }
chmod +x snapchain.sh

touch .env
add() { grep -q "^$1=" .env || echo "$1=$2" >> .env; }
add AGREE_NO_REWARDS_FOR_ME true
add HUB_OPERATOR_FID 0
add SKIP_SELF_UPGRADE true
[[ "$KEEP" == yes ]] || add SKIP_CRONTAB true

cp /opt/fcx/docker-compose.override.yml ./docker-compose.override.yml

# upstream "upgrade" ends with `logs -f`; run it detached and wait for its success line
nohup ./snapchain.sh upgrade </dev/null > install.log 2>&1 &
for _ in $(seq 1 180); do
  grep -q "Upgrade complete" install.log && { echo "Node started."; exit 0; }
  grep -qE "❌|checksum mismatch" install.log && { tail -20 install.log; exit 1; }
  sleep 5
done
echo "Install did not finish in 15 min. Last lines:"; tail -20 install.log; exit 1
```

- [ ] **Step 3: Write `infra/node.sh`**

```bash
#!/usr/bin/env bash
# (1) Install and start the Snapchain read node, then wait until it is synced.
set -euo pipefail
cd "$(dirname "$0")/.."; source infra/lib.sh
source .fcx/state.env 2>/dev/null || die "no server yet. Run ./infra/provision.sh first."
wait=yes keep=no
for a in "$@"; do case "$a" in --no-wait) wait=no ;; *) die "unknown option $a" ;; esac; done
(( DEADLINE == 0 )) && keep=yes

ssh "${SSH_OPTS[@]}" "$SSH_TARGET" "sudo mkdir -p /opt/fcx && sudo chown \$(id -u) /opt/fcx"
scp -q "${SSH_OPTS[@]}" infra/remote/node-setup.sh infra/remote/docker-compose.override.yml \
  infra/remote/status-remote.sh infra/lib.sh "$SSH_TARGET:/opt/fcx/"
ssh "${SSH_OPTS[@]}" "$SSH_TARGET" "sudo bash /opt/fcx/node-setup.sh $keep ${DATA_DIR:-}"

[[ "$wait" == yes ]] || { echo "Started. Check progress: ./infra/status.sh"; exit 0; }
echo "Syncing. This takes a few hours. Safe to Ctrl-C; the node keeps going."
while true; do
  line=$(infra/status.sh --line) || true
  printf '\r\033[K%s' "$line"
  [[ "$line" == ready* ]] && { echo; echo "Node is synced. Next: npx fcx login"; exit 0; }
  [[ "$line" == error* ]] && { echo; exit 1; }
  sleep 60
done
```

- [ ] **Step 4: Lint.** `shellcheck infra/node.sh infra/remote/node-setup.sh` → clean. (Behaviour is verified on the real server in Task 7; there is no meaningful offline test for docker + cloud-init.)

- [ ] **Step 5: Commit**

```bash
git add infra/node.sh infra/remote/node-setup.sh infra/remote/docker-compose.override.yml
git commit -m "feat(infra): install pinned upstream read node with localhost-only ports"
```

---

### Task 5: `status.sh` + `status-remote.sh`

**Files:**
- Create: `infra/status.sh`, `infra/remote/status-remote.sh`, `test/infra/status.bats`

**Interfaces:**
- Consumes: `detect_phase`, `info_ready`, `ttl_state` (lib.sh); server files from Tasks 2 and 4.
- Produces:
  - `status-remote.sh` prints one JSON object:
    `{"phase":"downloading","shard":1,"chunk":120,"chunks":2671,"eta":"7h6m","max_block_delay":null,"disk_used_gb":180,"disk_free_gb":1290,"ram_used_gb":3,"deadline":1792300000,"ttl":"ok"}`
    `phase` ∈ `installing|starting|downloading|unzipping|unpacking|syncing|ready|disk_full|stopped`.
  - `status.sh` → human summary; `--json` → the object above plus `"ssh":"ok"`; `--line` → one short line starting with the phase (used by `node.sh`). SSH failure → `{"phase":"error","ssh":"blocked",...}` and message "SSH blocked. Your IP may have changed: ./infra/allow-ip.sh".
- Env overrides for tests: `FCX_LOGS_CMD`, `FCX_INFO_CMD`, `FCX_DF_CMD`, `FCX_ETC`, `FCX_NOW`.

- [ ] **Step 1: Write failing tests** — `test/infra/status.bats`:

```bash
setup() {
  F="$BATS_TEST_DIRNAME/fixtures"; R="$BATS_TEST_DIRNAME/../../infra/remote/status-remote.sh"
  export FCX_ETC="$BATS_TMPDIR/etc"; mkdir -p "$FCX_ETC"
  cp "$BATS_TEST_DIRNAME/../../infra/lib.sh" "$FCX_ETC/lib.sh"; echo 0 > "$FCX_ETC/deadline"
  export FCX_DF_CMD="echo 200 1300"   # used_gb free_gb
}
@test "downloading phase from logs" {
  FCX_LOGS_CMD="cat $F/log-downloading.txt" FCX_INFO_CMD="false" run bash "$R"
  [ "$(echo "$output" | jq -r .phase)" = downloading ]
  [ "$(echo "$output" | jq -r .chunk)" = 120 ]
  [ "$(echo "$output" | jq -r .eta)" = 7h6m ]
}
@test "syncing when info responds with big delay" {
  FCX_LOGS_CMD="cat $F/log-running.txt" FCX_INFO_CMD="cat $F/info-syncing.json" run bash "$R"
  [ "$(echo "$output" | jq -r .phase)" = syncing ]
  [ "$(echo "$output" | jq -r .max_block_delay)" = 5400 ]
}
@test "ready when all shards caught up" {
  FCX_LOGS_CMD="cat $F/log-running.txt" FCX_INFO_CMD="cat $F/info-ready.json" run bash "$R"
  [ "$(echo "$output" | jq -r .phase)" = ready ]
}
@test "disk_full when under 5 GB free" {
  FCX_DF_CMD="echo 1495 3" FCX_LOGS_CMD="cat $F/log-unpacking.txt" FCX_INFO_CMD=false run bash "$R"
  [ "$(echo "$output" | jq -r .phase)" = disk_full ]
}
@test "ttl warn surfaces" {
  echo 1000 > "$FCX_ETC/deadline"
  FCX_NOW=100 FCX_LOGS_CMD="cat $F/log-running.txt" FCX_INFO_CMD="cat $F/info-ready.json" run bash "$R"
  [ "$(echo "$output" | jq -r .ttl)" = warn ]
}
```

- [ ] **Step 2: Run — expect FAIL.**

- [ ] **Step 3: Implement `infra/remote/status-remote.sh`**

```bash
#!/usr/bin/env bash
# Runs on the server. Prints one JSON object describing the node.
set -uo pipefail
ETC="${FCX_ETC:-/etc/fcx}"
# shellcheck source=/dev/null
source "${FCX_LIB:-$ETC/lib.sh}"
logs_cmd="${FCX_LOGS_CMD:-docker compose -f /root/snapchain/docker-compose.yml logs --no-color --tail 300 snapchain}"
info_cmd="${FCX_INFO_CMD:-curl -fsS --max-time 5 http://127.0.0.1:3381/v1/info}"
df_cmd="${FCX_DF_CMD:-df -BG --output=used,avail /mnt/fcx | tail -1 | tr -dc '0-9 \n'}"
now="${FCX_NOW:-$(date +%s)}"

tmp=$(mktemp); info=$(mktemp)
eval "$logs_cmd" > "$tmp" 2>/dev/null
read -r phase shard chunk chunks eta <<<"$(detect_phase "$tmp")"
read -r used free <<<"$(eval "$df_cmd")"
delay=null
if eval "$info_cmd" > "$info" 2>/dev/null && [[ -s "$info" ]]; then
  if delay=$(info_ready "$info" 10); then phase=ready; else phase=syncing; fi
elif [[ ! -s "$tmp" ]]; then
  phase=$([[ -f /root/snapchain/install.log ]] && echo installing || echo stopped)
fi
(( free < 5 )) && phase=disk_full
deadline=$(cat "$ETC/deadline" 2>/dev/null || echo 0)
ram=$(free -g 2>/dev/null | awk '/Mem:/{print $3}'); ram=${ram:-0}
num() { [[ "$1" == - ]] && echo null || echo "$1"; }
jq -n --arg phase "$phase" --argjson shard "$(num "$shard")" --argjson chunk "$(num "$chunk")" \
  --argjson chunks "$(num "$chunks")" --arg eta "$eta" --argjson delay "$delay" \
  --argjson used "$used" --argjson free "$free" --argjson ram "$ram" \
  --argjson deadline "$deadline" --arg ttl "$(ttl_state "$deadline" "$now")" \
  '{phase:$phase,shard:$shard,chunk:$chunk,chunks:$chunks,eta:(if $eta=="-" then null else $eta end),
    max_block_delay:$delay,disk_used_gb:$used,disk_free_gb:$free,ram_used_gb:$ram,deadline:$deadline,ttl:$ttl}'
rm -f "$tmp" "$info"
```

On the server `node.sh` copies `lib.sh` to `/opt/fcx/lib.sh`; `status.sh` calls it with `FCX_LIB=/opt/fcx/lib.sh` when `/etc/fcx/lib.sh` is missing (host mode).

- [ ] **Step 4: Implement `infra/status.sh`**

```bash
#!/usr/bin/env bash
# Node progress. --json for agents, --line for one-line output.
set -uo pipefail
cd "$(dirname "$0")/.."; source infra/lib.sh
source .fcx/state.env 2>/dev/null || die "no server yet. Run ./infra/provision.sh first."
mode=human; [[ "${1:-}" == --json ]] && mode=json; [[ "${1:-}" == --line ]] && mode=line

if ! j=$(ssh "${SSH_OPTS[@]}" -o BatchMode=yes "$SSH_TARGET" \
      'L=/etc/fcx/lib.sh; [ -f $L ] || L=/opt/fcx/lib.sh; sudo FCX_LIB=$L bash /opt/fcx/status-remote.sh' 2>/dev/null); then
  j='{"phase":"error","ssh":"blocked"}'
  msg="SSH blocked. Your IP may have changed: ./infra/allow-ip.sh"
fi
j=$(jq -c '. + {ssh:(.ssh // "ok")}' <<<"$j")
case "$mode" in
  json) echo "$j" ;;
  line) jq -r '"\(.phase)"
      + (if .phase=="downloading" then " shard \(.shard) \(.chunk)/\(.chunks) ETA \(.eta // "?")" else "" end)
      + (if .phase=="syncing" then " \(.max_block_delay) blocks behind" else "" end)
      + (if .disk_used_gb then "  disk \(.disk_used_gb)G used" else "" end)' <<<"$j" ;;
  human)
    [[ -n "${msg:-}" ]] && { echo "$msg"; exit 1; }
    jq -r '"Phase:   \(.phase)",
      (if .phase=="downloading" then "Shard:   \(.shard)  chunk \(.chunk)/\(.chunks)  ETA \(.eta // "?")" else empty end),
      (if .max_block_delay then "Behind:  \(.max_block_delay) blocks" else empty end),
      "Disk:    \(.disk_used_gb) GB used, \(.disk_free_gb) GB free",
      "RAM:     \(.ram_used_gb) GB used",
      "TTL:     \(.ttl)"' <<<"$j" ;;
esac
```

- [ ] **Step 5: Run — expect PASS.** `bats test/infra && shellcheck infra/*.sh infra/remote/*.sh`

- [ ] **Step 6: Commit**

```bash
git add infra/status.sh infra/remote/status-remote.sh test/infra/status.bats
git commit -m "feat(infra): status with phases, disk, TTL and blocked-SSH hint"
```

---

### Task 6: `destroy.sh`

**Files:**
- Create: `infra/destroy.sh`, `test/infra/destroy.bats`

**Interfaces:**
- Consumes: `.fcx/state.env`; hcloud.
- Produces: deletes server, volume, firewall labelled `fcx=$NAME`; removes `.fcx/state.env`. Idempotent. Host mode: stops the node (`snapchain.sh down`) and leaves the box alone.

- [ ] **Step 1: Write failing tests** — `test/infra/destroy.bats`:

```bash
setup() {
  export PATH="$BATS_TEST_DIRNAME/stubs:$PATH" STUB_LOG="$BATS_TMPDIR/hc.log" HCLOUD_TOKEN=SECRET123
  export FCX_ROOT="$BATS_TMPDIR/repo"; rm -rf "$FCX_ROOT"; mkdir -p "$FCX_ROOT/.fcx"
  cp -R "$BATS_TEST_DIRNAME/../../infra" "$FCX_ROOT/"
  printf 'NAME=trial1\nMODE=hetzner\nSSH_TARGET=root@1.2.3.4\nSSH_OPTS=()\nDATA_DIR=/mnt/fcx\nDEADLINE=0\n' > "$FCX_ROOT/.fcx/state.env"
  : > "$STUB_LOG"
}
@test "deletes server, then volume, then firewall by label" {
  run bash "$FCX_ROOT/infra/destroy.sh" --yes
  [ "$status" -eq 0 ]
  run cat "$STUB_LOG"
  [[ "$output" == *"server delete fcx-trial1"*"volume delete fcx-trial1"*"firewall delete fcx-trial1"* ]]
  [ ! -f "$FCX_ROOT/.fcx/state.env" ]
}
@test "second run is a no-op" {
  bash "$FCX_ROOT/infra/destroy.sh" --yes
  run bash "$FCX_ROOT/infra/destroy.sh" --yes
  [ "$status" -eq 0 ]; [[ "$output" == *"Nothing to destroy"* ]]
}
```

- [ ] **Step 2: Run — expect FAIL.**

- [ ] **Step 3: Implement `infra/destroy.sh`**

```bash
#!/usr/bin/env bash
# Delete this run's server, volume and firewall. Billing stops when this finishes.
set -euo pipefail
ROOT="${FCX_ROOT:-$(cd "$(dirname "$0")/.." && pwd)}"; cd "$ROOT"; source infra/lib.sh
[[ -f .fcx/state.env ]] || { echo "Nothing to destroy."; exit 0; }
source .fcx/state.env
if [[ "$MODE" == host ]]; then
  ssh "${SSH_OPTS[@]}" "$SSH_TARGET" "cd ~/snapchain && sudo ./snapchain.sh down" || true
  rm -f .fcx/state.env; echo "Node stopped on $SSH_TARGET. Data kept."; exit 0
fi
[[ "${1:-}" == --yes ]] || { read -r -p "Delete run '$NAME' and its 1.5 TB volume? [y/N] " a; [[ "$a" == y* ]] || exit 1; }
export HCLOUD_TOKEN="${HCLOUD_TOKEN:-$(cat ~/.config/fcx/hcloud-token)}"
hcloud server delete "fcx-$NAME" >/dev/null 2>&1 || true
for _ in 1 2 3 4 5 6; do hcloud volume delete "fcx-$NAME" >/dev/null 2>&1 && break; sleep 5; done
hcloud firewall delete "fcx-$NAME" >/dev/null 2>&1 || true
left=$(hcloud volume list -l "fcx=$NAME" -o noheader 2>/dev/null | wc -l | tr -d ' ')
rm -f .fcx/state.env
[[ "$left" == 0 ]] && echo "Run '$NAME' deleted. Billing stopped." \
  || echo "warning: a volume is still there. Check the Hetzner console."
```

- [ ] **Step 4: Run — expect PASS.** `bats test/infra && shellcheck infra/*.sh infra/remote/*.sh`

- [ ] **Step 5: Commit**

```bash
git add infra/destroy.sh test/infra/destroy.bats
git commit -m "feat(infra): idempotent destroy by label"
```

---

### Task 7: Run 1 on Hetzner — measure, record fixtures, destroy

This is a manual runbook. The human does the Hetzner signup and token; the agent does the rest.

**Files:**
- Create: `docs/runs/run-1.md`, `client/test/fixtures/node/*.json`, `docs-prs/log.md`

- [ ] **Step 1 (human): Hetzner setup.** Create an account, a **new project** "fcx-trial", an API token (Read & Write) in that project. Save it:

```bash
mkdir -p ~/.config/fcx && pbpaste > ~/.config/fcx/hcloud-token && chmod 600 ~/.config/fcx/hcloud-token
```

Check account limits (Hetzner → Limits): a 1500 GB volume and a `ccx23` must be allowed. Request an increase if not.

- [ ] **Step 2: Provision with a 10h TTL and start a timer log.**

```bash
date -u +%FT%TZ | tee docs/runs/run-1.start
./infra/provision.sh --name run1 --ttl 10h
./infra/node.sh --no-wait
```

- [ ] **Step 3: Verify the security posture from the laptop.**

```bash
source .fcx/state.env; ip=${SSH_TARGET#root@}
nc -vz -w3 "$ip" 3381; nc -vz -w3 "$ip" 3383; nc -vz -w3 "$ip" 3000   # expect: all refused/timeout
ssh "${SSH_OPTS[@]}" "$SSH_TARGET" "ss -tlnup | grep -E '3381|3382|3383|3000|8125'"  # expect 127.0.0.1 except 3382/udp
```

If `!override` is not honoured (ports still on 0.0.0.0), the Hetzner firewall still blocks them; record it in `docs/runs/run-1.md` and fix the override before run 2.

- [ ] **Step 4: Sample progress every 15 min until ready.**

```bash
while true; do echo "$(date -u +%FT%TZ) $(./infra/status.sh --json)" >> docs/runs/run-1.samples.jsonl; \
  ./infra/status.sh --line; [[ "$(./infra/status.sh --line)" == ready* ]] && break; sleep 900; done
```

Also record peak RAM: `ssh ... "docker stats --no-stream"` at each phase change.

- [ ] **Step 5: Verify writes path and open questions** (through a tunnel):

```bash
ssh "${SSH_OPTS[@]}" -N -L 3381:127.0.0.1:3381 "$SSH_TARGET" &
curl -s localhost:3381/v1/info | jq .
curl -s "localhost:3381/v1/signersByFid?fid=3" | jq 'keys, (.signers[0] // .)'   # is currentUserNonce present?
```

Record: does the HTTP `signersByFid` include a nonce field? Name and location.

- [ ] **Step 6: Record API fixtures for Plan 2** (public data, FID 3 = dwr, and two other well-known FIDs):

```bash
mkdir -p client/test/fixtures/node; cd client/test/fixtures/node
q() { curl -fsS "localhost:3381/v1/$1" | jq . > "$2.json"; }
q info info
q "linksByFid?fid=3&link_type=follow&pageSize=50" links-3
q "castsByFid?fid=3&reverse=true&pageSize=20" casts-3
q "castsByFid?fid=2&reverse=true&pageSize=20" casts-2
q "userDataByFid?fid=3" userdata-3
q "signersByFid?fid=3" signers-3
q "storageLimitsByFid?fid=3" storage-3
q "reactionsByFid?fid=3&reaction_type=Like&pageSize=20" reactions-3
q "onChainIdRegistryEventByAddress?address=$(jq -r '.messages[0].data.fid' casts-3.json >/dev/null; echo 0x0000000000000000000000000000000000000000)" idreg-miss
cd -
```

(Replace the last address with a known custody address if available; the miss case is still useful.)

- [ ] **Step 7: Final measurements → `docs/runs/run-1.md`** using this template:

```markdown
# Run 1 — 2026-10-18
Server: ccx23 fsn1, 1500 GB volume. Snapchain image: <docker image digest>. snapchain.sh v0.14.3.
| Phase | Start (UTC) | End | Duration |
|---|---|---|---|
| provision → SSH ready | | | |
| install (docker + images) | | | |
| download shard 1 / 2 / 0 | | | |
| unzip + unpack | | | |
| catch-up to blockDelay ≤ 10 | | | |
Peak disk: ___ GB at phase ___. Steady-state disk: ___ GB. Peak RAM: ___ GB.
Download speed: ___ MB/s. Hetzner cost for the run: €___ (from Billing).
Ports check: ___. signersByFid nonce field: ___.
Problems hit and fixes: ...
```

- [ ] **Step 8: Log doc mismatches** found during the run in `docs-prs/log.md` (one line each: page, what it says, what is true, evidence).

- [ ] **Step 9: Destroy and verify billing stops.**

```bash
./infra/destroy.sh --yes
HCLOUD_TOKEN=$(cat ~/.config/fcx/hcloud-token) hcloud server list; HCLOUD_TOKEN=$(cat ~/.config/fcx/hcloud-token) hcloud volume list   # expect empty
```

(If the run is still syncing near the 10h deadline, let the TTL fire instead and confirm the same lists are empty — that tests auto-destroy for real.)

- [ ] **Step 10: Commit**

```bash
git add docs/runs client/test/fixtures docs-prs
git commit -m "docs: run 1 measurements, API fixtures, upstream doc issues"
```

---

## Self-review notes

- Spec §5 infra: provision (Task 3), node (Task 4), status (Task 5), destroy (Task 6), TTL (Task 2), `--host` (Task 3), pinned bootstrap (Task 4), SSH-only 3381 (Tasks 3–4), dedicated project (Task 7 step 1, `provision.sh` error text). ✅
- Spec §3 open items: timings, disk, RAM, nonce field, volume I/O — Task 7. Derivation path is Plan 2 (client). ✅
- Spec updated alongside this plan: only 3382/udp is public (upstream compose publishes gossip on UDP 3382; 3383 is gRPC and stays on localhost).
- Log fixtures are built from upstream format strings; `Starting node` is synthetic. Run 1 replaces them with real log lines if they differ.
- Out of scope here: `fcx`, site, `agent.md` → Plans 2 and 3.
