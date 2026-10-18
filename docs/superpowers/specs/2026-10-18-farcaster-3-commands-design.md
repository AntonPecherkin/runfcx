# Farcaster in 3 Commands — Design Spec

Date: 2026-10-18
Status: draft, awaiting review
Target: Balaji's $2048 Farcaster client bounty (cast `0x50184b62`, clarifications `0x0a05d5c8`)
Deadline: **2026-10-24 14:47 UTC** (we aim to submit by 10:00 UTC)

## 1. Goal

A microsite + MIT repo that takes a developer from zero to "I posted a cast through my own
Snapchain read node" in three commands, with no API keys from anyone.

Success:
- A tester finishes in ~3–5h (mostly waiting) for ~$2–5 in trial mode.
- 5+ public vouches on Farcaster, at least one by Thu Oct 22.
- Judges can run it by hand or hand `agent.md` to their AI agent.

## 2. Bounty requirements (fixed)

- (0) provision compute via script, (1) Snapchain read node, (2) client reading from that node.
- Read node runs with no API keys.
- Client: import seed phrase of an account with storage, add its own app key, read feed, cast,
  follow, react, include/exclude casts from any other client.
- Tutorial explains FIDs, custody addresses, app keys, Snapchain messages, read nodes vs
  validators, storage rent. Mobile- and desktop-friendly. Not AI slop.
- Submit: microsite URL, MIT GitHub repo, link to a voucher's cast.

Clarifications from Balaji (cast `0x0a05d5c8`):
- Read nodes accept writes and relay them to validators via gossip (no separate validator endpoint).
- App keys are gasless (`KEY_ADD` message, no Optimism tx).
- Treat seed phrases like `rm -rf`: test accounts, trusted software, prefer delegated signing.
- Upstream doc PRs to `farcasterxyz` repos help with winning.

## 3. Verified facts (as of 2026-10-18)

- Mainnet snapshot: 5,689 chunks × ~70 MB ≈ **400 GB compressed** (shard 0: 370, shard 1: 2,671,
  shard 2: 2,648). Downloaded sequentially, one chunk at a time.
- Node spec: 16 GB RAM, 4 vCPU, 1.5 TB disk, ports 3381–3383 TCP+UDP.
- HTTP API on 3381 includes: `linksByFid`, `castsByFid`, `castById`, `reactionsByFid`,
  `reactionById`, `linkById`, `userDataByFid`, `signersByFid` (returns `requestFid`),
  `storageLimitsByFid`, `onChainIdRegistryEventByAddress`, `submitMessage`, `info`, `events`.
- `@farcaster/core@0.20.0` (npm) exports `makeKeyAddBody`, `makeKeyAdd`,
  `getGaslessSignedKeyRequestMetadata`, `GASLESS_KEY_ADD_EIP_712_TYPES`, `ViemWalletEip712Signer`,
  `makeKeyRemoveBodySelfRevoke`.
- No feed endpoint exists. Client builds the feed itself.
- Read nodes accept writes: they validate, gossip on the `mempool` topic, keep nothing. Success
  means "accepted for relay", not "in a block" — hence confirm + resubmit.
- Disk requirement conflicts upstream: README says 1.5 TB, getting-started and AWS guide say 2 TB
  (upstream doc PR #1).
- Why the disk peak is high (`src/storage/db/snapshot.rs`): all ~400 GB of chunks are downloaded
  first, each shard is gunzipped into a `.tar` then unpacked, and chunks are deleted only at the
  very end. Estimated peak ~1.1–1.3 TB, steady state ~0.5–0.6 TB (to be measured).
- Can't reduce: syncing one shard (users split across shards 1 and 2), pruning (events only),
  syncing without snapshot (slower, same size).

Open items to verify on day 1:
- Real download / unpack / catch-up time, peak disk, steady-state disk and peak RAM on Hetzner
  (and whether 8 GB RAM would be enough).
- Hetzner volume I/O fast enough for unpacking; real hourly cost.
- HTTP `signersByFid` exposes `currentUserNonce` (else use gRPC over the tunnel).
- Farcaster app seed phrase uses `m/44'/60'/0'/0/0`.
- GitHub owner and site URL (`<owner>`, `<site>` below) — pick before the first public post.
  Package / CLI name decided: npm `fcx-cli`, binary `fcx`.

## 4. Architecture

```
 LAPTOP                                    HETZNER SERVER (or your own box)
 (0) fcx provision   ── Hetzner API ─▶    Ubuntu + Docker + 1.5 TB volume
 (1) fcx node        ── SSH ─────────▶    official snapchain bootstrap (pinned commit) → read node
 (2) fcx login/feed  ── SSH tunnel ──▶    HTTP :3381 (reads + submitMessage)
     ~/.fcx/key                            gossip :3382/udp ⇄ validators
```

Quickstart — exactly three commands, only Node.js ≥ 20 required (no git clone, no hcloud CLI):
```bash
npx fcx-cli provision --ttl 8h   # (0)  or: --host user@your-box
npx fcx-cli node                 # (1)  waits until synced
npx fcx-cli login --wallet       # (2)  then: npx fcx-cli feed / cast / follow / like
```
`npm i -g fcx-cli` gives the short `fcx` binary for daily use.

Repo layout (MIT, one repo `<owner>/fcx-cli`):
- `cli/` — npm package `fcx-cli` (TypeScript). `src/infra/` drives the Hetzner API (plain `fetch`)
  and the system `ssh`; `src/client/` is the Farcaster client. `remote/` holds the bash scripts
  copied to the server (tested with bats).
- `site/` — microsite, `agent.md`, `llms.txt`.
- `docs-prs/` — log of upstream doc issues found and PRs opened.

### Modes
- **Trial (default for testers):** Hetzner hourly, `--ttl 8h` auto-destroy.
- **Keep it running:** same scripts without TTL; tutorial section with monthly cost options
  (Hetzner, dedicated/auction, Contabo, any Ubuntu box via `--host`).

## 5. Infra (`fcx provision | node | status | extend | allow-ip | destroy`)

- `provision`: creates a server (dedicated vCPU, 16 GB RAM class), a 1.5 TB volume, a firewall
  (22 from the caller's IP only; 3382/udp gossip open; **3381, 3383, Grafana and statsd bound to 127.0.0.1**), SSH key auth only.
  `--ttl` installs an on-server timer that deletes server + volume via the Hetzner API.
  `--host user@box` skips creation and only checks specs and ports.
- `node`: installs Docker, runs the official `snapchain-bootstrap.sh` pinned to a commit,
  then polls `/v1/info` until `blockDelay ≈ 0`, printing phase, progress and ETA.
- `status [--json]`: phase (downloading / unpacking / catching up / ready), %, ETA, disk use,
  TTL left.
- `destroy`: deletes server, volume, firewall. Idempotent.

Security:
- Trial mode requires a **dedicated Hetzner project** for the token stored on the box
  (Hetzner tokens are project-wide). Tutorial explains why.
- Client reaches 3381 only through an SSH tunnel (encrypted, not public).
- Bootstrap script pinned to a commit and shown in the tutorial.

## 6. Client (`cli/src/client/`, `fcx`)

Commands (all support `--json`):
```
fcx provision | node | status | extend | allow-ip | destroy   (Section 5)
fcx login [--wallet] | logout | whoami
fcx feed [--limit N] [--only-client <fid>] [--exclude-client <fid>]
fcx clients
fcx cast "<text>" [--reply-to <hash>] [--channel <url>]
fcx follow|unfollow @user
fcx like|unlike|recast|unrecast <hash>
fcx user @user
fcx node
```

Feed: `linksByFid(me)` → parallel `castsByFid(reverse)` for each followed FID (≤8 concurrent) →
merge by timestamp → hydrate names via `userDataByFid`. Cache in `~/.fcx/cache`.

Include/exclude by client: cast `signer` → `signersByFid(author).requestFid` (app FID), cached.
`fcx clients` lists app FIDs seen in the feed with counts.

Writes: build + sign with app key → `POST /v1/submitMessage` → poll `*ById` until present →
resubmit the same signed message after ~15s, up to 3 tries → clear error.

Code is written to be read: the tutorial quotes it. Small files, short functions, comments where
the protocol is non-obvious.

Modules: `node-client` (HTTP + tunnel), `feed`, `signers`, `writer`, `keystore`, `login`, `cli`.
Deps: `@farcaster/core`, `viem`, a small arg parser. Exact versions, lockfile.

## 7. Login

Shared:
1. Generate Ed25519 app key locally.
2. Resolve FID from custody address; require storage (`storageLimitsByFid`); read nonce.
3. Custody signs gasless `SignedKeyRequest` (requestFid = user's own FID) and `KeyAdd`
   (scopes: cast add/remove, link add/remove, reaction add/remove; TTL 30 days).
4. Build `KEY_ADD` signed by the app key, submit via own node, confirm in `signersByFid`.
5. Save app key + FID to `~/.fcx/key` (0600).

Modes:
- `fcx login --wallet` (recommended): local page on `127.0.0.1` (random port, one-time token),
  browser extension wallet (MetaMask/Rabby/hardware), plain-English description of what is signed,
  checks the wallet is the custody address. No WalletConnect (would need an API key).
- `fcx login` (seed phrase, required by bounty): warning first, hidden prompt, memory only,
  verifies derived address = custody before signing, never written to disk or logs.

Both require a TTY. Run by an agent, they refuse and tell the human to run it.
`fcx logout` = self-revoking `KEY_REMOVE`, no seed phrase needed.

## 8. Agent track (`site/agent.md`, `site/llms.txt`)

User says: "Set up my own Farcaster node and client by following https://<site>/agent.md".

Phases: check prerequisites → confirm cost + TTL with the human → provision → run node and poll
`fcx status --json`, reporting progress → hand off to human for `fcx login` → verify with
`fcx whoami --json` → demo commands → remind about `fcx destroy` / TTL.

Hard rules: never ask for or handle seed phrases or the Hetzner token in chat; never post, follow
or like without the human's OK; always state cost and TTL. Includes an error table
(symptom → cause → fix). Tested with at least 2 different agents.

## 9. Microsite (`site/`)

Static, GitHub Pages, mobile + desktop, light + dark, no heavy framework.

Order:
1. Quickstart: 3 commands, "or tell your agent" tab, measured cost/time box.
2. Before you start: Node.js ≥ 20, a Hetzner project + token, and a **test account** —
   how to get one (create in the Farcaster app, find its seed phrase, check it has storage,
   what storage costs).
3. Choose a path: Trial / Keep it running / I have a server.
3. Tutorial chapters (0) compute, (1) read node, (2) client — concepts explained where they
   come up: FIDs, custody, storage rent, app keys (gasless, scopes, TTL), messages and signatures,
   shards and snapshots, read node vs validator, relay and confirmation, feed building, app FIDs.
   Chapter (2) is a developer walkthrough: short real snippets from `cli/src/client/` for
   reading the feed, signing `KEY_ADD`, signing + submitting a cast, confirming it — so readers can
   build their own client, not only run ours.
4. Operate your node: upgrades (upstream auto-upgrade cron in keep mode), logs, Grafana through
   the tunnel, disk growth, restarts, monthly cost.
5. What's different from the official docs: gasless keys, writes through read nodes, ports,
   disk peak — each linked to our upstream PR.
6. Safety: seed phrases as `rm -rf`, test accounts, delegated signing, what each key can do,
   our security choices.
7. Troubleshooting. What we fixed upstream.
8. Vouch: template the tester edits in their own words, posted from their own node via `fcx cast`.

Visuals: architecture SVG that highlights per chapter; replayable "life of a cast" animation
(sign → submit → relay → validator → block → confirmed); terminal replays from real runs;
key diagram (custody → FID → app keys); sync phases with real timings; cost card.
One accent color (Farcaster purple), clean typography.

Writing rules:
- Short sentences. What to do first, then why in one or two lines.
- Banned: "not X, but Y" / "A, not B" contrasts; "seamless", "robust", "leverage", "delve",
  "unlock", "powerful", "journey", "dive in"; em-dash chains; rule-of-three lists; hype emoji;
  recap paragraphs.
- Real terminal output, real numbers. Human pass on every page.

Stretch (only if ahead by Thu): `fcx ui` web view → 59s vertical video → Chinese translation.

Upstream contributions (section "What we fixed upstream"):
- Doc PR: reconcile 1.5 TB vs 2 TB, explain the disk peak with measured numbers.
- Doc PR: hello-world guide → gasless `KEY_ADD`, own node, no Optimism tx.
- Stretch code PR to `farcasterxyz/snapchain`: delete each shard's chunks right after unpacking
  to cut peak disk by up to ~400 GB. Only after run 1 confirms the numbers.

## 10. Submission

- Reply to cast `0x50184b62` with: (1) microsite URL, (2) GitHub repo URL, (3) voucher cast URL.
  More vouch links can follow in later replies.
- Before posting: the submitting Farcaster account has a public wallet address (payout in USDC).
- Deadline 2026-10-24 14:47:30 UTC; target 10:00 UTC.

## 11. Testing

- TDD unit tests: feed merge/filter, signer → app mapping, message building, retry/confirm.
- No long-lived server. Every run uses `--ttl` and is destroyed after; each run also tests auto-destroy.
- Hetzner run 1 (Sun): measure sync, verify open items, record real API responses as test fixtures. TTL ~10h.
- Between runs: `fcx` built offline against fixtures + unit tests.
- Hetzner run 2 (Tue): integration window — login, writes + confirm, live feed. TTL ~10h.
- Hetzner run 3 (Wed): clean run of final scripts from zero, driven by an agent via `agent.md`.
- Extra run only if run 3 fails. Tester runs are logged as further tests.

## 12. Timeline

| Day | Build | Testers |
|---|---|---|
| Sun 18 | Run 1: measure sync, verify open items, record fixtures | Post call for testers |
| Mon 19 | Infra scripts + TTL; `fcx` skeleton, reads, feed (offline, fixtures) | Collect names |
| Tue 20 | Run 2: login (both modes), writes + confirm, live feed + filters | — |
| Wed 21 | Run 3 (agent-driven, clean); site start | Beta to 1–2 testers |
| Thu 22 | Site text + visuals; upstream doc PRs | Main test wave |
| Fri 23 | Fixes, polish, stretch | Collect vouches |
| Sat 24 | Check wallet address; submit by 10:00 UTC | Late vouches |

Budget: Hetzner ~$12–20 total for us (3 runs); testers ~$2–5 each.

## 13. Risks

1. Sync slower than expected → measured day 1, timeline adjusted.
2. Too few testers → recruit from day 1, personal asks.
3. Hetzner new-account limits → keep DigitalOcean notes as fallback.
4. Gossip drops writes → confirm + resubmit loop.
5. Network volume I/O too slow → switch to a server type with local NVMe.

## 14. Out of scope

MCP server, Farcaster-app QR approval (C2), WalletConnect, web UI (stretch only),
running validators, creating new FIDs or buying storage.
