# Site: Commands First, Hetzner Step (0) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Landing page opens with the three commands (then the agent line), step (0) is Hetzner `npx runfcx provision` across the site, Vultr is only a neutral `--host` fallback, old `fcx` names are gone, and the release check passes.

**Architecture:** Static site in `site/` (plain HTML + `assets/app.js` + `assets/style.css`), checked by `site/tools/check.mjs` using rules in `site/tools/rules.mjs` (tested with `node --test`). Run numbers come from `docs/runs/*.md` (`fcx-numbers` / `fcx-term` blocks) → `node site/tools/runs.mjs` → `site/data/runs.json` → `data-num` / `data-term` attributes. A new rule enforces "no promotion, no old names".

**Tech Stack:** HTML, CSS, vanilla JS, Node 20 (`node:test`).

**Spec:** `docs/superpowers/specs/2026-10-26-site-commands-first-hetzner-design.md`

## Global Constraints

- No `ref=9929634`, no `9929634-9J`, no "referral", no "$300", no "Vultr credit", no "free server" anywhere in `site/`.
- No `fcx-cli` and no `$ fcx ` (old command prompt) anywhere in `site/` or `docs/runs/`.
- Vultr may appear only as a neutral example of "any other server" with `npx runfcx provision --host root@IP --data-dir /mnt/fcx`.
- Hetzner costs are labeled "estimate" with the list-price month (e.g. "Oct 2026"); never `data-num` (runs.json holds only measured numbers).
- Step (0) command: `npx runfcx provision`. Token file: `~/.config/fcx/hcloud-token` or env `HCLOUD_TOKEN`. Server type `ccx23`, location `fsn1`, 1000 GB volume, auto-destroy after 8 h (`--ttl`, `--keep`, `runfcx extend`).
- Hetzner firewall facts: TCP 22 from your IP only, UDP 3382 from anywhere.
- Writing rules in `rules.mjs` (`bannedPhrases`) apply: no "not X, but Y", no "A, not B", no hype words.
- Existing landing structure stays: hero, `#why`, `#server`, `#you`, `#wallet`, `#vouch`.

## Review Focus

1. A shared old link `server.html#vultr` must still land on a real section (the fallback) → `links()` check passes with the anchor kept; Task 4 step asserts it.
2. Phone width (375 px): the hero terminal block must scroll inside itself, never widen the page → `pre { overflow-x:auto }` already enforced by `cssTokens`; Task 3 uses `<pre>` for the block and checks at 375 px.
3. A tester without a Hetzner token runs `npx runfcx provision` → the CLI's "No Hetzner token." message must have a matching row in `agent.md` whose fix is "create the token", not "use --host" → Task 5 updates that row; `agentCoverage` still passes.
4. Copy button on the hero block must copy runnable commands only (no `#` comment lines, no "feed · cast · follow" pseudo-line) → Task 3 puts the copyable text in a hidden `<code id>` of real commands.
5. Promotion creeping back via generated data (`runs.json`, `site.json`, `llms.txt`) → Task 6 runs the new rule over those files too.

---

### Task 1: `promo` rule

**Files:**
- Modify: `site/tools/rules.mjs` (append export)
- Test: `site/tools/test/rules.test.mjs`

**Interfaces:**
- Produces: `export function promo(text: string): string[]` — one problem string per match, format `promotion or old name: <match>`.

- [ ] **Step 1: Write the failing test** (append to `rules.test.mjs`, import `promo`)

```js
test("promo flags referral, credit pitch and old names", () => {
  assert.deepEqual(promo("Run with npx runfcx provision. Or any server, e.g. Vultr: --host root@IP"), []);
  assert.equal(promo('<a href="https://www.vultr.com/?ref=9929634-9J">x</a>').length > 0, true);
  assert.equal(promo("New accounts get $300 of credit").length > 0, true);
  assert.equal(promo("Vultr credit −$300").length > 0, true);
  assert.equal(promo("our referral link").length > 0, true);
  assert.equal(promo("antonpecherkin.github.io/fcx-cli").length > 0, true);
  assert.equal(promo("$ fcx status").length > 0, true);
  assert.deepEqual(promo("$ runfcx status"), []);
});
```

- [ ] **Step 2: Run:** `node --test site/tools/test/rules.test.mjs` — Expected: FAIL, `promo` is not exported.

- [ ] **Step 3: Implement `promo`** in `rules.mjs`: patterns `/ref=\d+/`, `/9929634/`, `/referral/i`, `/\$300/`, `/vultr credit/i`, `/free server/i`, `/fcx-cli/`, `/\$ fcx\b/`; return each match.

- [ ] **Step 4: Run:** `node --test site/tools/test/rules.test.mjs` — Expected: PASS.

- [ ] **Step 5: Commit** `feat(site): promo rule (no referral, credit pitch, old names)`.

### Task 2: Run data and site.json

**Files:**
- Modify: `docs/runs/run-1.md`, `docs/runs/run-2.md` (`fcx-term` blocks; `fcx-numbers` in run-1)
- Regenerate: `site/data/runs.json`
- Modify: `site/site.json`
- Test: `site/tools/test/runs.test.mjs` (existing, must stay green)

**Interfaces:**
- Produces: `runs.json` key `run1.monthly_usd = 189.8` (used by `operate.html:30`); terminal keys unchanged (`status-syncing`, `status-downloading`, `whoami`, `feed`, `clients`, `logout`).

- [ ] **Step 1:** In both run docs' `fcx-term` blocks: `$ fcx ` → `$ runfcx `, `antonpecherkin.github.io/fcx-cli` → `antonpecherkin.github.io/runfcx`. Leave the rest of the run docs (history) alone. Add `monthly_usd=189.8` to run-1's `fcx-numbers` block (0.26 × 730).
- [ ] **Step 2: Run:** `node site/tools/runs.mjs && grep -c 'fcx-cli\|\$ fcx ' site/data/runs.json` — Expected: `0`; `grep monthly_usd site/data/runs.json` shows `189.8`.
- [ ] **Step 3:** `site.json`: `"site": "antonpecherkin.github.io/runfcx"`, delete `vultr_ref` and `vultr_credit`.
- [ ] **Step 4:** In `operate.html:30` drop `class="tbd"` and set the fallback text to `$189.80` (keep `data-num="run1.monthly_usd"`), so the release placeholder gate passes.
- [ ] **Step 5: Run:** `cd cli && npm run site:check` — Expected: tests pass, `site ok`. `node site/tools/check.mjs --release` — Expected: `site ok`.
- [ ] **Step 6: Commit** `fix(site): runfcx names in run samples, monthly cost, site.json without Vultr`.

### Task 3: Landing page

**Files:**
- Modify: `site/index.html` (hero lines 18–39, nav line 14, `#server` lines 81–108, `#you` agent bullet)
- Modify: `site/assets/style.css` only if the hero block needs a class (colors via existing tokens only)

**Interfaces:**
- Consumes: copy buttons work via `data-copy="<id>"` → copies the text of element `#<id>` (existing `app.js`).

- [ ] **Step 1: Hero.** Replace the paste-line hero with: `<h1 class="hero">` about running your own read node and client; lede "Three commands. No API keys from anyone. No gas."; a `<pre class="quick">` with exactly the spec's block (comments + commands, token line links to `server.html#hetzner`); a Copy button bound to a visually hidden `<code id="quick-cmds">` containing only `npx runfcx provision`, `npx runfcx node`, `npx runfcx login --wallet` (one per line). Under it: "~3–5 h, mostly waiting" and "Or hand it to your agent:" followed by the existing `.prompt` with `agent-line` and its Copy button; keep "prefer to type it yourself?" → `tutorial.html`. Drop the right-hand chat mockup (simpler page, my call per spec).
- [ ] **Step 2: Nav.** `Free server` → `Cost` (still `#server`).
- [ ] **Step 3: `#server` section.** Kicker "The server", heading "What it costs". Lede: `provision` rents a Hetzner server and a 1 TB volume, and deletes both after 8 h unless you pass `--keep`. Remove pill, `.refcode`, `.fine`. Receipt rows: Server (ccx23) €/h, 1 TB volume €/h, API keys $0, Gas $0, 8 h run total, 24 h of node — values from hetzner.com/cloud list prices today, as plain text; footer `ESTIMATE · HETZNER LIST PRICE · OCT 2026`; heading `THE WHOLE BILL`; remove the "Vultr credit" row and the "YOU PAY $0" total (total = 8 h run). Last line: "Already have a server? Any Ubuntu box works: `provision --host`" → `server.html#other`.
- [ ] **Step 4: `#you`.** "Rents and secures the server" stays. No other edits.
- [ ] **Step 5: Check:** `node site/tools/check.mjs` → `site ok`; `grep -n -i 'vultr\|referral\|\$300' site/index.html` → nothing; open `site/index.html` at 375 px and desktop (claude-in-chrome or `python3 -m http.server`): hero block scrolls inside, no horizontal page scroll, both Copy buttons copy the expected text.
- [ ] **Step 6: Commit** `feat(site): commands first on the landing page, Hetzner cost estimate, no Vultr pitch`.

### Task 4: Server page, tutorial §0, llms.txt

**Files:**
- Modify: `site/server.html`, `site/tutorial.html` (`#compute`, lines 28–33), `site/llms.txt`

- [ ] **Step 1: `server.html`.** Lede: runfcx rents the server for you on Hetzner. Section `id="hetzner"` "Hetzner · 2 minutes": the three token steps from `cli/src/infra/token.ts` (new project just for this; Security → API tokens → Read & Write; `mkdir -p ~/.config/fcx && pbpaste > ~/.config/fcx/hcloud-token && chmod 600 ~/.config/fcx/hcloud-token`, plus `HCLOUD_TOKEN` alternative), then `npx runfcx provision`, what it creates, firewall facts, 8 h auto-destroy, `runfcx extend 4h`, `runfcx destroy`. Section `id="other"` "Any other server": 4 vCPU, 16 GB RAM, 1000 GB disk, Ubuntu 24.04, open TCP 22 from your IP and UDP 3382; "Vultr, for example, has worked for us"; `npx runfcx provision --host root@IP --data-dir /mnt/fcx`; delete server and disk in your provider's console when done. Put `id="vultr"` on an element inside `#other` (old links). Remove all referral text.
- [ ] **Step 2: `tutorial.html` §0.** Command `npx runfcx provision`; paragraph: needs a Hetzner token (`server.html#hetzner`); creates server, 1 TB volume and firewall (facts above); deletes it all after 8 h, `extend`/`destroy`. One line: own server → `provision --host` (`server.html#other`).
- [ ] **Step 3: `llms.txt`.** Server line → "Hetzner via `npx runfcx provision`, or any Ubuntu server with `--host`".
- [ ] **Step 4: Check:** `node site/tools/check.mjs` → `site ok` (verifies `server.html#vultr`, `#hetzner`, `#other` links resolve); `grep -n -i 'referral\|ref=\|\$300' site/server.html site/tutorial.html site/llms.txt` → nothing.
- [ ] **Step 5: Commit** `docs(site): Hetzner provision on server page and tutorial, Vultr as neutral fallback`.

### Task 5: agent.md and vouch templates

**Files:**
- Modify: `site/agent.md` (lines ~12, 19–50, 88, 131–143, error table row 150), `site/vouch.html:38`

- [ ] **Step 1: Server step.** Replace the Vultr flow with: ask the person to create a Hetzner project + Read & Write token and save it with the `pbpaste > ~/.config/fcx/hcloud-token` command themselves (agent never asks for the token in chat); state the estimate from `index.html#server` and wait for a yes; run `npx runfcx provision` (mention `--ttl` / `--keep`). Fallback paragraph: person already has a server → `npx runfcx provision --host root@<IP> --data-dir /mnt/fcx`, the requirements list from `server.html#other`.
- [ ] **Step 2: Reminders.** Step 5 and the closing reminder: `npx runfcx destroy --yes` deletes the Hetzner server and volume; for `--host` runs, delete the server and disk in the provider's console. Line 88 "update the SSH rule in their Vultr firewall" → `npx runfcx allow-ip` for Hetzner runs, provider firewall for `--host`.
- [ ] **Step 3: Error row.** `| No Hetzner token. |` → cause "no token saved", fix "person creates one (server.html#hetzner) and saves it to ~/.config/fcx/hcloud-token; or use --host with their own server".
- [ ] **Step 4: Vouch templates** in `agent.md` and `vouch.html`: `[1 TB Vultr box]` → `[1 TB server]`.
- [ ] **Step 5: Check:** `cd cli && npm run site:check` → pass (agent coverage intact); `grep -n -i 'vultr' site/agent.md site/vouch.html` → only the neutral fallback mention, no referral.
- [ ] **Step 6: Commit** `docs(agent): Hetzner provision flow, neutral --host fallback, no referral`.

### Task 6: Enforce and ship

**Files:**
- Modify: `site/tools/check.mjs`

- [ ] **Step 1:** In `check.mjs` import `promo` and push `promo(text)` problems for every HTML page, `agent.md`, `llms.txt`, `site.json`, `data/runs.json` (prefix with the filename).
- [ ] **Step 2: Run:** `node site/tools/check.mjs --release` → `site ok`; `cd cli && npm run site:check` → pass; `npx vitest run` in `cli` → 123 pass.
- [ ] **Step 3: Commit** `feat(site): check blocks promotion and old names`.
- [ ] **Step 4:** Ask the owner before `git push` (push deploys GitHub Pages). After push, `curl -s https://antonpecherkin.github.io/runfcx/ | grep -c 'npx runfcx provision'` → ≥ 1.

### Task 7: Real Hetzner run (needs the owner's token; after Task 6 ships)

- [ ] **Step 1:** Owner creates a fresh Hetzner project + token and saves it. Run `npx runfcx provision`, `npx runfcx node` (watch with a real Monitor until synced), `login --wallet`, `feed`, `cast`, `follow`, `like`, `destroy --yes`.
- [ ] **Step 2:** Write `docs/runs/run-3.md` with an `fcx-numbers` block (`provider=hetzner server_usd_h= disk_usd_h= hourly_usd= steady_disk_gb= sync_h=`) from the actual Hetzner invoice/console and `runfcx status`; regenerate `runs.json`.
- [ ] **Step 3:** Switch the `#server` receipt to `data-num="run3.*"`, footer `MEASURED ON OUR RUN · <month year>`, drop "estimate" there and in `agent.md`. Any CLI bug found: fix test-first in `cli/`.
- [ ] **Step 4:** Checks from Task 6 step 2; commit `docs: Hetzner run 3, measured cost on the site`; ask before push.
