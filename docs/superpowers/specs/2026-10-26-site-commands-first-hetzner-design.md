# Site: commands first, Hetzner for step (0), no Vultr promotion

Date: 2026-10-26
Status: approved in chat, awaiting doc review

## Why

Balaji's bounty asks for "three commands, as described in your quickstart [at the top of the page]
and then detailed in your tutorial": (0) provision compute via script, (1) Snapchain read node,
(2) client. Today the landing page opens with the agent paste-line and a Vultr referral pitch,
and step (0) on Vultr is a manual 10-minute dashboard job followed by `provision --host`. A judge
should see the three commands first, and (0) should really be one script.

The owner no longer wants to promote Vultr (no referral link, no code, no "$300 credit / you pay
$0"). Hetzner becomes the scripted provider; it already exists in the CLI (`runfcx provision`
with an API token, creates server + 1 TB volume + firewall, 8 h auto-destroy).

## Goals

- First thing on `index.html`: the commands, then the agent line.
- Step (0) everywhere = Hetzner `npx runfcx provision`. Vultr (or any Ubuntu box) stays as a
  neutral fallback: `provision --host root@IP --data-dir /mnt/fcx`, no referral, no credit pitch.
- Site text matches the bounty and Balaji's clarifications: read nodes accept writes and relay to
  validators; app keys are gasless (no Optimism tx); seed phrases treated like `rm -rf`.
- Fix old names (`fcx`, `fcx-cli`) and the failing release check.
- Afterwards, a real Hetzner run replaces estimates with measured numbers.

## Non-goals

- No new landing-page sections, no redesign of look and feel. Keep the existing structure.
- No CLI behavior changes, unless the Hetzner run exposes a bug (then fix it, normal TDD flow).
- No Chinese translation, no video.

## Anti-goals

- Claiming measured numbers for Hetzner before the run. Until then every Hetzner cost is labeled
  "estimate" with the list price date.
- Any leftover referral link or "free credit" line on any page, `agent.md`, `llms.txt`, `site.json`.

## Landing page (`site/index.html`)

1. **Hero** — replace the paste-line hero with one terminal block (layout A, chosen by owner):
   ```
   # first: a Hetzner Cloud API token (2 min) → server.html#hetzner
   # (0) get a server
   npx runfcx provision
   # (1) start a Snapchain read node, wait for sync
   npx runfcx node
   # (2) give the client its own app key, then use it
   npx runfcx login --wallet
   npx runfcx feed · cast · follow · like
   # done? delete the server, billing stops
   npx runfcx destroy
   ```
   Headline stays about owning a node + client; lede: no API keys, no gas, half the disk. Copy
   button for the block (or per command — builder's call).
2. **Agent line right under it** — "Or hand it to your agent:" + existing `agent-line` prompt with
   Copy. The current chat mockup on the right may stay or go (builder's call; keep the page simple).
3. **"What we found running it"** — unchanged. Its kicker says "Measured on our mainnet runs";
   keep, the numbers are provider-independent.
4. **"Run it for $0" → "What it costs"** — drop the pill, refcode block, referral fine print and the
   "Vultr credit −$300 / YOU PAY $0" rows. Keep the receipt look: Server, 1 TB volume, API keys $0,
   Gas $0, 24 h of node, total per hour. Hetzner list prices (ccx23 + 1000 GB volume, `fsn1`),
   footer "ESTIMATE · HETZNER LIST PRICE · <month year>". Note that `provision` auto-destroys
   after 8 h (`--ttl`, `--keep`). Section id stays `server`; nav "Free server" → "Server".
5. "You do three things", "Your wallet signs twice", "Vouch" — unchanged, except "Rents and
   secures the server" stays true for Hetzner.

## Other pages

- `server.html` — lead with Hetzner: new project just for this, API token (Read & Write), save to
  `~/.config/fcx/hcloud-token` (exact steps from `cli/src/infra/token.ts`), then
  `npx runfcx provision`. Section `#hetzner`. Second section "Any other server (e.g. Vultr)":
  requirements (4 vCPU, 16 GB, 1000 GB disk, Ubuntu 24.04, UDP/TCP 3381–3383) and the `--host`
  command. Remove referral link and code. Keep an `#vultr` anchor pointing to the fallback so old
  links don't 404 into nothing.
- `tutorial.html` §0 — command `npx runfcx provision`; explain what it creates (server, 1 TB
  volume, firewall: TCP 22 from your IP only, UDP 3382 from anywhere for gossip — see
  `firewallRules` in `cli/src/infra/hetzner.ts`), the 8 h auto-destroy, `runfcx
  extend`, `runfcx destroy`. One line for the `--host` fallback.
- `agent.md` — server step: ask the person for a Hetzner token (they create it; agent never asks
  them to paste it into chat if avoidable — tell them the `pbpaste > ~/.config/fcx/hcloud-token`
  command), state the estimated price and get a yes, then run `npx runfcx provision`. Destroy step:
  `npx runfcx destroy`. Fallback paragraph for `--host`. Remove all referral text. Vouch templates:
  "[1 TB Vultr box]" → "[1 TB server]".
- `vouch.html` — same template change.
- `llms.txt` — server line: Hetzner via `provision`, or your own box.
- `site.json` — `site` → `antonpecherkin.github.io/runfcx`; remove `vultr_ref`, `vultr_credit`
  (nothing in `site/tools` or `site/assets` reads them).
- `site/data/runs.json` — terminal samples: `$ fcx …` → `$ runfcx …`, `fcx-cli` link →
  `runfcx`. Add `run1.monthly_usd` (0.26 × 730 = 189.8) or remove the `operate.html` line that
  needs it, so `node site/tools/check.mjs --release` passes. Add a `hetzner_est` block (server
  €/h, volume €/h, as-of date) that the cost receipt reads via `data-num`.

## Hetzner run (after the site ships)

Fresh Hetzner project + token → `npx runfcx provision` → `node` until synced → `login --wallet` →
`feed`, `cast`, `follow`, `like` → `destroy`. Record timings, disk, cost in `docs/runs/run-3.md`
and a `run3` block in `runs.json`; switch the receipt to measured, drop "estimate". Any CLI bug
found goes through TDD.

## Checks

- `npm run site:check` (tests + check.mjs) and `node site/tools/check.mjs --release` pass.
- `grep -ri "ref=9929634\|referral\|\$300" site/` returns nothing.
- `grep -rn "fcx-cli\|\$ fcx " site/` returns nothing.
- Page reads well at 375 px and desktop.

## Builder's calls

Copy-button granularity; whether the hero chat mockup stays; exact headline/lede wording (plain,
not salesy); Hetzner price source (hetzner.com/cloud, record the date).
