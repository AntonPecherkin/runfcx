# Plan 1: Infra Commands + Run 1 — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Commands (0) and (1) of the quickstart — `npx fcx-cli provision` and `npx fcx-cli node` — plus `status`, `extend`, `allow-ip`, `destroy`. Then run 1 on Hetzner: measure, record API fixtures, destroy.

**Architecture:** One npm package `fcx-cli` in `cli/`. Laptop-side commands are TypeScript (`src/infra/`): they call the Hetzner REST API with built-in `fetch` and shell out to the system `ssh`/`scp`/`ssh-keygen`. Server-side work is bash in `cli/remote/` (copied to the server, tested with bats). The node is the untouched upstream `snapchain.sh` at a pinned tag, configured through `.env` and a compose override that binds everything except gossip to 127.0.0.1.

**Tech Stack:** Node ≥ 20, TypeScript 5.6, vitest 2, `node:util` `parseArgs` (no CLI framework). bash 5, jq, cloud-init, cron, bats-core, shellcheck on the server side. Upstream `farcasterxyz/snapchain` tag `v0.14.3`.

**Spec:** `docs/superpowers/specs/2026-10-18-farcaster-3-commands-design.md`

## Global Constraints

- Quickstart is exactly three commands: `npx fcx-cli provision --ttl 8h`, `npx fcx-cli node`, `npx fcx-cli login --wallet`. Laptop needs only Node ≥ 20 and OpenSSH. No git clone, no hcloud CLI, no jq on the laptop.
- npm package `fcx-cli`, binaries `fcx` and `fcx-cli` (same file).
- Runtime dependencies for infra: none. Dev deps pinned exactly: `typescript@5.6.3`, `vitest@2.1.4`, `@types/node@22.9.0`.
- The node uses no API keys. The only credential is the user's Hetzner token, read from `HCLOUD_TOKEN` or `~/.config/fcx/hcloud-token` (0600). Never printed, never in argv, never in error messages.
- Trial mode needs a **dedicated Hetzner project** (tokens are project-wide). `--keep` puts no token on the server.
- Public inbound: **22/tcp from the caller's IP only**, **3382/udp** from anywhere. 3381, 3383, 3000, 8125, 8126 bound to 127.0.0.1.
- Upstream `snapchain.sh` pinned: tag `v0.14.3`, sha256 `cdeb51daf31ac01f25b4be3857eeec41e2e4685ca6e77e5f52959cb8065f553a`, `SKIP_SELF_UPGRADE=true`. Compose file and image follow upstream `@latest` (network upgrades); tutorial says so.
- Volume 1500 GB, server type default `ccx23`, image `ubuntu-24.04`, location default `fsn1`.
- Every Hetzner resource is named `fcx-<name>` and labelled `fcx=<name>`. Deletion finds resources only by label.
- Local state: `$FCX_HOME` (default `~/.fcx`): `state.json`, `ssh_ed25519` (+ `.pub`).
- Remote files live in `/opt/fcx/` (survives reboot) and `/etc/fcx/` (TTL).
- No interactive prompts in anything an agent may run, except `destroy` without `--yes` (TTY only).
- Output text: short sentences, no hype, no "not X, but Y".

## Review Focus

1. **Laptop IP changes mid-run** (wifi, VPN): SSH times out. Expected: `fcx status` prints "SSH blocked. Your IP may have changed. Run: fcx allow-ip" and exits 1 instead of hanging. → Task 6 test.
2. **TTL fires while the user is working.** Expected: a warning 30 min before (server `wall` + `fcx status` shows the TTL warning), and `fcx extend 4h` works. → Tasks 2 and 6 tests.
3. **Re-running `provision` after a partial failure** (firewall created, server failed). Expected: it refuses with "Run 'X' already exists … fcx destroy" when any labelled resource exists; never silent duplicates. → Task 5 test.
4. **`node` run twice** (agent retry). Expected: idempotent; sees the running container and goes straight to waiting. → Task 2 (`node-setup.sh` guard) + Task 6 test.
5. **Disk fills during unpack.** Expected: phase `disk_full` with free GB, and `node` stops waiting with an error. → Task 2 and Task 6 tests.

---

## File Structure

```
LICENSE  .gitignore  README.md
cli/
  package.json  tsconfig.json  vitest.config.ts
  src/
    cli.ts                     # entry: parseArgs → subcommand
    infra/
      paths.ts                 # fcxHome(), remoteDir()
      ttl.ts                   # parseTtl, ttlState, ipCidr
      state.ts                 # RunState load/save/clear
      token.ts                 # readToken()
      hetzner.ts               # Hetzner REST client + firewallRules()
      ssh.ts                   # Ssh interface, makeSsh(), ensureKey()
      cloudinit.ts             # renderCloudInit()
      provision.ts  node.ts  status.ts  extend.ts  allowip.ts  destroy.ts
  remote/                      # shipped in the npm package, copied to the server
    lib.sh  ttl-destroy.sh  node-setup.sh  status-remote.sh  host-check.sh
    docker-compose.override.yml  cloud-init.yaml.tpl
  test/
    infra/*.test.ts            # vitest
    remote/*.bats  remote/stubs/curl  remote/fixtures/*
    fixtures/node/*.json       # recorded in run 1, used by Plan 2
docs/runs/run-1.md
docs-prs/log.md
```

---

### Task 1: Scaffold + server-side `lib.sh`

**Files:**
- Create: `LICENSE`, `.gitignore`, `README.md`, `cli/package.json`, `cli/tsconfig.json`, `cli/vitest.config.ts`, `cli/src/cli.ts` (stub), `cli/remote/lib.sh`, `cli/test/remote/lib.bats`, `cli/test/remote/fixtures/*`

**Interfaces:**
- Produces (bash, sourced on the server):
  - `parse_ttl <str>` → seconds; `90m|8h|2d|0`; exit 1 otherwise.
  - `ttl_state <deadline> <now>` → `none|ok|warn|expired` (warn = ≤1800 s left).
  - `detect_phase <logfile>` → `<phase> <shard> <i> <n> <eta>`, phase ∈ `starting|downloading|unzipping|unpacking|running`, unknown fields `-`.
  - `info_ready <info.json> <max_delay>` → prints worst `blockDelay`; exit 0 if all ≤ max.
- Produces (npm): `npm test` (vitest), `npm run test:remote` (bats), `npm run build` (tsc → `dist/`).

- [ ] **Step 1: Tools.** `brew install bats-core shellcheck`

- [ ] **Step 2: Root files**

`.gitignore`:
```
node_modules/
dist/
.DS_Store
```
`LICENSE`: MIT, `Copyright (c) 2026 <owner>` (owner = GitHub owner, spec open item).
`README.md`:
```markdown
# fcx-cli
Run your own Farcaster read node and client in three commands. No API keys.

    npx fcx-cli provision --ttl 8h
    npx fcx-cli node
    npx fcx-cli login --wallet

Tutorial: <site>. License: MIT.
```

- [ ] **Step 3: `cli/package.json`**

```json
{
  "name": "fcx-cli",
  "version": "0.1.0",
  "description": "Your own Farcaster read node and client in three commands.",
  "license": "MIT",
  "type": "module",
  "bin": { "fcx": "dist/cli.js", "fcx-cli": "dist/cli.js" },
  "files": ["dist", "remote"],
  "engines": { "node": ">=20" },
  "scripts": {
    "build": "tsc -p .",
    "prepack": "npm run build",
    "test": "vitest run",
    "test:remote": "bats test/remote",
    "lint:remote": "shellcheck remote/*.sh"
  },
  "devDependencies": {
    "@types/node": "22.9.0",
    "typescript": "5.6.3",
    "vitest": "2.1.4"
  }
}
```

`cli/tsconfig.json`:
```json
{
  "compilerOptions": {
    "target": "ES2022", "module": "NodeNext", "moduleResolution": "NodeNext",
    "strict": true, "outDir": "dist", "rootDir": "src", "declaration": false,
    "esModuleInterop": true, "skipLibCheck": true
  },
  "include": ["src"]
}
```

`cli/vitest.config.ts`:
```ts
import { defineConfig } from "vitest/config";
export default defineConfig({ test: { include: ["test/**/*.test.ts"] } });
```

`cli/src/cli.ts` (stub, replaced in Task 7):
```ts
#!/usr/bin/env node
console.log("fcx-cli");
```

Run: `cd cli && npm install && npm run build` → `dist/cli.js` exists.

- [ ] **Step 4: Fixtures** (formats from `src/storage/db/snapshot.rs` at v0.14.3; `Starting node` is synthetic and gets replaced by a real line in run 1)

`cli/test/remote/fixtures/log-downloading.txt`:
```
snapchain-1  | 2026-10-18T10:00:01Z INFO snapchain::storage::db::snapshot: Downloading snapshots (legacy method)
snapchain-1  | 2026-10-18T10:00:05Z INFO snapchain::storage::db::snapshot: Downloading zipped snapshot chunk chunk_0001.bin for shard 1 (1/2671 chunks in shard) 
snapchain-1  | 2026-10-18T10:20:05Z INFO snapchain::storage::db::snapshot: Downloading zipped snapshot chunk chunk_0120.bin for shard 1 (120/2671 chunks in shard) Shard ETA: 7h6m
```
`log-unzipping.txt`:
```
snapchain-1  | 2026-10-18T12:00:05Z INFO snapchain::storage::db::snapshot: Downloading zipped snapshot chunk chunk_2671.bin for shard 1 (2671/2671 chunks in shard) Shard ETA: 0h0m
snapchain-1  | 2026-10-18T12:00:09Z INFO snapchain::storage::db::snapshot: Unzipping snapshot chunk .rocks.snapshot/shard-1/chunk_0042.bin for shard 1
```
`log-unpacking.txt`:
```
snapchain-1  | 2026-10-18T12:30:00Z INFO snapchain::storage::db::snapshot: Unpacking snapshot file .rocks.snapshot/shard_1_snapshot.tar for shard 1
```
`log-running.txt`:
```
snapchain-1  | 2026-10-18T14:00:00Z INFO snapchain: Starting node
```
`info-syncing.json`:
```json
{"dbStats":{"numMessages":1,"numFidRegistrations":1,"approxSize":1},"numShards":2,"shardInfos":[{"shardId":0,"maxHeight":100,"numMessages":0,"numFidRegistrations":0,"approxSize":0,"blockDelay":3,"mempoolSize":0},{"shardId":1,"maxHeight":200,"numMessages":0,"numFidRegistrations":0,"approxSize":0,"blockDelay":5400,"mempoolSize":4294967295},{"shardId":2,"maxHeight":200,"numMessages":0,"numFidRegistrations":0,"approxSize":0,"blockDelay":12,"mempoolSize":4294967295}]}
```
`info-ready.json`: same, all `blockDelay` = `2`.

- [ ] **Step 5: Failing tests** — `cli/test/remote/lib.bats`:

```bash
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
```

- [ ] **Step 6: Run — expect FAIL.** `cd cli && npm run test:remote`

- [ ] **Step 7: Implement `cli/remote/lib.sh`**

```bash
#!/usr/bin/env bash
# Shared server-side helpers. Pure functions: no network.

parse_ttl() {
  local s="$1"
  [[ "$s" == 0 ]] && { echo 0; return 0; }
  [[ "$s" =~ ^([0-9]+)([mhd])$ ]] || return 1
  local n="${BASH_REMATCH[1]}"
  case "${BASH_REMATCH[2]}" in m) echo $((n * 60)) ;; h) echo $((n * 3600)) ;; d) echo $((n * 86400)) ;; esac
}

ttl_state() {
  local deadline="$1" now="$2"
  if (( deadline == 0 )); then echo none
  elif (( now >= deadline )); then echo expired
  elif (( deadline - now <= 1800 )); then echo warn
  else echo ok; fi
}

# Latest snapshot phase from the snapchain container log.
detect_phase() {
  local line
  line=$(grep -E 'Downloading zipped snapshot chunk|Unzipping snapshot chunk|Unpacking snapshot file|Starting node' "$1" | tail -n 1)
  if [[ -z "$line" ]]; then echo "starting - - - -"
  elif [[ "$line" =~ Downloading\ zipped\ snapshot\ chunk\ [^\ ]+\ for\ shard\ ([0-9]+)\ \(([0-9]+)/([0-9]+)\ chunks\ in\ shard\)\ ?(Shard\ ETA:\ ([0-9]+h[0-9]+m))? ]]; then
    echo "downloading ${BASH_REMATCH[1]} ${BASH_REMATCH[2]} ${BASH_REMATCH[3]} ${BASH_REMATCH[5]:--}"
  elif [[ "$line" =~ Unzipping\ snapshot\ chunk\ .*\ for\ shard\ ([0-9]+) ]]; then echo "unzipping ${BASH_REMATCH[1]} - - -"
  elif [[ "$line" =~ Unpacking\ snapshot\ file\ .*\ for\ shard\ ([0-9]+) ]]; then echo "unpacking ${BASH_REMATCH[1]} - - -"
  else echo "running - - - -"; fi
}

info_ready() {
  local worst
  worst=$(jq '[.shardInfos[].blockDelay] | max' "$1") || return 2
  echo "$worst"
  (( worst <= $2 ))
}
```

- [ ] **Step 8: Run — expect PASS.** `npm run test:remote && npm run lint:remote`

- [ ] **Step 9: Commit**

```bash
git add LICENSE .gitignore README.md cli
git commit -m "feat: scaffold fcx-cli package and server-side helpers"
```

---

### Task 2: Server-side scripts (TTL destroy, node setup, status, host check, override, cloud-init)

**Files:**
- Create: `cli/remote/ttl-destroy.sh`, `cli/remote/node-setup.sh`, `cli/remote/status-remote.sh`, `cli/remote/host-check.sh`, `cli/remote/docker-compose.override.yml`, `cli/remote/cloud-init.yaml.tpl`, `cli/test/remote/ttl-destroy.bats`, `cli/test/remote/status-remote.bats`, `cli/test/remote/stubs/curl`

**Interfaces:**
- Consumes: `lib.sh` (Task 1).
- Produces:
  - Server layout: `/etc/fcx/{name,deadline,token(0600)}`, `/opt/fcx/*` (copies of `remote/`), `/usr/local/bin/fcx-ttl-destroy`, `/etc/cron.d/fcx-ttl`, `/mnt/fcx` → data volume, `/root/snapchain` → `/mnt/fcx/snapchain`.
  - `status-remote.sh` prints one JSON object:
    `{"phase","shard","chunk","chunks","eta","max_block_delay","disk_used_gb","disk_free_gb","ram_used_gb","deadline","ttl"}`; phase ∈ `installing|starting|downloading|unzipping|unpacking|syncing|ready|disk_full|stopped`.
  - `node-setup.sh <keep:yes|no> [host_data_dir]` → exit 0 when the container is running.
  - `host-check.sh <data_dir>` → table of checks on stdout, exit 1 if a hard requirement fails.
  - Cloud-init template placeholders: `@NAME@ @DEADLINE@ @TOKEN_B64@ @LIB_B64@ @TTL_B64@`, TTL block between `# TTL-BEGIN` and `# TTL-END`.
  - Test env overrides: `FCX_ETC`, `FCX_LIB`, `HCLOUD_API`, `FCX_NOW`, `FCX_SERVER_ID`, `FCX_SLEEP`, `FCX_LOGS_CMD`, `FCX_INFO_CMD`, `FCX_DF_CMD`.

- [ ] **Step 1: curl stub** — `cli/test/remote/stubs/curl` (`chmod +x`):

```bash
#!/usr/bin/env bash
echo "$*" >> "$STUB_LOG"
case "$*" in
  *"/volumes?label_selector"*)   echo '{"volumes":[{"id":11}]}' ;;
  *"/firewalls?label_selector"*) echo '{"firewalls":[{"id":22}]}' ;;
  *) echo '{}' ;;
esac
```

- [ ] **Step 2: Failing tests** — `cli/test/remote/ttl-destroy.bats`:

```bash
setup() {
  export FCX_ETC="$BATS_TMPDIR/etc"; mkdir -p "$FCX_ETC"
  export FCX_LIB="$BATS_TEST_DIRNAME/../../remote/lib.sh"
  echo SECRET123 > "$FCX_ETC/token"; echo trial1 > "$FCX_ETC/name"
  export PATH="$BATS_TEST_DIRNAME/stubs:$PATH" STUB_LOG="$BATS_TMPDIR/curl.log"
  export FCX_SERVER_ID=7 HCLOUD_API=https://api.test/v1 FCX_SLEEP=0
  : > "$STUB_LOG"; S="$BATS_TEST_DIRNAME/../../remote/ttl-destroy.sh"
}
@test "nothing before deadline" { echo 5000 > "$FCX_ETC/deadline"; FCX_NOW=100 run bash "$S"; [ "$status" -eq 0 ]; [ ! -s "$STUB_LOG" ]; }
@test "nothing when TTL is 0"   { echo 0 > "$FCX_ETC/deadline"; FCX_NOW=999999 run bash "$S"; [ ! -s "$STUB_LOG" ]; }
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
```

`cli/test/remote/status-remote.bats`:
```bash
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
```

- [ ] **Step 3: Run — expect FAIL.**

- [ ] **Step 4: `cli/remote/ttl-destroy.sh`**

```bash
#!/usr/bin/env bash
# Runs from cron on the server. After the deadline, deletes this run's Hetzner resources.
set -euo pipefail
ETC="${FCX_ETC:-/etc/fcx}"
API="${HCLOUD_API:-https://api.hetzner.cloud/v1}"
# shellcheck source=/dev/null
source "${FCX_LIB:-/opt/fcx/lib.sh}"

now="${FCX_NOW:-$(date +%s)}"
deadline=$(cat "$ETC/deadline"); name=$(cat "$ETC/name")
case "$(ttl_state "$deadline" "$now")" in
  none|ok) exit 0 ;;
  warn) msg="fcx: auto-destroy in $(( (deadline - now) / 60 )) min. Extend with: fcx extend 4h"
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

- [ ] **Step 5: `cli/remote/status-remote.sh`**

```bash
#!/usr/bin/env bash
# Runs on the server. Prints one JSON object describing the node.
set -uo pipefail
ETC="${FCX_ETC:-/etc/fcx}"
# shellcheck source=/dev/null
source "${FCX_LIB:-/opt/fcx/lib.sh}"
logs_cmd="${FCX_LOGS_CMD:-docker compose -f /root/snapchain/docker-compose.yml logs --no-color --tail 300 snapchain}"
info_cmd="${FCX_INFO_CMD:-curl -fsS --max-time 5 http://127.0.0.1:3381/v1/info}"
df_cmd="${FCX_DF_CMD:-df -BG --output=used,avail /mnt/fcx | tail -1 | tr -dc '0-9 '}"
now="${FCX_NOW:-$(date +%s)}"

log=$(mktemp); info=$(mktemp)
eval "$logs_cmd" > "$log" 2>/dev/null
read -r phase shard chunk chunks eta <<<"$(detect_phase "$log")"
read -r used free <<<"$(eval "$df_cmd")"
delay=null
if eval "$info_cmd" > "$info" 2>/dev/null && [[ -s "$info" ]]; then
  if delay=$(info_ready "$info" 10); then phase=ready; else phase=syncing; fi
elif [[ ! -s "$log" ]]; then
  phase=$([[ -f /root/snapchain/install.log ]] && echo installing || echo stopped)
fi
(( free < 5 )) && phase=disk_full
deadline=$(cat "$ETC/deadline" 2>/dev/null || echo 0)
ram=$(free -g 2>/dev/null | awk '/Mem:/{print $3}'); ram=${ram:-0}
num() { [[ "$1" == - ]] && echo null || echo "$1"; }
jq -n --arg phase "$phase" --argjson shard "$(num "$shard")" --argjson chunk "$(num "$chunk")" \
  --argjson chunks "$(num "$chunks")" --arg eta "$eta" --argjson delay "$delay" \
  --argjson used "${used:-0}" --argjson free "${free:-0}" --argjson ram "$ram" \
  --argjson deadline "$deadline" --arg ttl "$(ttl_state "$deadline" "$now")" \
  '{phase:$phase,shard:$shard,chunk:$chunk,chunks:$chunks,eta:(if $eta=="-" then null else $eta end),
    max_block_delay:$delay,disk_used_gb:$used,disk_free_gb:$free,ram_used_gb:$ram,deadline:$deadline,ttl:$ttl}'
rm -f "$log" "$info"
```

- [ ] **Step 6: `cli/remote/docker-compose.override.yml`** (`!override` needs Docker Compose ≥ 2.24; upstream installs current Docker)

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

- [ ] **Step 7: `cli/remote/node-setup.sh`** (idempotent — Review Focus 4)

```bash
#!/usr/bin/env bash
# Runs on the server as root. Installs and starts the upstream read node. Safe to re-run.
set -euo pipefail
TAG=v0.14.3
SHA=cdeb51daf31ac01f25b4be3857eeec41e2e4685ca6e77e5f52959cb8065f553a
KEEP="${1:-no}"      # yes = persistent: keep upstream auto-upgrade cron
HOST_DIR="${2:-}"    # host mode: data dir chosen by the user

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

if docker ps --format '{{.Names}}' 2>/dev/null | grep -q snapchain; then echo "Node already running."; exit 0; fi

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

- [ ] **Step 8: `cli/remote/host-check.sh`** (runs on the user's own box)

```bash
#!/usr/bin/env bash
# Usage: host-check.sh <data_dir>. Checks the box can run a read node.
set -euo pipefail
dir="$1"; mkdir -p "$dir"
cpus=$(nproc); ram=$(free -g | awk '/Mem:/{print $2}')
disk=$(df -BG --output=avail "$dir" | tail -1 | tr -dc 0-9)
os=$(. /etc/os-release && echo "$ID")
fail=0
check() { if (( $2 >= $3 )); then echo "ok    $1: $2 (need $3)"; else echo "FAIL  $1: $2 (need $3)"; fail=1; fi; }
check "CPUs" "$cpus" 4
check "RAM GB" "$ram" 15
check "Free disk GB in $dir" "$disk" 1400
[[ "$os" == ubuntu || "$os" == debian ]] || echo "warn  OS: $os (tested on Ubuntu 24.04)"
echo "note  Open UDP 3382 in your provider firewall. Keep 3381 and 3383 closed; fcx uses an SSH tunnel."
exit $fail
```

- [ ] **Step 9: `cli/remote/cloud-init.yaml.tpl`**

```yaml
#cloud-config
package_update: true
packages: [jq, curl, cron]
write_files:
  - path: /etc/fcx/name
    content: "@NAME@\n"
  - path: /etc/fcx/deadline
    content: "@DEADLINE@\n"
  - path: /opt/fcx/lib.sh
    encoding: b64
    content: "@LIB_B64@"
  # TTL-BEGIN
  - path: /etc/fcx/token
    permissions: "0600"
    encoding: b64
    content: "@TOKEN_B64@"
  - path: /usr/local/bin/fcx-ttl-destroy
    permissions: "0755"
    encoding: b64
    content: "@TTL_B64@"
  - path: /etc/cron.d/fcx-ttl
    content: "*/5 * * * * root /usr/local/bin/fcx-ttl-destroy >> /var/log/fcx-ttl.log 2>&1\n"
  # TTL-END
```

- [ ] **Step 10: Run — expect PASS.** `npm run test:remote && npm run lint:remote`

- [ ] **Step 11: Commit**

```bash
git add cli/remote cli/test/remote
git commit -m "feat(remote): TTL destroy, node setup, status, host check, cloud-init"
```

---

### Task 3: TS core — paths, TTL, state, token, cloud-init

**Files:**
- Create: `cli/src/infra/paths.ts`, `ttl.ts`, `state.ts`, `token.ts`, `cloudinit.ts`; `cli/test/infra/ttl.test.ts`, `state.test.ts`, `token.test.ts`, `cloudinit.test.ts`

**Interfaces:**
- Produces:
  ```ts
  // paths.ts
  export function fcxHome(): string;            // $FCX_HOME or ~/.fcx (created 0700)
  export function remoteDir(): string;          // <package>/remote
  // ttl.ts
  export function parseTtl(s: string): number;  // throws Error("bad TTL ...")
  export type TtlState = "none" | "ok" | "warn" | "expired";
  export function ttlState(deadline: number, now: number): TtlState;
  export function ipCidr(ip: string): string;
  // state.ts
  export interface RunState { name: string; mode: "hetzner" | "host"; sshTarget: string;
    dataDir: string; deadline: number; }
  export function loadState(): RunState | null;
  export function requireState(): RunState;     // throws "No server yet. Run: fcx provision"
  export function saveState(s: RunState): void; // 0600
  export function clearState(): void;
  // token.ts
  export function readToken(): string;          // throws with setup instructions
  // cloudinit.ts
  export function renderCloudInit(v: { name: string; deadline: number; token: string; keep: boolean }): string;
  ```

- [ ] **Step 1: Failing tests**

`cli/test/infra/ttl.test.ts`:
```ts
import { describe, it, expect } from "vitest";
import { parseTtl, ttlState, ipCidr } from "../../src/infra/ttl.js";

describe("ttl", () => {
  it("parses", () => {
    expect(parseTtl("90m")).toBe(5400); expect(parseTtl("8h")).toBe(28800);
    expect(parseTtl("2d")).toBe(172800); expect(parseTtl("0")).toBe(0);
  });
  it("rejects junk", () => {
    for (const s of ["8x", "", "-1h", "soon"]) expect(() => parseTtl(s)).toThrow(/bad TTL/);
  });
  it("state", () => {
    expect(ttlState(0, 100)).toBe("none"); expect(ttlState(5000, 100)).toBe("ok");
    expect(ttlState(1900, 100)).toBe("warn"); expect(ttlState(100, 100)).toBe("expired");
  });
  it("cidr", () => {
    expect(ipCidr("1.2.3.4")).toBe("1.2.3.4/32"); expect(ipCidr("2001:db8::1")).toBe("2001:db8::1/128");
  });
});
```

`cli/test/infra/state.test.ts`:
```ts
import { describe, it, expect, beforeEach } from "vitest";
import { mkdtempSync, statSync } from "node:fs";
import { tmpdir } from "node:os"; import { join } from "node:path";
import { loadState, saveState, clearState, requireState } from "../../src/infra/state.js";

beforeEach(() => { process.env.FCX_HOME = mkdtempSync(join(tmpdir(), "fcx-")); });

describe("state", () => {
  it("round-trips with 0600", () => {
    const s = { name: "t1", mode: "hetzner" as const, sshTarget: "root@1.2.3.4", dataDir: "/mnt/fcx", deadline: 9 };
    saveState(s);
    expect(loadState()).toEqual(s);
    expect(statSync(join(process.env.FCX_HOME!, "state.json")).mode & 0o777).toBe(0o600);
  });
  it("clear and require", () => {
    clearState(); expect(loadState()).toBeNull();
    expect(() => requireState()).toThrow(/fcx provision/);
  });
});
```

`cli/test/infra/token.test.ts`:
```ts
import { describe, it, expect, beforeEach } from "vitest";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os"; import { join } from "node:path";
import { readToken } from "../../src/infra/token.js";

beforeEach(() => { delete process.env.HCLOUD_TOKEN; process.env.FCX_CONFIG = mkdtempSync(join(tmpdir(), "cfg-")); });

describe("token", () => {
  it("env wins", () => { process.env.HCLOUD_TOKEN = "A"; expect(readToken()).toBe("A"); });
  it("reads file, trims", () => {
    writeFileSync(join(process.env.FCX_CONFIG!, "hcloud-token"), "B\n"); expect(readToken()).toBe("B");
  });
  it("explains setup when missing", () => { expect(() => readToken()).toThrow(/new project/i); });
});
```

`cli/test/infra/cloudinit.test.ts`:
```ts
import { describe, it, expect } from "vitest";
import { renderCloudInit } from "../../src/infra/cloudinit.js";

describe("cloud-init", () => {
  it("trial embeds name, deadline, token (base64) and TTL cron", () => {
    const y = renderCloudInit({ name: "t1", deadline: 123, token: "SECRET123", keep: false });
    expect(y).toContain('content: "t1\\n"'); expect(y).toContain('content: "123\\n"');
    expect(y).toContain(Buffer.from("SECRET123").toString("base64"));
    expect(y).toContain("fcx-ttl"); expect(y).not.toMatch(/@[A-Z_0-9]+@/);
    expect(y).not.toContain("SECRET123");
  });
  it("keep mode has no token and no TTL", () => {
    const y = renderCloudInit({ name: "t1", deadline: 0, token: "SECRET123", keep: true });
    expect(y).not.toContain("/etc/fcx/token"); expect(y).not.toContain("fcx-ttl");
    expect(y).not.toContain(Buffer.from("SECRET123").toString("base64"));
  });
});
```

- [ ] **Step 2: Run — expect FAIL.** `npm test`

- [ ] **Step 3: Implement**

`cli/src/infra/paths.ts`:
```ts
import { homedir } from "node:os";
import { join, dirname, resolve } from "node:path";
import { mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";

export function fcxHome(): string {
  const dir = process.env.FCX_HOME ?? join(homedir(), ".fcx");
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  return dir;
}

// dist/infra/paths.js and src/infra/paths.ts both sit two levels below the package root.
export function remoteDir(): string {
  return resolve(dirname(fileURLToPath(import.meta.url)), "../../remote");
}
```

`cli/src/infra/ttl.ts`:
```ts
export type TtlState = "none" | "ok" | "warn" | "expired";
const UNIT = { m: 60, h: 3600, d: 86400 } as const;

export function parseTtl(s: string): number {
  if (s === "0") return 0;
  const m = /^(\d+)([mhd])$/.exec(s);
  if (!m) throw new Error(`bad TTL '${s}'. Use 90m, 8h, 2d or 0.`);
  return Number(m[1]) * UNIT[m[2] as keyof typeof UNIT];
}

export function ttlState(deadline: number, now: number): TtlState {
  if (deadline === 0) return "none";
  if (now >= deadline) return "expired";
  return deadline - now <= 1800 ? "warn" : "ok";
}

export const ipCidr = (ip: string) => (ip.includes(":") ? `${ip}/128` : `${ip}/32`);
```

`cli/src/infra/state.ts`:
```ts
import { readFileSync, writeFileSync, rmSync, existsSync } from "node:fs";
import { join } from "node:path";
import { fcxHome } from "./paths.js";

export interface RunState {
  name: string; mode: "hetzner" | "host"; sshTarget: string; dataDir: string; deadline: number;
}
const file = () => join(fcxHome(), "state.json");

export function loadState(): RunState | null {
  return existsSync(file()) ? (JSON.parse(readFileSync(file(), "utf8")) as RunState) : null;
}
export function requireState(): RunState {
  const s = loadState();
  if (!s) throw new Error("No server yet. Run: fcx provision");
  return s;
}
export function saveState(s: RunState): void {
  writeFileSync(file(), JSON.stringify(s, null, 2) + "\n", { mode: 0o600 });
}
export function clearState(): void { rmSync(file(), { force: true }); }
```

`cli/src/infra/token.ts`:
```ts
import { readFileSync, existsSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

export function readToken(): string {
  if (process.env.HCLOUD_TOKEN) return process.env.HCLOUD_TOKEN;
  const f = join(process.env.FCX_CONFIG ?? join(homedir(), ".config", "fcx"), "hcloud-token");
  if (existsSync(f)) return readFileSync(f, "utf8").trim();
  throw new Error(
    "No Hetzner token.\n" +
    "1. In Hetzner Cloud, create a NEW project just for this (tokens control the whole project).\n" +
    "2. Security → API tokens → Generate (Read & Write). Copy it.\n" +
    "3. mkdir -p ~/.config/fcx && pbpaste > ~/.config/fcx/hcloud-token && chmod 600 ~/.config/fcx/hcloud-token");
}
```

`cli/src/infra/cloudinit.ts`:
```ts
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { remoteDir } from "./paths.js";

const b64 = (s: string | Buffer) => Buffer.from(s).toString("base64");
const read = (f: string) => readFileSync(join(remoteDir(), f));

export function renderCloudInit(v: { name: string; deadline: number; token: string; keep: boolean }): string {
  let y = read("cloud-init.yaml.tpl").toString("utf8");
  if (v.keep) y = y.replace(/ *# TTL-BEGIN[\s\S]*?# TTL-END\n?/, "");
  return y
    .replace("@NAME@", v.name)
    .replace("@DEADLINE@", String(v.deadline))
    .replace("@LIB_B64@", b64(read("lib.sh")))
    .replace("@TOKEN_B64@", b64(v.token))
    .replace("@TTL_B64@", b64(read("ttl-destroy.sh")));
}
```

- [ ] **Step 4: Run — expect PASS.** `npm test`

- [ ] **Step 5: Commit**

```bash
git add cli/src/infra cli/test/infra
git commit -m "feat(infra): TTL, state, token and cloud-init rendering"
```

---

### Task 4: Hetzner API client + SSH wrapper

**Files:**
- Create: `cli/src/infra/hetzner.ts`, `cli/src/infra/ssh.ts`, `cli/test/infra/hetzner.test.ts`

**Interfaces:**
- Consumes: `ipCidr` (Task 3), `fcxHome` (Task 3).
- Produces:
  ```ts
  // hetzner.ts
  export type Kind = "servers" | "volumes" | "firewalls";
  export interface Rule { direction: "in"; protocol: "tcp" | "udp"; port: string; source_ips: string[] }
  export function firewallRules(myIp: string): Rule[];          // 22/tcp from myIp, 3382/udp from all
  export class HetznerError extends Error { status: number; code: string }
  export class Hetzner {
    constructor(token: string, fetchImpl?: typeof fetch, base?: string);
    listByLabel(kind: Kind, name: string): Promise<{ id: number; name: string }[]>;
    ensureSshKey(name: string, publicKey: string): Promise<void>;
    createFirewall(name: string, label: string, rules: Rule[]): Promise<number>;
    setFirewallRules(id: number, rules: Rule[]): Promise<void>;
    createServer(o: { name: string; type: string; location: string; sshKey: string;
      firewallId: number; label: string; userData: string }): Promise<{ id: number; ip: string }>;
    createVolume(o: { name: string; serverId: number; label: string; sizeGb: number }): Promise<number>;
    deleteServer(id: number): Promise<void>;
    detachVolume(id: number): Promise<void>;
    deleteVolume(id: number): Promise<void>;
    deleteFirewall(id: number): Promise<void>;
  }
  // ssh.ts
  export interface ExecResult { code: number; stdout: string; stderr: string }
  export interface Ssh {
    run(cmd: string, opts?: { inherit?: boolean }): Promise<ExecResult>;
    copy(localFiles: string[], remoteDir: string): Promise<void>;
    tunnel(localPort: number, remotePort: number): { close(): void };
  }
  export function sshKeyPath(): string;                           // <fcxHome>/ssh_ed25519
  export function ensureKey(): Promise<string>;                   // returns public key text
  export function makeSsh(target: string): Ssh;
  export function waitForSsh(ssh: Ssh, timeoutMs: number): Promise<void>;
  ```

- [ ] **Step 1: Failing tests** — `cli/test/infra/hetzner.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { Hetzner, firewallRules } from "../../src/infra/hetzner.js";

type Call = { method: string; url: string; body?: any; auth?: string };
function fake(responses: Record<string, any>) {
  const calls: Call[] = [];
  const f = (async (url: string, init: RequestInit = {}) => {
    const method = init.method ?? "GET";
    calls.push({ method, url, body: init.body ? JSON.parse(String(init.body)) : undefined,
      auth: (init.headers as Record<string, string>)?.Authorization });
    const r = responses[`${method} ${new URL(url).pathname}`] ?? {};
    const status = r.__status ?? 200;
    return new Response(status === 204 ? null : JSON.stringify(r), { status });
  }) as unknown as typeof fetch;
  return { f, calls };
}

describe("firewallRules", () => {
  it("only SSH from me and gossip UDP", () => {
    expect(firewallRules("5.6.7.8")).toEqual([
      { direction: "in", protocol: "tcp", port: "22", source_ips: ["5.6.7.8/32"] },
      { direction: "in", protocol: "udp", port: "3382", source_ips: ["0.0.0.0/0", "::/0"] },
    ]);
  });
});

describe("Hetzner", () => {
  it("sends bearer token and label selector", async () => {
    const { f, calls } = fake({ "GET /v1/servers": { servers: [{ id: 7, name: "fcx-t1" }] } });
    const h = new Hetzner("SECRET123", f, "https://api.test/v1");
    expect(await h.listByLabel("servers", "t1")).toEqual([{ id: 7, name: "fcx-t1" }]);
    expect(calls[0].auth).toBe("Bearer SECRET123");
    expect(calls[0].url).toBe("https://api.test/v1/servers?label_selector=fcx%3Dt1");
  });
  it("creates server with user data, firewall, label, ubuntu-24.04", async () => {
    const { f, calls } = fake({ "POST /v1/servers": { server: { id: 7, public_net: { ipv4: { ip: "1.2.3.4" } } } } });
    const h = new Hetzner("T", f, "https://api.test/v1");
    const r = await h.createServer({ name: "fcx-t1", type: "ccx23", location: "fsn1", sshKey: "fcx",
      firewallId: 22, label: "t1", userData: "#cloud-config" });
    expect(r).toEqual({ id: 7, ip: "1.2.3.4" });
    expect(calls[0].body).toEqual({ name: "fcx-t1", server_type: "ccx23", image: "ubuntu-24.04",
      location: "fsn1", ssh_keys: ["fcx"], firewalls: [{ firewall: 22 }], labels: { fcx: "t1" },
      user_data: "#cloud-config" });
  });
  it("creates 1500 GB ext4 automounted volume", async () => {
    const { f, calls } = fake({ "POST /v1/volumes": { volume: { id: 11 } } });
    const h = new Hetzner("T", f, "https://api.test/v1");
    expect(await h.createVolume({ name: "fcx-t1", serverId: 7, label: "t1", sizeGb: 1500 })).toBe(11);
    expect(calls[0].body).toEqual({ name: "fcx-t1", size: 1500, server: 7, automount: true,
      format: "ext4", labels: { fcx: "t1" } });
  });
  it("API errors carry the message, never the token", async () => {
    const { f } = fake({ "POST /v1/volumes": { __status: 403, error: { code: "resource_limit_exceeded", message: "volume size limit" } } });
    const h = new Hetzner("SECRET123", f, "https://api.test/v1");
    const err = await h.createVolume({ name: "x", serverId: 1, label: "x", sizeGb: 1500 }).catch((e) => e as Error);
    expect(err.message).toMatch(/volume size limit/);
    expect(err.message).not.toMatch(/SECRET123/);
  });
  it("ensureSshKey creates only when missing", async () => {
    const { f, calls } = fake({ "GET /v1/ssh_keys": { ssh_keys: [] }, "POST /v1/ssh_keys": { ssh_key: { id: 1 } } });
    await new Hetzner("T", f, "https://api.test/v1").ensureSshKey("fcx", "ssh-ed25519 AAA");
    expect(calls.map((c) => c.method)).toEqual(["GET", "POST"]);
  });
});
```

- [ ] **Step 2: Run — expect FAIL.**

- [ ] **Step 3: Implement `cli/src/infra/hetzner.ts`**

```ts
import { ipCidr } from "./ttl.js";

export type Kind = "servers" | "volumes" | "firewalls";
export interface Rule { direction: "in"; protocol: "tcp" | "udp"; port: string; source_ips: string[] }

export class HetznerError extends Error {
  constructor(message: string, public status: number, public code: string) { super(message); }
}

export function firewallRules(myIp: string): Rule[] {
  return [
    { direction: "in", protocol: "tcp", port: "22", source_ips: [ipCidr(myIp)] },
    { direction: "in", protocol: "udp", port: "3382", source_ips: ["0.0.0.0/0", "::/0"] },
  ];
}

export class Hetzner {
  constructor(private token: string, private fetchImpl: typeof fetch = fetch,
              private base = "https://api.hetzner.cloud/v1") {}

  private async req<T = any>(method: string, path: string, body?: unknown): Promise<T> {
    const res = await this.fetchImpl(this.base + path, {
      method,
      headers: { Authorization: `Bearer ${this.token}`, "Content-Type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    if (res.status === 204) return undefined as T;
    const json: any = await res.json().catch(() => ({}));
    if (!res.ok) {
      throw new HetznerError(`Hetzner ${method} ${path.split("?")[0]}: ${json?.error?.message ?? res.status}`,
        res.status, json?.error?.code ?? "unknown");
    }
    return json as T;
  }

  async listByLabel(kind: Kind, name: string) {
    const r = await this.req("GET", `/${kind}?label_selector=${encodeURIComponent(`fcx=${name}`)}`);
    return (r[kind] as any[]).map((x) => ({ id: x.id as number, name: x.name as string }));
  }
  async ensureSshKey(name: string, publicKey: string) {
    const r = await this.req("GET", `/ssh_keys?name=${encodeURIComponent(name)}`);
    if (r.ssh_keys.length === 0) await this.req("POST", "/ssh_keys", { name, public_key: publicKey });
  }
  async createFirewall(name: string, label: string, rules: Rule[]) {
    const r = await this.req("POST", "/firewalls", { name, labels: { fcx: label }, rules });
    return r.firewall.id as number;
  }
  async setFirewallRules(id: number, rules: Rule[]) {
    await this.req("POST", `/firewalls/${id}/actions/set_rules`, { rules });
  }
  async createServer(o: { name: string; type: string; location: string; sshKey: string;
    firewallId: number; label: string; userData: string }) {
    const r = await this.req("POST", "/servers", {
      name: o.name, server_type: o.type, image: "ubuntu-24.04", location: o.location,
      ssh_keys: [o.sshKey], firewalls: [{ firewall: o.firewallId }], labels: { fcx: o.label },
      user_data: o.userData,
    });
    return { id: r.server.id as number, ip: r.server.public_net.ipv4.ip as string };
  }
  async createVolume(o: { name: string; serverId: number; label: string; sizeGb: number }) {
    const r = await this.req("POST", "/volumes", { name: o.name, size: o.sizeGb, server: o.serverId,
      automount: true, format: "ext4", labels: { fcx: o.label } });
    return r.volume.id as number;
  }
  async deleteServer(id: number) { await this.req("DELETE", `/servers/${id}`); }
  async detachVolume(id: number) { await this.req("POST", `/volumes/${id}/actions/detach`); }
  async deleteVolume(id: number) { await this.req("DELETE", `/volumes/${id}`); }
  async deleteFirewall(id: number) { await this.req("DELETE", `/firewalls/${id}`); }
}
```

- [ ] **Step 4: Implement `cli/src/infra/ssh.ts`** (thin wrapper over system OpenSSH; verified for real in run 1)

```ts
import { spawn } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fcxHome } from "./paths.js";

export interface ExecResult { code: number; stdout: string; stderr: string }
export interface Ssh {
  run(cmd: string, opts?: { inherit?: boolean }): Promise<ExecResult>;
  copy(localFiles: string[], remoteDir: string): Promise<void>;
  tunnel(localPort: number, remotePort: number): { close(): void };
}

export const sshKeyPath = () => join(fcxHome(), "ssh_ed25519");
const OPTS = () => ["-i", sshKeyPath(), "-o", "StrictHostKeyChecking=accept-new",
  "-o", "ConnectTimeout=10", "-o", "BatchMode=yes", "-o", "ServerAliveInterval=30"];

function exec(bin: string, args: string[], inherit = false): Promise<ExecResult> {
  return new Promise((resolve) => {
    const p = spawn(bin, args, { stdio: inherit ? "inherit" : ["ignore", "pipe", "pipe"] });
    let stdout = "", stderr = "";
    p.stdout?.on("data", (d) => (stdout += d)); p.stderr?.on("data", (d) => (stderr += d));
    p.on("close", (code) => resolve({ code: code ?? 1, stdout, stderr }));
  });
}

export async function ensureKey(): Promise<string> {
  const k = sshKeyPath();
  if (!existsSync(k)) {
    const r = await exec("ssh-keygen", ["-q", "-t", "ed25519", "-N", "", "-C", "fcx", "-f", k]);
    if (r.code !== 0) throw new Error(`ssh-keygen failed: ${r.stderr}`);
  }
  return readFileSync(`${k}.pub`, "utf8").trim();
}

export function makeSsh(target: string): Ssh {
  return {
    run: (cmd, o) => exec("ssh", [...OPTS(), target, cmd], o?.inherit),
    async copy(files, dir) {
      const r = await exec("scp", ["-q", ...OPTS(), ...files, `${target}:${dir}/`]);
      if (r.code !== 0) throw new Error(`scp failed: ${r.stderr.trim()}`);
    },
    tunnel(local, remote) {
      const p = spawn("ssh", [...OPTS(), "-N", "-L", `${local}:127.0.0.1:${remote}`, target], { stdio: "ignore" });
      return { close: () => p.kill() };
    },
  };
}

export async function waitForSsh(ssh: Ssh, timeoutMs: number): Promise<void> {
  const end = Date.now() + timeoutMs;
  while (Date.now() < end) {
    if ((await ssh.run("true")).code === 0) return;
    await new Promise((r) => setTimeout(r, 5000));
  }
  throw new Error("Server did not accept SSH in time.");
}
```

- [ ] **Step 5: Run — expect PASS.** `npm test`

- [ ] **Step 6: Commit**

```bash
git add cli/src/infra/hetzner.ts cli/src/infra/ssh.ts cli/test/infra/hetzner.test.ts
git commit -m "feat(infra): Hetzner REST client and OpenSSH wrapper"
```

---

### Task 5: `provision` (Hetzner + `--host`)

**Files:**
- Create: `cli/src/infra/provision.ts`, `cli/test/infra/provision.test.ts`

**Interfaces:**
- Consumes: Tasks 3–4.
- Produces:
  ```ts
  export interface ProvisionOpts { ttl: string; name?: string; type: string; location: string;
    keep: boolean; host?: string; dataDir?: string }
  export interface ProvisionDeps { api: () => Hetzner; ssh: (target: string) => Ssh;
    myIp: () => Promise<string>; now: () => number; publicKey: () => Promise<string>;
    readToken: () => string; waitMs: number; log: (s: string) => void }
  export function defaultProvisionDeps(): ProvisionDeps;
  export function provision(o: ProvisionOpts, d: ProvisionDeps): Promise<RunState>;
  ```

- [ ] **Step 1: Failing tests** — `cli/test/infra/provision.test.ts`:

```ts
import { describe, it, expect, beforeEach } from "vitest";
import { mkdtempSync } from "node:fs"; import { tmpdir } from "node:os"; import { join } from "node:path";
import { provision, type ProvisionDeps } from "../../src/infra/provision.js";
import { loadState } from "../../src/infra/state.js";

beforeEach(() => { process.env.FCX_HOME = mkdtempSync(join(tmpdir(), "fcx-")); });

function deps(existing: string[] = []) {
  const calls: string[] = [];
  const api: any = {
    listByLabel: async (k: string) => (existing.includes(k) ? [{ id: 1, name: "x" }] : []),
    ensureSshKey: async () => { calls.push("sshkey"); },
    createFirewall: async (n: string, _l: string, rules: any) => { calls.push(`fw ${n} ${JSON.stringify(rules)}`); return 22; },
    createServer: async (o: any) => { calls.push(`server ${o.name} ${o.type} ${o.location} ${o.userData.startsWith("#cloud-config")}`); return { id: 7, ip: "1.2.3.4" }; },
    createVolume: async (o: any) => { calls.push(`volume ${o.name} ${o.sizeGb}`); return 11; },
  };
  const ssh: any = { run: async () => ({ code: 0, stdout: "", stderr: "" }), copy: async () => {} };
  const d: ProvisionDeps = { api: () => api, ssh: () => ssh, myIp: async () => "5.6.7.8", now: () => 1000,
    publicKey: async () => "ssh-ed25519 AAA", readToken: () => "SECRET123", waitMs: 0, log: () => {} };
  return { d, calls };
}

describe("provision", () => {
  it("creates firewall, server, volume in order with locked-down rules", async () => {
    const { d, calls } = deps();
    await provision({ ttl: "2h", name: "t1", type: "ccx23", location: "fsn1", keep: false }, d);
    expect(calls[0]).toBe("sshkey");
    expect(calls[1]).toBe('fw fcx-t1 [{"direction":"in","protocol":"tcp","port":"22","source_ips":["5.6.7.8/32"]},{"direction":"in","protocol":"udp","port":"3382","source_ips":["0.0.0.0/0","::/0"]}]');
    expect(calls[2]).toBe("server fcx-t1 ccx23 fsn1 true");
    expect(calls[3]).toBe("volume fcx-t1 1500");
  });
  it("saves state with deadline = now + ttl", async () => {
    const { d } = deps();
    await provision({ ttl: "2h", name: "t1", type: "ccx23", location: "fsn1", keep: false }, d);
    expect(loadState()).toEqual({ name: "t1", mode: "hetzner", sshTarget: "root@1.2.3.4", dataDir: "/mnt/fcx", deadline: 1000 + 7200 });
  });
  it("keep → deadline 0", async () => {
    const { d } = deps();
    await provision({ ttl: "8h", name: "t1", type: "ccx23", location: "fsn1", keep: true }, d);
    expect(loadState()!.deadline).toBe(0);
  });
  it("refuses when any labelled resource exists", async () => {
    const { d, calls } = deps(["firewalls"]);
    await expect(provision({ ttl: "8h", name: "t1", type: "ccx23", location: "fsn1", keep: false }, d))
      .rejects.toThrow(/already exists[\s\S]*fcx destroy/);
    expect(calls).toEqual([]);
  });
  it("bad ttl fails before any API call", async () => {
    const { d, calls } = deps();
    await expect(provision({ ttl: "soon", type: "ccx23", location: "fsn1", keep: false }, d)).rejects.toThrow(/bad TTL/);
    expect(calls).toEqual([]);
  });
  it("--host makes no Hetzner calls and runs host-check", async () => {
    const { d, calls } = deps(); const ran: string[] = [];
    d.ssh = () => ({ run: async (c: string) => { ran.push(c); return { code: 0, stdout: "ok", stderr: "" }; },
      copy: async () => {}, tunnel: () => ({ close() {} }) });
    const s = await provision({ ttl: "8h", type: "ccx23", location: "fsn1", keep: false, host: "ubuntu@9.9.9.9" }, d);
    expect(calls).toEqual([]); expect(s.mode).toBe("host"); expect(s.deadline).toBe(0);
    expect(ran.some((c) => c.includes("host-check.sh"))).toBe(true);
  });
});
```

- [ ] **Step 2: Run — expect FAIL.**

- [ ] **Step 3: Implement `cli/src/infra/provision.ts`**

```ts
import { join } from "node:path";
import { Hetzner, firewallRules } from "./hetzner.js";
import { makeSsh, ensureKey, waitForSsh, type Ssh } from "./ssh.js";
import { parseTtl } from "./ttl.js";
import { readToken } from "./token.js";
import { renderCloudInit } from "./cloudinit.js";
import { saveState, type RunState } from "./state.js";
import { remoteDir } from "./paths.js";

export interface ProvisionOpts { ttl: string; name?: string; type: string; location: string;
  keep: boolean; host?: string; dataDir?: string }
export interface ProvisionDeps { api: () => Hetzner; ssh: (target: string) => Ssh;
  myIp: () => Promise<string>; now: () => number; publicKey: () => Promise<string>;
  readToken: () => string; waitMs: number; log: (s: string) => void }

export function defaultProvisionDeps(): ProvisionDeps {
  return {
    api: () => new Hetzner(readToken()), ssh: makeSsh, now: () => Math.floor(Date.now() / 1000),
    myIp: async () => (await (await fetch("https://api.ipify.org")).text()).trim(),
    publicKey: ensureKey, readToken, waitMs: 5 * 60_000, log: (s) => console.log(s),
  };
}

const stamp = () => new Date().toISOString().slice(0, 16).replace(/[-:T]/g, "");

export async function provision(o: ProvisionOpts, d: ProvisionDeps): Promise<RunState> {
  const secs = o.keep ? 0 : parseTtl(o.ttl);
  const name = o.name ?? `trial-${stamp()}`;

  if (o.host) {
    await d.publicKey();
    const ssh = d.ssh(o.host);
    const dataDir = o.dataDir ?? "/mnt/fcx";
    await ssh.run("sudo mkdir -p /opt/fcx && sudo chown $(id -u) /opt/fcx");
    await ssh.copy([join(remoteDir(), "host-check.sh")], "/opt/fcx");
    const r = await ssh.run(`sudo bash /opt/fcx/host-check.sh ${dataDir}`);
    d.log(r.stdout.trim());
    if (r.code !== 0) throw new Error("This server does not meet the requirements above.");
    const s: RunState = { name, mode: "host", sshTarget: o.host, dataDir, deadline: 0 };
    saveState(s);
    d.log(`Using your server ${o.host}. Next: fcx node`);
    return s;
  }

  const api = d.api();
  for (const kind of ["servers", "volumes", "firewalls"] as const) {
    if ((await api.listByLabel(kind, name)).length > 0)
      throw new Error(`Run '${name}' already exists. Use it, or run: fcx destroy`);
  }
  const deadline = secs === 0 ? 0 : d.now() + secs;
  const userData = renderCloudInit({ name, deadline, token: d.readToken(), keep: secs === 0 });

  d.log(`Creating firewall, server (${o.type}, ${o.location}) and 1.5 TB volume…`);
  await api.ensureSshKey("fcx", await d.publicKey());
  const fw = await api.createFirewall(`fcx-${name}`, name, firewallRules(await d.myIp()));
  const server = await api.createServer({ name: `fcx-${name}`, type: o.type, location: o.location,
    sshKey: "fcx", firewallId: fw, label: name, userData });
  await api.createVolume({ name: `fcx-${name}`, serverId: server.id, label: name, sizeGb: 1500 });

  const s: RunState = { name, mode: "hetzner", sshTarget: `root@${server.ip}`, dataDir: "/mnt/fcx", deadline };
  saveState(s);
  if (d.waitMs > 0) await waitForSsh(d.ssh(s.sshTarget), d.waitMs);
  d.log(`Server ready at ${server.ip}.`);
  d.log(deadline === 0 ? "No auto-destroy. You pay until you run: fcx destroy"
                       : `Auto-destroy in ${o.ttl}. Extend with: fcx extend 4h`);
  d.log("Next: fcx node");
  return s;
}
```

- [ ] **Step 4: Run — expect PASS.**

- [ ] **Step 5: Commit**

```bash
git add cli/src/infra/provision.ts cli/test/infra/provision.test.ts
git commit -m "feat(infra): provision on Hetzner or your own host"
```

---

### Task 6: `node`, `status`, `extend`, `allow-ip`, `destroy`

**Files:**
- Create: `cli/src/infra/status.ts`, `node.ts`, `extend.ts`, `allowip.ts`, `destroy.ts`; `cli/test/infra/status.test.ts`, `node.test.ts`, `destroy.test.ts`

**Interfaces:**
- Consumes: Tasks 2–5.
- Produces:
  ```ts
  // status.ts
  export interface NodeStatus { phase: string; shard: number | null; chunk: number | null;
    chunks: number | null; eta: string | null; max_block_delay: number | null;
    disk_used_gb: number; disk_free_gb: number; ram_used_gb: number; deadline: number;
    ttl: string; ssh: "ok" | "blocked" }
  export function getStatus(ssh: Ssh): Promise<NodeStatus>;
  export function formatLine(s: NodeStatus): string;
  export function formatHuman(s: NodeStatus): string;
  // node.ts
  export function startNode(s: RunState, ssh: Ssh, o: { wait: boolean; pollMs: number;
    log: (s: string) => void; line: (s: string) => void }): Promise<void>;
  // extend.ts
  export function extend(s: RunState, ssh: Ssh, ttl: string, now: number): Promise<RunState>;
  // allowip.ts
  export function allowIp(s: RunState, api: Hetzner, ip: string): Promise<void>;
  // destroy.ts
  export function destroy(s: RunState | null, api: () => Hetzner, ssh: (t: string) => Ssh,
    o: { sleepMs: number; log: (s: string) => void }): Promise<void>;
  ```

- [ ] **Step 1: Failing tests**

`cli/test/infra/status.test.ts`:
```ts
import { describe, it, expect } from "vitest";
import { getStatus, formatLine, formatHuman } from "../../src/infra/status.js";

const ok = (stdout: string) => ({ run: async () => ({ code: 0, stdout, stderr: "" }) }) as any;
const base = { shard: null, chunk: null, chunks: null, eta: null, max_block_delay: null,
  disk_used_gb: 200, disk_free_gb: 1300, ram_used_gb: 3, deadline: 0, ttl: "none" };

describe("status", () => {
  it("parses remote JSON and marks ssh ok", async () => {
    const s = await getStatus(ok(JSON.stringify({ ...base, phase: "ready" })));
    expect(s.phase).toBe("ready"); expect(s.ssh).toBe("ok");
  });
  it("ssh failure → blocked with allow-ip hint", async () => {
    const s = await getStatus({ run: async () => ({ code: 255, stdout: "", stderr: "timed out" }) } as any);
    expect(s.phase).toBe("error"); expect(s.ssh).toBe("blocked");
    expect(formatHuman(s)).toMatch(/fcx allow-ip/);
  });
  it("line for downloading", () => {
    expect(formatLine({ ...base, phase: "downloading", shard: 1, chunk: 120, chunks: 2671, eta: "7h6m", ssh: "ok" } as any))
      .toBe("downloading shard 1 120/2671 ETA 7h6m  disk 200G");
  });
  it("line for syncing", () => {
    expect(formatLine({ ...base, phase: "syncing", max_block_delay: 5400, ssh: "ok" } as any))
      .toBe("syncing 5400 blocks behind  disk 200G");
  });
  it("human shows TTL warning", () => {
    expect(formatHuman({ ...base, phase: "ready", ttl: "warn", ssh: "ok" } as any)).toMatch(/fcx extend/);
  });
});
```

`cli/test/infra/node.test.ts`:
```ts
import { describe, it, expect } from "vitest";
import { startNode } from "../../src/infra/node.js";

const st = { name: "t1", mode: "hetzner" as const, sshTarget: "root@1.2.3.4", dataDir: "/mnt/fcx", deadline: 9 };
function ssh(phases: string[], statusCode = 0) {
  const cmds: string[] = []; let i = 0;
  return { cmds, s: {
    run: async (c: string) => { cmds.push(c);
      if (c.includes("status-remote")) return { code: statusCode, stdout: statusCode ? "" : JSON.stringify({
        phase: phases[Math.min(i++, phases.length - 1)], disk_used_gb: 1, disk_free_gb: 1, ram_used_gb: 1, deadline: 0, ttl: "none" }), stderr: "" };
      return { code: 0, stdout: "", stderr: "" }; },
    copy: async () => {}, tunnel: () => ({ close() {} }) } as any };
}
const quiet = { log: () => {}, line: () => {} };

describe("node", () => {
  it("uploads, runs setup with keep=no for trial, waits until ready", async () => {
    const { s, cmds } = ssh(["downloading", "syncing", "ready"]);
    await startNode(st, s, { wait: true, pollMs: 0, ...quiet });
    expect(cmds.some((c) => c.includes("node-setup.sh no /mnt/fcx"))).toBe(true);
    expect(cmds.filter((c) => c.includes("status-remote")).length).toBe(3);
  });
  it("keep mode passes yes", async () => {
    const { s, cmds } = ssh(["ready"]);
    await startNode({ ...st, deadline: 0 }, s, { wait: true, pollMs: 0, ...quiet });
    expect(cmds.some((c) => c.includes("node-setup.sh yes"))).toBe(true);
  });
  it("disk_full stops waiting with an error", async () => {
    const { s } = ssh(["unpacking", "disk_full"]);
    await expect(startNode(st, s, { wait: true, pollMs: 0, ...quiet })).rejects.toThrow(/disk/i);
  });
  it("blocked SSH stops waiting with allow-ip hint", async () => {
    const { s } = ssh([], 255);
    await expect(startNode(st, s, { wait: true, pollMs: 0, ...quiet })).rejects.toThrow(/fcx allow-ip/);
  });
  it("--no-wait returns after setup", async () => {
    const { s, cmds } = ssh(["downloading"]);
    await startNode(st, s, { wait: false, pollMs: 0, ...quiet });
    expect(cmds.some((c) => c.includes("status-remote"))).toBe(false);
  });
});
```

`cli/test/infra/destroy.test.ts`:
```ts
import { describe, it, expect, beforeEach } from "vitest";
import { mkdtempSync } from "node:fs"; import { tmpdir } from "node:os"; import { join } from "node:path";
import { destroy } from "../../src/infra/destroy.js";
import { saveState, loadState } from "../../src/infra/state.js";

beforeEach(() => { process.env.FCX_HOME = mkdtempSync(join(tmpdir(), "fcx-")); });
const st = { name: "t1", mode: "hetzner" as const, sshTarget: "root@1.2.3.4", dataDir: "/mnt/fcx", deadline: 9 };

describe("destroy", () => {
  it("deletes server, then volumes, then firewalls; clears state", async () => {
    const calls: string[] = [];
    let volumesLeft = [{ id: 11, name: "x" }];
    const api: any = {
      listByLabel: async (k: string) => k === "servers" ? [{ id: 7, name: "x" }] : k === "volumes" ? volumesLeft : [{ id: 22, name: "x" }],
      deleteServer: async (id: number) => { calls.push(`server ${id}`); },
      detachVolume: async () => {},
      deleteVolume: async (id: number) => { calls.push(`volume ${id}`); volumesLeft = []; },
      deleteFirewall: async (id: number) => { calls.push(`fw ${id}`); },
    };
    saveState(st); const logs: string[] = [];
    await destroy(st, () => api, () => ({}) as any, { sleepMs: 0, log: (s) => logs.push(s) });
    expect(calls).toEqual(["server 7", "volume 11", "fw 22"]);
    expect(loadState()).toBeNull();
    expect(logs.join()).toMatch(/Billing stopped/);
  });
  it("no state → nothing to destroy", async () => {
    const logs: string[] = [];
    await destroy(null, () => { throw new Error("no api"); }, () => ({}) as any, { sleepMs: 0, log: (s) => logs.push(s) });
    expect(logs.join()).toMatch(/Nothing to destroy/);
  });
  it("host mode stops the node and keeps the box", async () => {
    const ran: string[] = [];
    await destroy({ ...st, mode: "host" }, () => { throw new Error("no api"); },
      () => ({ run: async (c: string) => { ran.push(c); return { code: 0, stdout: "", stderr: "" }; } }) as any,
      { sleepMs: 0, log: () => {} });
    expect(ran[0]).toMatch(/snapchain.sh down/);
  });
});
```

- [ ] **Step 2: Run — expect FAIL.**

- [ ] **Step 3: Implement**

`cli/src/infra/status.ts`:
```ts
import type { Ssh } from "./ssh.js";

export interface NodeStatus { phase: string; shard: number | null; chunk: number | null;
  chunks: number | null; eta: string | null; max_block_delay: number | null;
  disk_used_gb: number; disk_free_gb: number; ram_used_gb: number; deadline: number;
  ttl: string; ssh: "ok" | "blocked" }

const REMOTE = "sudo FCX_LIB=/opt/fcx/lib.sh bash /opt/fcx/status-remote.sh";

export async function getStatus(ssh: Ssh): Promise<NodeStatus> {
  const r = await ssh.run(REMOTE);
  if (r.code !== 0 || !r.stdout.trim().startsWith("{")) {
    return { phase: "error", shard: null, chunk: null, chunks: null, eta: null, max_block_delay: null,
      disk_used_gb: 0, disk_free_gb: 0, ram_used_gb: 0, deadline: 0, ttl: "none", ssh: "blocked" };
  }
  return { ...JSON.parse(r.stdout), ssh: "ok" };
}

export function formatLine(s: NodeStatus): string {
  let t = s.phase;
  if (s.phase === "downloading") t += ` shard ${s.shard} ${s.chunk}/${s.chunks} ETA ${s.eta ?? "?"}`;
  if (s.phase === "syncing") t += ` ${s.max_block_delay} blocks behind`;
  if (s.disk_used_gb) t += `  disk ${s.disk_used_gb}G`;
  return t;
}

export function formatHuman(s: NodeStatus): string {
  if (s.ssh === "blocked") return "SSH blocked. Your IP may have changed. Run: fcx allow-ip";
  const out = [`Phase:  ${s.phase}`];
  if (s.phase === "downloading") out.push(`Shard:  ${s.shard}  chunk ${s.chunk}/${s.chunks}  ETA ${s.eta ?? "?"}`);
  if (s.max_block_delay !== null) out.push(`Behind: ${s.max_block_delay} blocks`);
  out.push(`Disk:   ${s.disk_used_gb} GB used, ${s.disk_free_gb} GB free`, `RAM:    ${s.ram_used_gb} GB used`);
  if (s.ttl === "warn") out.push("TTL:    under 30 min left. Extend with: fcx extend 4h");
  else if (s.deadline) out.push(`TTL:    auto-destroy at ${new Date(s.deadline * 1000).toLocaleString()}`);
  if (s.phase === "disk_full") out.push("Disk is full. Use a bigger volume (resize in Hetzner) and restart.");
  return out.join("\n");
}
```

`cli/src/infra/node.ts`:
```ts
import { readdirSync } from "node:fs";
import { join } from "node:path";
import { remoteDir } from "./paths.js";
import type { Ssh } from "./ssh.js";
import type { RunState } from "./state.js";
import { getStatus, formatLine } from "./status.js";

export async function startNode(s: RunState, ssh: Ssh,
  o: { wait: boolean; pollMs: number; log: (s: string) => void; line: (s: string) => void }): Promise<void> {
  await ssh.run("sudo mkdir -p /opt/fcx && sudo chown $(id -u) /opt/fcx");
  const files = readdirSync(remoteDir()).filter((f) => !f.endsWith(".tpl")).map((f) => join(remoteDir(), f));
  await ssh.copy(files, "/opt/fcx");
  const keep = s.deadline === 0 ? "yes" : "no";
  o.log("Installing the Snapchain read node (Docker + upstream snapchain.sh v0.14.3)…");
  const r = await ssh.run(`sudo bash /opt/fcx/node-setup.sh ${keep} ${s.dataDir}`, { inherit: true });
  if (r.code !== 0) throw new Error("Node install failed. See the lines above.");
  if (!o.wait) { o.log("Started. Check progress with: fcx status"); return; }

  o.log("Syncing. This takes a few hours. Safe to Ctrl-C: the node keeps going.");
  for (;;) {
    const st = await getStatus(ssh);
    if (st.ssh === "blocked") throw new Error("SSH blocked. Your IP may have changed. Run: fcx allow-ip");
    o.line(formatLine(st));
    if (st.phase === "ready") { o.log("\nNode is synced. Next: fcx login"); return; }
    if (st.phase === "disk_full") throw new Error("Disk is full. Run: fcx status");
    await new Promise((res) => setTimeout(res, o.pollMs));
  }
}
```

`cli/src/infra/extend.ts`:
```ts
import { parseTtl } from "./ttl.js";
import { saveState, type RunState } from "./state.js";
import type { Ssh } from "./ssh.js";

export async function extend(s: RunState, ssh: Ssh, ttl: string, now: number): Promise<RunState> {
  if (s.mode !== "hetzner") throw new Error("Only trial runs on Hetzner have a TTL.");
  const secs = parseTtl(ttl);
  const deadline = secs === 0 ? 0 : now + secs;
  const r = await ssh.run(`echo ${deadline} | sudo tee /etc/fcx/deadline >/dev/null`);
  if (r.code !== 0) throw new Error("Could not reach the server. Run: fcx allow-ip");
  const next = { ...s, deadline };
  saveState(next);
  return next;
}
```

`cli/src/infra/allowip.ts`:
```ts
import { firewallRules, type Hetzner } from "./hetzner.js";
import type { RunState } from "./state.js";

export async function allowIp(s: RunState, api: Hetzner, ip: string): Promise<void> {
  if (s.mode !== "hetzner") throw new Error("Only for Hetzner runs. Update your own firewall.");
  const [fw] = await api.listByLabel("firewalls", s.name);
  if (!fw) throw new Error(`No firewall found for run '${s.name}'.`);
  await api.setFirewallRules(fw.id, firewallRules(ip));
}
```

`cli/src/infra/destroy.ts`:
```ts
import { clearState, type RunState } from "./state.js";
import type { Hetzner } from "./hetzner.js";
import type { Ssh } from "./ssh.js";

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function retry(f: () => Promise<void>, ms: number): Promise<void> {
  for (let i = 0; i < 6; i++) {
    try { await f(); return; } catch { await sleep(ms); }
  }
}

export async function destroy(s: RunState | null, api: () => Hetzner, ssh: (t: string) => Ssh,
  o: { sleepMs: number; log: (s: string) => void }): Promise<void> {
  if (!s) { o.log("Nothing to destroy."); return; }
  if (s.mode === "host") {
    await ssh(s.sshTarget).run("cd ~/snapchain && sudo ./snapchain.sh down");
    clearState(); o.log(`Node stopped on ${s.sshTarget}. Data kept.`); return;
  }
  const h = api();
  for (const x of await h.listByLabel("servers", s.name)) await h.deleteServer(x.id);
  for (const v of await h.listByLabel("volumes", s.name)) {
    await h.detachVolume(v.id).catch(() => {});
    await retry(() => h.deleteVolume(v.id), o.sleepMs);
  }
  for (const f of await h.listByLabel("firewalls", s.name)) await retry(() => h.deleteFirewall(f.id), o.sleepMs);
  const left = (await h.listByLabel("volumes", s.name)).length;
  clearState();
  o.log(left === 0 ? `Run '${s.name}' deleted. Billing stopped.`
                   : "Warning: a volume is still there. Check the Hetzner console.");
}
```

- [ ] **Step 4: Run — expect PASS.** `npm test`

- [ ] **Step 5: Commit**

```bash
git add cli/src/infra cli/test/infra
git commit -m "feat(infra): node, status, extend, allow-ip, destroy"
```

---

### Task 7: CLI entry point

**Files:**
- Modify: `cli/src/cli.ts`
- Create: `cli/test/infra/cli.test.ts`

**Interfaces:**
- Consumes: everything in `src/infra/`.
- Produces: `fcx <command> [options]` with `provision`, `node`, `status`, `extend`, `allow-ip`, `destroy`, `help`. Plan 2 adds client commands to the same `COMMANDS` map. Exit 0 ok, 1 error (message on stderr; stack only with `FCX_DEBUG=1`).
  ```ts
  export const COMMANDS: Record<string, { summary: string; run: (argv: string[]) => Promise<void> }>;
  export function main(argv: string[]): Promise<number>;
  ```

- [ ] **Step 1: Failing test** — `cli/test/infra/cli.test.ts`:

```ts
import { describe, it, expect, vi } from "vitest";
import { main, COMMANDS } from "../../src/cli.js";

describe("cli", () => {
  it("help shows the three-command quickstart", async () => {
    const out: string[] = []; vi.spyOn(console, "log").mockImplementation((s) => { out.push(String(s)); });
    expect(await main(["help"])).toBe(0);
    const text = out.join("\n");
    expect(text).toMatch(/fcx provision --ttl 8h\n  fcx node\n  fcx login --wallet/);
  });
  it("unknown command exits 1", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    expect(await main(["nope"])).toBe(1);
  });
  it("registers infra commands", () => {
    for (const c of ["provision", "node", "status", "extend", "allow-ip", "destroy"]) expect(COMMANDS[c]).toBeDefined();
  });
});
```

- [ ] **Step 2: Run — expect FAIL.**

- [ ] **Step 3: Implement `cli/src/cli.ts`**

```ts
#!/usr/bin/env node
import { parseArgs } from "node:util";
import { realpathSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { createInterface } from "node:readline/promises";
import { provision, defaultProvisionDeps } from "./infra/provision.js";
import { startNode } from "./infra/node.js";
import { getStatus, formatHuman } from "./infra/status.js";
import { extend } from "./infra/extend.js";
import { allowIp } from "./infra/allowip.js";
import { destroy } from "./infra/destroy.js";
import { loadState, requireState } from "./infra/state.js";
import { makeSsh } from "./infra/ssh.js";
import { Hetzner } from "./infra/hetzner.js";
import { readToken } from "./infra/token.js";

const now = () => Math.floor(Date.now() / 1000);
const myIp = async () => (await (await fetch("https://api.ipify.org")).text()).trim();

export const COMMANDS: Record<string, { summary: string; run: (argv: string[]) => Promise<void> }> = {
  provision: {
    summary: "(0) Get a server. --ttl 8h (default) | --keep | --host user@box",
    async run(argv) {
      const { values } = parseArgs({ args: argv, options: {
        ttl: { type: "string", default: "8h" }, keep: { type: "boolean", default: false },
        name: { type: "string" }, type: { type: "string", default: "ccx23" },
        location: { type: "string", default: "fsn1" }, host: { type: "string" }, "data-dir": { type: "string" } } });
      await provision({ ttl: values.ttl!, keep: values.keep!, name: values.name, type: values.type!,
        location: values.location!, host: values.host, dataDir: values["data-dir"] }, defaultProvisionDeps());
    },
  },
  node: {
    summary: "(1) Install the read node and wait until synced. --no-wait",
    async run(argv) {
      const { values } = parseArgs({ args: argv, options: { "no-wait": { type: "boolean", default: false } } });
      const s = requireState();
      await startNode(s, makeSsh(s.sshTarget), { wait: !values["no-wait"], pollMs: 60_000,
        log: (t) => console.log(t), line: (t) => process.stdout.write(`\r\x1b[K${t}`) });
    },
  },
  status: {
    summary: "Sync progress, disk, TTL. --json",
    async run(argv) {
      const { values } = parseArgs({ args: argv, options: { json: { type: "boolean", default: false } } });
      const st = await getStatus(makeSsh(requireState().sshTarget));
      console.log(values.json ? JSON.stringify(st) : formatHuman(st));
      if (st.ssh === "blocked") process.exitCode = 1;
    },
  },
  extend: {
    summary: "Move auto-destroy to now + TTL, e.g. fcx extend 4h (0 = off)",
    async run(argv) {
      const s = requireState();
      const n = await extend(s, makeSsh(s.sshTarget), argv[0] ?? "", now());
      console.log(n.deadline === 0 ? "Auto-destroy is off. Remember: fcx destroy"
                                   : `Auto-destroy at ${new Date(n.deadline * 1000).toLocaleString()}.`);
    },
  },
  "allow-ip": {
    summary: "Allow SSH from your current IP (after a network change)",
    async run() {
      const ip = await myIp();
      await allowIp(requireState(), new Hetzner(readToken()), ip);
      console.log(`SSH allowed from ${ip}.`);
    },
  },
  destroy: {
    summary: "Delete the server and volume. Billing stops. --yes",
    async run(argv) {
      const { values } = parseArgs({ args: argv, options: { yes: { type: "boolean", default: false } } });
      const s = loadState();
      if (s && s.mode === "hetzner" && !values.yes) {
        if (!process.stdin.isTTY) throw new Error("Add --yes to confirm.");
        const rl = createInterface({ input: process.stdin, output: process.stdout });
        const a = await rl.question(`Delete run '${s.name}' and its 1.5 TB volume? [y/N] `); rl.close();
        if (!a.toLowerCase().startsWith("y")) return;
      }
      await destroy(s, () => new Hetzner(readToken()), makeSsh, { sleepMs: 5000, log: (t) => console.log(t) });
    },
  },
};

function help(): void {
  console.log([
    "fcx: your own Farcaster read node and client.",
    "",
    "Quickstart:",
    "  fcx provision --ttl 8h",
    "  fcx node",
    "  fcx login --wallet",
    "",
    "Commands:",
    ...Object.entries(COMMANDS).map(([k, v]) => `  ${k.padEnd(10)} ${v.summary}`),
  ].join("\n"));
}

export async function main(argv: string[]): Promise<number> {
  const [cmd, ...rest] = argv;
  if (!cmd || cmd === "help" || cmd === "--help") { help(); return 0; }
  const c = COMMANDS[cmd];
  if (!c) { console.error(`Unknown command '${cmd}'. Run: fcx help`); return 1; }
  try { await c.run(rest); return Number(process.exitCode ?? 0); }
  catch (e) {
    console.error(process.env.FCX_DEBUG ? e : `error: ${(e as Error).message}`);
    return 1;
  }
}

const isEntry = !!process.argv[1] && realpathSync(process.argv[1]) === fileURLToPath(import.meta.url);
if (isEntry) main(process.argv.slice(2)).then((code) => process.exit(code));
```

- [ ] **Step 4: Run — expect PASS.** `npm test && npm run build && node dist/cli.js help`

- [ ] **Step 5: Smoke-test the packed package** (what `npx` runs):

```bash
cd cli && npm pack && mkdir -p /tmp/fcx-pack && tar -xzf fcx-cli-0.1.0.tgz -C /tmp/fcx-pack
ls /tmp/fcx-pack/package/remote   # lib.sh ttl-destroy.sh node-setup.sh status-remote.sh host-check.sh override tpl
node /tmp/fcx-pack/package/dist/cli.js help
rm -rf /tmp/fcx-pack fcx-cli-0.1.0.tgz
```
(`prepack` from Task 1 builds `dist/` before packing.)

- [ ] **Step 6: Commit**

```bash
git add cli/src/cli.ts cli/test/infra/cli.test.ts
git commit -m "feat: fcx CLI entry with infra commands"
```

---

### Task 8: Run 1 on Hetzner — measure, record fixtures, destroy

Manual runbook. The human does Hetzner signup and the token; the agent does the rest. Use the local build: `cd cli && npm run build && npm link` → `fcx` on PATH.

**Files:**
- Create: `docs/runs/run-1.md`, `docs/runs/run-1.samples.jsonl`, `cli/test/fixtures/node/*.json`, `docs-prs/log.md`
- Modify (only if real log lines differ): `cli/test/remote/fixtures/*.txt`, `cli/remote/lib.sh`

- [ ] **Step 1 (human): Hetzner setup.** New account → **new project "fcx-trial"** → Security → API tokens → Read & Write. Save:

```bash
mkdir -p ~/.config/fcx && pbpaste > ~/.config/fcx/hcloud-token && chmod 600 ~/.config/fcx/hcloud-token
```
Check Limits: a 1500 GB volume and a `ccx23` must be allowed; request an increase if not.

- [ ] **Step 2: Provision + start, with timestamps.**

```bash
date -u +%FT%TZ | tee docs/runs/run-1.start
fcx provision --name run1 --ttl 10h
fcx node --no-wait
```

- [ ] **Step 3: Verify ports from outside and inside.**

```bash
ip=$(node -e 'console.log(require(process.env.HOME+"/.fcx/state.json").sshTarget.split("@")[1])')
for p in 3381 3383 3000 8126; do nc -vz -w3 "$ip" $p; done      # expect all to fail
ssh -i ~/.fcx/ssh_ed25519 root@$ip "ss -tlnup | grep -E '3381|3382|3383|3000|812'"   # expect 127.0.0.1 except 3382/udp
```
If any port listens on `0.0.0.0`, the override was not honoured; the Hetzner firewall still blocks it. Record it and fix the override before run 2.

- [ ] **Step 4: Sample every 15 min until ready; note RAM at each phase change.**

```bash
while true; do s=$(fcx status --json); echo "$(date -u +%FT%TZ) $s" >> docs/runs/run-1.samples.jsonl
  echo "$s"; [ "$(echo "$s" | jq -r .phase)" = ready ] && break; sleep 900; done
```
At each phase change: `ssh … "docker stats --no-stream"`. Save 30 real log lines per phase to `cli/test/remote/fixtures/` if they differ from the synthetic ones; re-run `npm run test:remote`.

- [ ] **Step 5: Open questions, over the tunnel.**

```bash
ssh -i ~/.fcx/ssh_ed25519 -N -L 3381:127.0.0.1:3381 root@$ip &
curl -s localhost:3381/v1/info | jq .
curl -s "localhost:3381/v1/signersByFid?fid=3" | jq 'keys'     # nonce field present? record its name
```

- [ ] **Step 6: Record API fixtures for Plan 2** (public data):

```bash
mkdir -p cli/test/fixtures/node && cd cli/test/fixtures/node
q() { curl -fsS "localhost:3381/v1/$1" | jq . > "$2.json"; }
q info info
q "linksByFid?fid=3&link_type=follow&pageSize=50" links-3
q "castsByFid?fid=3&reverse=true&pageSize=20" casts-3
q "castsByFid?fid=2&reverse=true&pageSize=20" casts-2
q "userDataByFid?fid=3" userdata-3
q "signersByFid?fid=3" signers-3
q "storageLimitsByFid?fid=3" storage-3
q "reactionsByFid?fid=3&reaction_type=Like&pageSize=20" reactions-3
curl -sS "localhost:3381/v1/onChainIdRegistryEventByAddress?address=0x0000000000000000000000000000000000000000" | jq . > idreg-miss.json
cd -
```
(Add `idreg-hit.json` for a known custody address if one is at hand.)

- [ ] **Step 7: Write `docs/runs/run-1.md`:**

```markdown
# Run 1 — 2026-10-18
Server: ccx23 fsn1, 1500 GB volume. Image digest: ___. snapchain.sh v0.14.3.
| Phase | Start (UTC) | End | Duration |
|---|---|---|---|
| provision → SSH ready | | | |
| install (docker + images) | | | |
| download shard 1 / 2 / 0 | | | |
| unzip + unpack | | | |
| catch-up to blockDelay ≤ 10 | | | |
Peak disk: ___ GB at ___. Steady-state disk: ___ GB. Peak RAM: ___ GB.
Download speed: ___ MB/s. Hetzner cost for the run: €___ (Billing page).
Ports check: ___. signersByFid nonce field: ___.
Problems and fixes: ...
```

- [ ] **Step 8: Log upstream doc mismatches** in `docs-prs/log.md`, one line each: page, what it says, what is true, evidence. Start with: README 1.5 TB vs getting-started 2 TB; hello-world uses an onchain KeyGateway tx; running-a-node gives ports only in screenshots.

- [ ] **Step 9: Destroy and verify billing stops.**

```bash
fcx destroy --yes
T=$(cat ~/.config/fcx/hcloud-token)
curl -fsS -H "Authorization: Bearer $T" https://api.hetzner.cloud/v1/servers | jq '.servers|length'   # 0
curl -fsS -H "Authorization: Bearer $T" https://api.hetzner.cloud/v1/volumes | jq '.volumes|length'   # 0
```
If the node is still syncing near the 10h deadline, let the TTL fire instead and run the same two checks. That tests auto-destroy for real.

- [ ] **Step 10: Commit**

```bash
git add docs/runs docs-prs cli/test
git commit -m "docs: run 1 measurements, API fixtures, upstream doc issues"
```

---

## Self-review notes

- Spec §4 quickstart (three `npx fcx-cli` commands, Node + OpenSSH only): Tasks 1, 7. ✅
- Spec §5: provision (5), node (6), status (6), extend/TTL (2, 6), allow-ip (6), destroy (6), `--host` (2, 5), pinned upstream (2), localhost-only ports (2, 4), dedicated project (3 token message, 8). ✅
- Spec §3 open items: timings, disk, RAM, nonce field, port posture → Task 8. Derivation path → Plan 2. ✅
- Review Focus: 1 → status + node tests (Task 6); 2 → ttl-destroy warn (Task 2) + formatHuman (Task 6); 3 → provision refuse (Task 5); 4 → node-setup guard (Task 2) + node test (Task 6); 5 → status-remote disk_full (Task 2) + node test (Task 6). ✅
- Names consistent across tasks: `RunState`, `Ssh`, `ExecResult`, `Hetzner`, `NodeStatus`, `ProvisionDeps`, `remoteDir`, `fcxHome`. ✅
- Not here: Farcaster client commands, site, `agent.md` → Plans 2 and 3.
