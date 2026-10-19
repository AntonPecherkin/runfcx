# Plan 2: The fcx Client — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Command (2) of the quickstart — `fcx login [--wallet]` (gasless `KEY_ADD` app key) — plus `logout`, `whoami`, `feed`, `clients`, `cast`, `follow`/`unfollow`, `like`/`unlike`/`recast`/`unrecast`, `user`, all reading from and writing through the user's own Snapchain read node.

**Architecture:** New code lives in `cli/src/client/`. One HTTP client (`node-client.ts`) talks to the node's port 3381 through an SSH tunnel (or `FCX_NODE` for a local URL). Messages are built and signed with `@farcaster/core`; every write goes through `writer.ts` (submit → poll until present → resubmit the same bytes, up to 3 times). Login builds a gasless `KEY_ADD` signed by the custody address: from a seed phrase (local viem account) or from a browser wallet through a one-page localhost bridge that plugs into viem as a custom transport. Tests run against `test/client/fake-node.ts`, an in-memory node that decodes real protobuf messages.

**Tech Stack:** Node ≥ 20, TypeScript 5.6, vitest 2. Runtime deps (exact): `@farcaster/core@0.20.0`, `viem@2.37.5`. `node:util` `parseArgs`, `node:http`, `node:crypto`.

**Spec:** `docs/superpowers/specs/2026-10-18-farcaster-3-commands-design.md` (sections 6, 7, 11)

## Global Constraints

- Quickstart command (2) is `npx fcx-cli login --wallet`. Binaries `fcx` and `fcx-cli`.
- Runtime dependencies: only `@farcaster/core@0.20.0` and `viem@2.37.5`, pinned exactly, lockfile committed. No CLI framework, no axios, no WalletConnect.
- Node API: `http://127.0.0.1:<port>` through `ssh -L <port>:127.0.0.1:3381`. Override with `FCX_NODE=<url>` (tests, `--host` boxes, local nodes).
- Network: `FarcasterNetwork.MAINNET`. Timestamps from the node are Farcaster seconds; Unix = Farcaster + 1609459200.
- App key scopes: `CAST_ADD, CAST_REMOVE, REACTION_ADD, REACTION_REMOVE, LINK_ADD, LINK_REMOVE`. TTL 30 days (max is 90). `requestFid` = the user's own FID. Custody signature deadline = now + 1 h.
- App key file: `$FCX_HOME/key` (default `~/.fcx/key`), mode 0600. Caches: `$FCX_HOME/cache/*.json`.
- Seed phrase: TTY only, warning first, hidden input, memory only. Never written to disk, logs, argv, env, or error messages.
- Both login modes refuse without a TTY and print: `Login needs a human at the keyboard. Ask them to run: fcx login --wallet`.
- Wallet bridge: binds `127.0.0.1` only, random port, random 32-hex token in the path, checks the `Host` header, JSON POST only, closes after login.
- Writes: submit → poll every 3 s for up to 15 s → resubmit the same signed bytes, max 3 tries → clear error.
- Every command accepts `--json` (machine output) except `login`/`logout`.
- Output text: short sentences, no hype, no "not X, but Y".
- Code is quoted by the tutorial: small files, short functions, a comment only where the protocol is non-obvious.

## Review Focus

1. **Following more than 1000 accounts.** `linksByFid` pages at 1000. Expected: every page is read, the feed includes casts from all followed accounts. → Task 1 test `follows every page`.
2. **Resubmitting a message the node already has.** The node may answer the second submit with a "duplicate"/"already merged" error. Expected: treated as accepted, keep polling, no "rejected" error. → Task 3 test `duplicate on resubmit is not a rejection`.
3. **Seed phrase pasted with extra spaces, capitals or a trailing newline**, or with a typo. Expected: normalized before use; a bad phrase fails with "That is not a valid 12/24-word seed phrase." and the phrase never appears in any output. → Task 5 tests.
4. **Wallet user clicks Reject**, or the wallet is not the custody address. Expected: "You rejected the request in your wallet. Nothing was added." / "This wallet (0x…) is not the custody address of any FID." and exit 1; no key file written. → Task 6 tests.
5. **Node unreachable or not synced when a client command runs** (tunnel fails, node still downloading). Expected: "Can't reach your node. Run: fcx status" within ~15 s, no hang. → Task 1 test `openNode gives up with a hint`.

---

## File Structure

```
cli/
  package.json                 # + @farcaster/core, viem
  src/
    cli.ts                     # + client commands
    client/
      node-client.ts           # NodeClient (HTTP API), NodeError, Msg types
      connect.ts               # openNode(): FCX_NODE or SSH tunnel
      cache.ts                 # tiny JSON cache in $FCX_HOME/cache
      keystore.ts              # AppKey load/save/clear, appSigner()
      messages.ts              # build cast/reaction/link writes (+ landed checks)
      writer.ts                # submitAndConfirm()
      names.ts                 # usernames, @name → fid, cast refs
      signers.ts               # cast signer → app FID (include/exclude by client)
      feed.ts                  # buildFeed(), countClients()
      format.ts                # human output
      login.ts                 # addAppKey(), logout()
      seed.ts                  # validMnemonic(), readHidden(), seedLogin()
      wallet.ts                # startBridge(), walletLogin(), explain()
      wallet-page.ts           # the HTML/JS page served by the bridge
  test/
    client/
      fake-node.ts             # in-memory Snapchain HTTP API
      *.test.ts
    fixtures/node/*.json       # recorded on the dev node (Task 9)
docs/runs/run-2.md
```

---

### Task 1: Dependencies, fake node, `NodeClient`, `openNode`

**Files:**
- Modify: `cli/package.json`
- Create: `cli/src/client/node-client.ts`, `cli/src/client/connect.ts`, `cli/test/client/fake-node.ts`, `cli/test/client/node-client.test.ts`

**Interfaces:**
- Consumes: `requireState()` (`src/infra/state.ts`), `makeSsh(target).tunnel(local, remote)` (`src/infra/ssh.ts`).
- Produces:
  - `type Hex = \`0x${string}\``
  - `interface Msg { data: { type: string; fid: number; timestamp: number; castAddBody?: CastBody; reactionBody?: { type: string; targetCastId?: { fid: number; hash: string } }; linkBody?: { type: string; targetFid?: number }; userDataBody?: { type: string; value: string } }; hash: Hex; signer: Hex }`
  - `interface CastBody { text: string; embeds: { url?: string }[]; parentCastId?: { fid: number; hash: string }; parentUrl?: string }`
  - `interface SignerInfo { key: Hex; fid: number; source: string; requestFid?: number; onChainEvent?: { signerEventBody?: { metadata: string } } }`
  - `class NodeError extends Error { status: number }`
  - `class NodeClient { constructor(base: string, f?: typeof fetch); info(); castsByFid(fid, o?: { pageSize?: number; startTimestamp?: number }): Promise<Msg[]>; following(fid): Promise<number[]>; userData(fid): Promise<Record<string, string>>; signer(fid, key: Hex): Promise<SignerInfo | null>; signersByFid(fid, requesterFid?): Promise<{ currentUserNonce: number; requesterFidNonces: Record<string, number> }>; fidByAddress(a: Hex): Promise<number | null>; storageUnits(fid): Promise<number>; fidByName(name): Promise<number | null>; castById(fid, hash: Hex): Promise<Msg | null>; reactionById(fid, type: "Like" | "Recast", target: { fid: number; hash: Hex }): Promise<Msg | null>; linkById(fid, targetFid): Promise<Msg | null>; submit(bytes: Uint8Array): Promise<Msg> }`
  - `openNode(o?: { waitMs?: number }): Promise<{ node: NodeClient; close(): void }>`
  - Test util `fakeNode(o?): { fetch: typeof fetch; store: FakeStore; knobs: { dropSubmits: number; reject?: string; duplicateOnResubmit?: boolean } }` with `store.addAccount({ fid, custody: Hex, units, username })`, `store.addCast(msgJson)`, `store.follow(fid, targetFid)`.

- [ ] **Step 1: Add dependencies**

```bash
cd cli && npm install --save-exact @farcaster/core@0.20.0 viem@2.37.5
```
Expected: `package.json` gains `"dependencies": { "@farcaster/core": "0.20.0", "viem": "2.37.5" }`; `npm ls viem` shows one `viem@2.37.5` (deduped under `@farcaster/core`).

- [ ] **Step 2: Write the fake node**

`cli/test/client/fake-node.ts`:

```ts
// In-memory stand-in for a Snapchain read node's HTTP API (port 3381).
// It decodes the real protobuf bytes we submit, so tests exercise our actual messages.
import { Message, MessageType, bytesToHexString } from "@farcaster/core";
import type { Hex, Msg } from "../../src/client/node-client.js";

const hex = (b: Uint8Array) => bytesToHexString(b)._unsafeUnwrap() as Hex;
const TYPE: Record<number, string> = { 1: "MESSAGE_TYPE_CAST_ADD", 2: "MESSAGE_TYPE_CAST_REMOVE", 3: "MESSAGE_TYPE_REACTION_ADD",
  4: "MESSAGE_TYPE_REACTION_REMOVE", 5: "MESSAGE_TYPE_LINK_ADD", 6: "MESSAGE_TYPE_LINK_REMOVE", 11: "MESSAGE_TYPE_USER_DATA_ADD",
  16: "MESSAGE_TYPE_KEY_ADD", 17: "MESSAGE_TYPE_KEY_REMOVE" };

export function toJson(m: Message): Msg {
  const d = m.data!;
  const out: Msg = { data: { type: TYPE[d.type] ?? String(d.type), fid: d.fid, timestamp: d.timestamp }, hash: hex(m.hash), signer: hex(m.signer) };
  const c = d.castAddBody;
  if (c) out.data.castAddBody = { text: c.text, embeds: c.embeds.map((e) => ({ url: e.url })),
    parentCastId: c.parentCastId && { fid: c.parentCastId.fid, hash: hex(c.parentCastId.hash) }, parentUrl: c.parentUrl };
  const r = d.reactionBody;
  if (r) out.data.reactionBody = { type: r.type === 1 ? "REACTION_TYPE_LIKE" : "REACTION_TYPE_RECAST",
    targetCastId: r.targetCastId && { fid: r.targetCastId.fid, hash: hex(r.targetCastId.hash) } };
  const l = d.linkBody;
  if (l) out.data.linkBody = { type: l.type, targetFid: l.targetFid };
  return out;
}

interface Account { fid: number; custody: Hex; units: number; username: string; nonce: number; appNonces: Record<number, number> }
interface Key { key: Hex; fid: number; requestFid: number; source: string; metadata?: string }

export class FakeStore {
  accounts = new Map<number, Account>();
  casts: Msg[] = []; reactions: Msg[] = []; links: Msg[] = []; keys: Key[] = [];
  submits = 0;
  addAccount(a: { fid: number; custody: Hex; units?: number; username?: string }) {
    this.accounts.set(a.fid, { units: 1, username: `user${a.fid}`, nonce: 0, appNonces: {}, ...a });
  }
  addKey(k: Key) { this.keys.push(k); }
  addCast(m: Msg) { this.casts.push(m); }
  follow(fid: number, targetFid: number) {
    this.links.push({ data: { type: "MESSAGE_TYPE_LINK_ADD", fid, timestamp: 1, linkBody: { type: "follow", targetFid } },
      hash: `0x${String(this.links.length).padStart(40, "0")}`, signer: "0x00" });
  }
  merge(m: Message): void {
    const d = m.data!, j = toJson(m);
    if (d.type === MessageType.CAST_ADD) this.casts.push(j);
    if (d.type === MessageType.REACTION_ADD) this.reactions.push(j);
    if (d.type === MessageType.REACTION_REMOVE) this.reactions = this.reactions.filter((x) =>
      !(x.data.fid === d.fid && x.data.reactionBody?.targetCastId?.hash === j.data.reactionBody?.targetCastId?.hash
        && x.data.reactionBody?.type === j.data.reactionBody?.type));
    if (d.type === MessageType.LINK_ADD) this.links.push(j);
    if (d.type === MessageType.LINK_REMOVE) this.links = this.links.filter((x) =>
      !(x.data.fid === d.fid && x.data.linkBody?.targetFid === d.linkBody!.targetFid));
    if (d.type === MessageType.KEY_ADD) {
      const a = this.accounts.get(d.fid)!; a.nonce = d.keyAddBody!.nonce;
      this.keys.push({ key: hex(d.keyAddBody!.key), fid: d.fid, requestFid: d.fid, source: "SIGNER_SOURCE_OFFCHAIN" });
    }
    if (d.type === MessageType.KEY_REMOVE) {
      const key = hex(d.keyRemoveBody!.key);
      const k = this.keys.find((x) => x.fid === d.fid && x.key === key);
      if (k) this.accounts.get(d.fid)!.appNonces[k.requestFid] = d.keyRemoveBody!.nonce;
      this.keys = this.keys.filter((x) => !(x.fid === d.fid && x.key === key));
    }
  }
}

export function fakeNode() {
  const store = new FakeStore();
  const knobs = { dropSubmits: 0, reject: undefined as string | undefined, duplicateOnResubmit: false, pageSize: 1000 };
  const seen = new Set<string>();
  const ok = (body: unknown) => new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json" } });
  const notFound = () => new Response(JSON.stringify({ errCode: "not_found", details: "not found" }), { status: 400 });
  const page = (all: Msg[], token: string | null) => {
    const start = token ? Number(token) : 0, end = start + knobs.pageSize;
    return ok({ messages: all.slice(start, end), nextPageToken: end < all.length ? String(end) : "" });
  };

  const f = async (input: string | URL | Request, init?: RequestInit): Promise<Response> => {
    const u = new URL(String(input)), q = u.searchParams, fid = Number(q.get("fid"));
    switch (u.pathname) {
      case "/v1/info": return ok({ shardInfos: [{ shardId: 1, maxHeight: 10, blockDelay: 0 }] });
      case "/v1/castsByFid": {
        const start = Number(q.get("startTimestamp") ?? 0);
        const mine = store.casts.filter((c) => c.data.fid === fid && c.data.timestamp >= start)
          .sort((a, b) => b.data.timestamp - a.data.timestamp);
        return ok({ messages: mine.slice(0, Number(q.get("pageSize") ?? 1000)), nextPageToken: "" });
      }
      case "/v1/castById": return store.casts.find((c) => c.data.fid === fid && c.hash === q.get("hash")) ? ok(store.casts.find((c) => c.hash === q.get("hash"))) : notFound();
      case "/v1/linksByFid": return page(store.links.filter((l) => l.data.fid === fid), q.get("pageToken"));
      case "/v1/linkById": {
        const l = store.links.find((x) => x.data.fid === fid && x.data.linkBody?.targetFid === Number(q.get("target_fid")));
        return l ? ok(l) : notFound();
      }
      case "/v1/reactionById": {
        const t = q.get("reaction_type") === "Like" ? "REACTION_TYPE_LIKE" : "REACTION_TYPE_RECAST";
        const r = store.reactions.find((x) => x.data.fid === fid && x.data.reactionBody?.type === t
          && x.data.reactionBody.targetCastId?.hash === q.get("target_hash"));
        return r ? ok(r) : notFound();
      }
      case "/v1/userDataByFid": {
        const a = store.accounts.get(fid);
        return ok({ messages: a ? [{ data: { type: "MESSAGE_TYPE_USER_DATA_ADD", fid, timestamp: 1,
          userDataBody: { type: "USER_DATA_TYPE_USERNAME", value: a.username } }, hash: "0x01", signer: "0x02" }] : [], nextPageToken: "" });
      }
      case "/v1/userNameProofByName": {
        const a = [...store.accounts.values()].find((x) => x.username === q.get("name"));
        return a ? ok({ name: a.username, fid: a.fid, owner: a.custody, type: "USERNAME_TYPE_FNAME", timestamp: 1, signature: "" }) : notFound();
      }
      case "/v1/onChainIdRegistryEventByAddress": {
        const a = [...store.accounts.values()].find((x) => x.custody.toLowerCase() === q.get("address")!.toLowerCase());
        return a ? ok({ type: "EVENT_TYPE_ID_REGISTER", fid: a.fid, idRegisterEventBody: { to: a.custody } }) : notFound();
      }
      case "/v1/storageLimitsByFid": return ok({ limits: [], units: store.accounts.get(fid)?.units ?? 0, unitDetails: [], tier_subscriptions: [] });
      case "/v1/signer": {
        const k = store.keys.find((x) => x.fid === fid && x.key === q.get("signer"));
        return k ? ok({ signer: { key: k.key, keyType: 1, fid: k.fid, source: k.source, scopes: [],
          ...(k.source === "SIGNER_SOURCE_OFFCHAIN" ? { requestFid: k.requestFid } : { onChainEvent: { signerEventBody: { metadata: k.metadata } } }) } }) : notFound();
      }
      case "/v1/signersByFid": {
        const a = store.accounts.get(fid)!;
        const req = q.getAll("requesterFids").map(Number);
        return ok({ signers: store.keys.filter((k) => k.fid === fid), gaslessSignerCount: 0, gaslessSignerLimit: 1000,
          currentUserNonce: a.nonce, ...(req.length ? { requesterFidNonces: Object.fromEntries(req.map((r) => [String(r), a.appNonces[r] ?? 0])) } : {}) });
      }
      case "/v1/submitMessage": {
        store.submits++;
        if (knobs.reject) return new Response(JSON.stringify({ errCode: "bad_request.validation_failure", details: knobs.reject }), { status: 400 });
        const bytes = new Uint8Array(await new Response(init!.body as BodyInit).arrayBuffer());
        const m = Message.decode(bytes), h = hex(m.hash);
        if (knobs.duplicateOnResubmit && seen.has(h))
          return new Response(JSON.stringify({ errCode: "bad_request.duplicate", details: "message has already been merged" }), { status: 400 });
        seen.add(h);
        if (knobs.dropSubmits > 0) { knobs.dropSubmits--; return ok(toJson(m)); } // accepted, lost in gossip
        store.merge(m);
        return ok(toJson(m));
      }
    }
    return new Response("{}", { status: 404 });
  };
  return { fetch: f as typeof fetch, store, knobs };
}
```

- [ ] **Step 3: Write the failing tests**

`cli/test/client/node-client.test.ts`:

```ts
import { describe, it, expect, beforeEach } from "vitest";
import { mkdtempSync } from "node:fs"; import { tmpdir } from "node:os"; import { join } from "node:path";
import { NodeClient, NodeError } from "../../src/client/node-client.js";
import { openNode } from "../../src/client/connect.js";
import { fakeNode } from "./fake-node.js";

const ALICE = "0x00000000000000000000000000000000000000a1";
let fake: ReturnType<typeof fakeNode>, node: NodeClient;
beforeEach(() => {
  fake = fakeNode(); node = new NodeClient("http://node", fake.fetch);
  fake.store.addAccount({ fid: 10, custody: ALICE, units: 2, username: "alice" });
});

describe("NodeClient", () => {
  it("reads account facts", async () => {
    expect(await node.fidByAddress(ALICE)).toBe(10);
    expect(await node.fidByAddress("0x00000000000000000000000000000000000000ff")).toBeNull();
    expect(await node.storageUnits(10)).toBe(2);
    expect(await node.userData(10)).toEqual({ USER_DATA_TYPE_USERNAME: "alice" });
    expect(await node.fidByName("alice")).toBe(10);
    expect((await node.signersByFid(10)).currentUserNonce).toBe(0);
  });
  it("follows every page", async () => {
    fake.knobs.pageSize = 2;
    for (let t = 100; t < 105; t++) fake.store.follow(10, t);
    expect(await node.following(10)).toEqual([100, 101, 102, 103, 104]);
  });
  it("returns null for a missing cast and throws NodeError on 5xx", async () => {
    expect(await node.castById(10, "0x1234")).toBeNull();
    const broken = new NodeClient("http://node", (async () => new Response("{\"error\":\"boom\"}", { status: 500 })) as typeof fetch);
    await expect(broken.storageUnits(10)).rejects.toBeInstanceOf(NodeError);
    await expect(broken.storageUnits(10)).rejects.toThrow(/boom/);
  });
});

describe("openNode", () => {
  beforeEach(() => { process.env.FCX_HOME = mkdtempSync(join(tmpdir(), "fcx-")); });
  it("uses FCX_NODE when set", async () => {
    process.env.FCX_NODE = "http://127.0.0.1:1";
    const c = await openNode({ waitMs: 0 });
    expect(c.node.base).toBe("http://127.0.0.1:1");
    c.close(); delete process.env.FCX_NODE;
  });
  it("openNode gives up with a hint", async () => {
    process.env.FCX_NODE = "http://127.0.0.1:1"; // nothing listens on port 1
    await expect(openNode({ waitMs: 300 })).rejects.toThrow("Can't reach your node. Run: fcx status");
    delete process.env.FCX_NODE;
  });
  it("needs a server when FCX_NODE is not set", async () => {
    await expect(openNode({ waitMs: 0 })).rejects.toThrow(/fcx provision/);
  });
});
```

- [ ] **Step 4: Run them to verify they fail**

Run: `cd cli && npx vitest run test/client/node-client.test.ts`
Expected: FAIL — `Cannot find module '../../src/client/node-client.js'`.

- [ ] **Step 5: Implement `node-client.ts`**

```ts
// The read node's HTTP API (port 3381). Reads, plus submitMessage for writes:
// a read node validates a message and gossips it to validators. It does not store it itself.
export type Hex = `0x${string}`;
export interface CastBody { text: string; embeds: { url?: string }[]; parentCastId?: { fid: number; hash: string }; parentUrl?: string }
export interface Msg {
  data: { type: string; fid: number; timestamp: number; castAddBody?: CastBody;
    reactionBody?: { type: string; targetCastId?: { fid: number; hash: string } };
    linkBody?: { type: string; targetFid?: number }; userDataBody?: { type: string; value: string } };
  hash: Hex; signer: Hex;
}
export interface SignerInfo { key: Hex; fid: number; source: string; requestFid?: number; onChainEvent?: { signerEventBody?: { metadata: string } } }
type Params = Record<string, string | number | boolean | undefined | (string | number)[]>;

export class NodeError extends Error {
  constructor(message: string, public status: number) { super(message); }
}

export class NodeClient {
  constructor(public base: string, private f: typeof fetch = fetch) {}

  private async call<T>(path: string, params: Params = {}, init?: RequestInit): Promise<T> {
    const u = new URL(path, this.base);
    for (const [k, v] of Object.entries(params)) {
      if (Array.isArray(v)) v.forEach((x) => u.searchParams.append(k, String(x)));
      else if (v !== undefined) u.searchParams.set(k, String(v));
    }
    const r = await this.f(u, init);
    const body = await r.json().catch(() => ({}));
    if (!r.ok) throw new NodeError(body.details ?? body.error_detail ?? body.error ?? `HTTP ${r.status}`, r.status);
    return body as T;
  }
  // The node answers "not found" with a 4xx. For lookups that is a normal answer.
  private async maybe<T>(path: string, params: Params): Promise<T | null> {
    try { return await this.call<T>(path, params); }
    catch (e) { if (e instanceof NodeError && e.status < 500) return null; throw e; }
  }

  info() { return this.call<{ shardInfos: { blockDelay?: number }[] }>("/v1/info"); }

  async castsByFid(fid: number, o: { pageSize?: number; startTimestamp?: number } = {}): Promise<Msg[]> {
    const r = await this.call<{ messages: Msg[] }>("/v1/castsByFid", { fid, reverse: true, pageSize: o.pageSize ?? 25, startTimestamp: o.startTimestamp });
    return r.messages;
  }
  async following(fid: number): Promise<number[]> {
    const out: number[] = [];
    let pageToken: string | undefined;
    do {
      const r = await this.call<{ messages: Msg[]; nextPageToken?: string }>("/v1/linksByFid", { fid, link_type: "follow", pageSize: 1000, pageToken });
      for (const m of r.messages) if (m.data.linkBody?.targetFid) out.push(m.data.linkBody.targetFid);
      pageToken = r.nextPageToken || undefined;
    } while (pageToken);
    return out;
  }
  async userData(fid: number): Promise<Record<string, string>> {
    const r = await this.call<{ messages: Msg[] }>("/v1/userDataByFid", { fid });
    return Object.fromEntries(r.messages.filter((m) => m.data.userDataBody).map((m) => [m.data.userDataBody!.type, m.data.userDataBody!.value]));
  }
  async signer(fid: number, key: Hex): Promise<SignerInfo | null> {
    return (await this.maybe<{ signer: SignerInfo }>("/v1/signer", { fid, signer: key }))?.signer ?? null;
  }
  signersByFid(fid: number, requesterFid?: number) {
    return this.call<{ currentUserNonce: number; requesterFidNonces?: Record<string, number> }>("/v1/signersByFid",
      { fid, requesterFids: requesterFid === undefined ? undefined : [requesterFid] })
      .then((r) => ({ currentUserNonce: r.currentUserNonce, requesterFidNonces: r.requesterFidNonces ?? {} }));
  }
  async fidByAddress(address: Hex): Promise<number | null> {
    return (await this.maybe<{ fid: number }>("/v1/onChainIdRegistryEventByAddress", { address }))?.fid ?? null;
  }
  async storageUnits(fid: number): Promise<number> {
    return (await this.call<{ units: number }>("/v1/storageLimitsByFid", { fid })).units;
  }
  async fidByName(name: string): Promise<number | null> {
    return (await this.maybe<{ fid: number }>("/v1/userNameProofByName", { name }))?.fid ?? null;
  }
  castById(fid: number, hash: Hex) { return this.maybe<Msg>("/v1/castById", { fid, hash }); }
  reactionById(fid: number, type: "Like" | "Recast", t: { fid: number; hash: Hex }) {
    return this.maybe<Msg>("/v1/reactionById", { fid, reaction_type: type, target_fid: t.fid, target_hash: t.hash });
  }
  linkById(fid: number, targetFid: number) {
    return this.maybe<Msg>("/v1/linkById", { fid, target_fid: targetFid, link_type: "follow" });
  }
  submit(bytes: Uint8Array): Promise<Msg> {
    return this.call<Msg>("/v1/submitMessage", {}, { method: "POST", headers: { "content-type": "application/octet-stream" }, body: bytes });
  }
}
```

- [ ] **Step 6: Implement `connect.ts`**

```ts
import { createServer } from "node:net";
import { NodeClient } from "./node-client.js";
import { requireState } from "../infra/state.js";
import { makeSsh } from "../infra/ssh.js";

const freePort = () => new Promise<number>((resolve) => {
  const s = createServer().listen(0, "127.0.0.1", () => { const p = (s.address() as { port: number }).port; s.close(() => resolve(p)); });
});

// Port 3381 is bound to 127.0.0.1 on the server, so we reach it through an SSH tunnel.
export async function openNode(o: { waitMs?: number } = {}): Promise<{ node: NodeClient; close(): void }> {
  const waitMs = o.waitMs ?? 15_000;
  let close = () => {};
  let base = process.env.FCX_NODE;
  if (!base) {
    const s = requireState();
    const port = await freePort();
    const t = makeSsh(s.sshTarget).tunnel(port, 3381);
    close = () => t.close();
    base = `http://127.0.0.1:${port}`;
  }
  const node = new NodeClient(base);
  if (waitMs === 0) return { node, close };
  const end = Date.now() + waitMs;
  while (Date.now() < end) {
    try { await node.info(); return { node, close }; } catch { await new Promise((r) => setTimeout(r, 250)); }
  }
  close();
  throw new Error("Can't reach your node. Run: fcx status");
}
```

- [ ] **Step 7: Run tests to verify they pass**

Run: `cd cli && npx vitest run test/client/node-client.test.ts`
Expected: PASS (6 tests).

- [ ] **Step 8: Commit**

```bash
git add cli/package.json cli/package-lock.json cli/src/client cli/test/client
git commit -m "feat(client): node HTTP client, SSH tunnel, in-memory fake node"
```

---

### Task 2: Key store and cache

**Files:**
- Create: `cli/src/client/keystore.ts`, `cli/src/client/cache.ts`, `cli/test/client/keystore.test.ts`

**Interfaces:**
- Consumes: `fcxHome()` (`src/infra/paths.ts`).
- Produces:
  - `interface AppKey { fid: number; privateKey: Hex; publicKey: Hex; requestFid: number; addedAt: number }`
  - `loadKey(): AppKey | null`, `requireKey(): AppKey` (throws `Not logged in. Run: fcx login --wallet`), `saveKey(k)`, `clearKey()`, `appSigner(k): NobleEd25519Signer`, `newAppKey(): Promise<{ privateKey: Uint8Array; publicKey: Hex }>`
  - `readCache<T>(name: string): T | undefined`, `writeCache(name: string, value: unknown): void` (files `$FCX_HOME/cache/<name>.json`, mode 0600)

- [ ] **Step 1: Write the failing test**

`cli/test/client/keystore.test.ts`:

```ts
import { describe, it, expect, beforeEach } from "vitest";
import { mkdtempSync, statSync } from "node:fs"; import { tmpdir } from "node:os"; import { join } from "node:path";
import { loadKey, saveKey, clearKey, requireKey, appSigner, newAppKey } from "../../src/client/keystore.js";
import { readCache, writeCache } from "../../src/client/cache.js";
import { bytesToHexString } from "@farcaster/core";

beforeEach(() => { process.env.FCX_HOME = mkdtempSync(join(tmpdir(), "fcx-")); });

describe("keystore", () => {
  it("round-trips with 0600 and signs with the saved key", async () => {
    const { privateKey, publicKey } = await newAppKey();
    const k = { fid: 10, privateKey: bytesToHexString(privateKey)._unsafeUnwrap(), publicKey, requestFid: 10, addedAt: 1 };
    saveKey(k);
    expect(loadKey()).toEqual(k);
    expect(statSync(join(process.env.FCX_HOME!, "key")).mode & 0o777).toBe(0o600);
    const pub = (await appSigner(k).getSignerKey())._unsafeUnwrap();
    expect(bytesToHexString(pub)._unsafeUnwrap()).toBe(publicKey);
  });
  it("clear and require", () => {
    clearKey(); expect(loadKey()).toBeNull();
    expect(() => requireKey()).toThrow("Not logged in. Run: fcx login --wallet");
  });
  it("cache round-trips", () => {
    expect(readCache("x")).toBeUndefined();
    writeCache("x", { a: 1 }); expect(readCache("x")).toEqual({ a: 1 });
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `cd cli && npx vitest run test/client/keystore.test.ts`
Expected: FAIL — cannot find `keystore.js`.

- [ ] **Step 3: Implement**

`cli/src/client/keystore.ts`:

```ts
// The app key is an Ed25519 key that lives only on this laptop. Your custody address
// authorized it once (KEY_ADD); from then on it signs casts, likes and follows for you.
import { readFileSync, writeFileSync, rmSync, existsSync } from "node:fs";
import { randomBytes } from "node:crypto";
import { join } from "node:path";
import { NobleEd25519Signer, ed25519, bytesToHexString, hexStringToBytes } from "@farcaster/core";
import { fcxHome } from "../infra/paths.js";
import type { Hex } from "./node-client.js";

export interface AppKey { fid: number; privateKey: Hex; publicKey: Hex; requestFid: number; addedAt: number }
const file = () => join(fcxHome(), "key");

export function loadKey(): AppKey | null {
  return existsSync(file()) ? (JSON.parse(readFileSync(file(), "utf8")) as AppKey) : null;
}
export function requireKey(): AppKey {
  const k = loadKey();
  if (!k) throw new Error("Not logged in. Run: fcx login --wallet");
  return k;
}
export function saveKey(k: AppKey): void { writeFileSync(file(), JSON.stringify(k, null, 2) + "\n", { mode: 0o600 }); }
export function clearKey(): void { rmSync(file(), { force: true }); }

export function appSigner(k: AppKey): NobleEd25519Signer {
  return new NobleEd25519Signer(hexStringToBytes(k.privateKey)._unsafeUnwrap());
}
export async function newAppKey(): Promise<{ privateKey: Uint8Array; publicKey: Hex }> {
  const privateKey = new Uint8Array(randomBytes(32));
  const pub = (await ed25519.getPublicKey(privateKey))._unsafeUnwrap();
  return { privateKey, publicKey: bytesToHexString(pub)._unsafeUnwrap() };
}
```

`cli/src/client/cache.ts`:

```ts
import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { join } from "node:path";
import { fcxHome } from "../infra/paths.js";

const dir = () => { const d = join(fcxHome(), "cache"); mkdirSync(d, { recursive: true, mode: 0o700 }); return d; };
export function readCache<T>(name: string): T | undefined {
  const f = join(dir(), `${name}.json`);
  return existsSync(f) ? (JSON.parse(readFileSync(f, "utf8")) as T) : undefined;
}
export function writeCache(name: string, value: unknown): void {
  writeFileSync(join(dir(), `${name}.json`), JSON.stringify(value), { mode: 0o600 });
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd cli && npx vitest run test/client/keystore.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add cli/src/client/keystore.ts cli/src/client/cache.ts cli/test/client/keystore.test.ts
git commit -m "feat(client): app key store and JSON cache"
```

---

### Task 3: Messages and the write loop

**Files:**
- Create: `cli/src/client/messages.ts`, `cli/src/client/writer.ts`, `cli/test/client/writer.test.ts`

**Interfaces:**
- Consumes: `NodeClient`, `NodeError`, `Hex` (Task 1); `AppKey`, `appSigner` (Task 2).
- Produces:
  - `interface CastRef { fid: number; hash: Hex }`
  - `interface Write { what: string; message: Message; landed(node: NodeClient): Promise<boolean> }`
  - `castWrite(k, text, o?: { replyTo?: CastRef; channel?: string }): Promise<Write>`
  - `reactionWrite(k, kind: "like" | "recast", target: CastRef, remove: boolean): Promise<Write>`
  - `followWrite(k, targetFid: number, remove: boolean): Promise<Write>`
  - `hashOf(m: Message): Hex`
  - `submitAndConfirm(node, w: Write, o?: { tries?: number; waitMs?: number; pollMs?: number; sleep?: (ms: number) => Promise<void> }): Promise<{ hash: Hex; tries: number }>`

- [ ] **Step 1: Write the failing tests**

`cli/test/client/writer.test.ts`:

```ts
import { describe, it, expect, beforeEach } from "vitest";
import { bytesToHexString } from "@farcaster/core";
import { NodeClient } from "../../src/client/node-client.js";
import { newAppKey, type AppKey } from "../../src/client/keystore.js";
import { castWrite, reactionWrite, followWrite } from "../../src/client/messages.js";
import { submitAndConfirm } from "../../src/client/writer.js";
import { fakeNode } from "./fake-node.js";

const fast = { waitMs: 30, pollMs: 10, sleep: (ms: number) => new Promise<void>((r) => setTimeout(r, ms)) };
let fake: ReturnType<typeof fakeNode>, node: NodeClient, k: AppKey;
beforeEach(async () => {
  fake = fakeNode(); node = new NodeClient("http://node", fake.fetch);
  const n = await newAppKey();
  k = { fid: 10, privateKey: bytesToHexString(n.privateKey)._unsafeUnwrap(), publicKey: n.publicKey, requestFid: 10, addedAt: 1 };
});

describe("submitAndConfirm", () => {
  it("lands a cast on the first try", async () => {
    const r = await submitAndConfirm(node, await castWrite(k, "gm"), fast);
    expect(r.tries).toBe(1);
    expect(fake.store.casts[0].data.castAddBody!.text).toBe("gm");
  });
  it("resubmits the same bytes when gossip drops it", async () => {
    fake.knobs.dropSubmits = 2;
    const w = await castWrite(k, "gm");
    const r = await submitAndConfirm(node, w, fast);
    expect(r.tries).toBe(3);
    expect(fake.store.submits).toBe(3);
    expect(fake.store.casts).toHaveLength(1);
  });
  it("gives up after 3 tries with a clear error", async () => {
    fake.knobs.dropSubmits = 99;
    await expect(submitAndConfirm(node, await castWrite(k, "gm"), fast))
      .rejects.toThrow("Sent the cast 3 times. Your node never showed it. Is it synced? Run: fcx status");
  });
  it("stops at once when the node rejects the message", async () => {
    fake.knobs.reject = "invalid signer";
    await expect(submitAndConfirm(node, await castWrite(k, "gm"), fast)).rejects.toThrow("Your node rejected the cast: invalid signer");
    expect(fake.store.submits).toBe(1);
  });
  it("duplicate on resubmit is not a rejection", async () => {
    fake.knobs.duplicateOnResubmit = true; fake.knobs.dropSubmits = 1;
    const w = await castWrite(k, "gm");
    // first submit is dropped; the second is a "duplicate". Merge it by hand to simulate a late gossip arrival.
    const p = submitAndConfirm(node, w, fast);
    setTimeout(() => fake.store.merge(w.message), 50);
    expect((await p).tries).toBeGreaterThanOrEqual(2);
  });
});

describe("writes", () => {
  it("like, unlike, follow, unfollow, reply and channel", async () => {
    const c = await castWrite(k, "parent"); await submitAndConfirm(node, c, fast);
    const ref = { fid: 10, hash: bytesToHexString(c.message.hash)._unsafeUnwrap() };
    await submitAndConfirm(node, await reactionWrite(k, "like", ref, false), fast);
    expect(fake.store.reactions).toHaveLength(1);
    await submitAndConfirm(node, await reactionWrite(k, "like", ref, true), fast);
    expect(fake.store.reactions).toHaveLength(0);
    await submitAndConfirm(node, await followWrite(k, 99, false), fast);
    expect(await node.following(10)).toEqual([99]);
    await submitAndConfirm(node, await followWrite(k, 99, true), fast);
    expect(await node.following(10)).toEqual([]);
    await submitAndConfirm(node, await castWrite(k, "reply", { replyTo: ref }), fast);
    await submitAndConfirm(node, await castWrite(k, "chan", { channel: "https://farcaster.xyz/~/channel/dev" }), fast);
    expect(fake.store.casts.map((x) => [x.data.castAddBody!.parentCastId?.hash, x.data.castAddBody!.parentUrl]))
      .toEqual([[undefined, undefined], [ref.hash, undefined], [undefined, "https://farcaster.xyz/~/channel/dev"]]);
  });
  it("rejects a cast over 320 bytes before sending", async () => {
    await expect(castWrite(k, "x".repeat(321))).rejects.toThrow("Cast is too long (321 bytes, max 320).");
  });
});
```

- [ ] **Step 2: Run them to verify they fail**

Run: `cd cli && npx vitest run test/client/writer.test.ts`
Expected: FAIL — cannot find `messages.js`.

- [ ] **Step 3: Implement `messages.ts`**

```ts
// Each write is a signed protobuf Message plus a check that tells us it reached the network.
import { makeCastAdd, makeReactionAdd, makeReactionRemove, makeLinkAdd, makeLinkRemove, FarcasterNetwork, ReactionType,
  CastType, Message, bytesToHexString, hexStringToBytes, type HubAsyncResult } from "@farcaster/core";
import type { NodeClient, Hex } from "./node-client.js";
import { appSigner, type AppKey } from "./keystore.js";

export interface CastRef { fid: number; hash: Hex }
export interface Write { what: string; message: Message; landed(node: NodeClient): Promise<boolean> }

const opts = (k: AppKey) => ({ fid: k.fid, network: FarcasterNetwork.MAINNET });
const bytes = (h: Hex) => hexStringToBytes(h)._unsafeUnwrap();
export const hashOf = (m: Message) => bytesToHexString(m.hash)._unsafeUnwrap() as Hex;
async function unwrap<T>(r: HubAsyncResult<T>): Promise<T> {
  const v = await r; if (v.isErr()) throw new Error(v.error.message); return v.value;
}

export async function castWrite(k: AppKey, text: string, o: { replyTo?: CastRef; channel?: string } = {}): Promise<Write> {
  const size = Buffer.byteLength(text);
  if (size > 320) throw new Error(`Cast is too long (${size} bytes, max 320).`);
  const message = await unwrap(makeCastAdd({ text, type: CastType.CAST, embeds: [], embedsDeprecated: [], mentions: [], mentionsPositions: [],
    parentCastId: o.replyTo && { fid: o.replyTo.fid, hash: bytes(o.replyTo.hash) }, parentUrl: o.channel }, opts(k), appSigner(k)));
  return { what: "cast", message, landed: async (n) => (await n.castById(k.fid, hashOf(message))) !== null };
}

export async function reactionWrite(k: AppKey, kind: "like" | "recast", t: CastRef, remove: boolean): Promise<Write> {
  const body = { type: kind === "like" ? ReactionType.LIKE : ReactionType.RECAST, targetCastId: { fid: t.fid, hash: bytes(t.hash) } };
  const message = await unwrap((remove ? makeReactionRemove : makeReactionAdd)(body, opts(k), appSigner(k)));
  const type = kind === "like" ? "Like" : "Recast";
  return { what: remove ? `un${kind}` : kind, message,
    landed: async (n) => ((await n.reactionById(k.fid, type, t)) !== null) !== remove };
}

export async function followWrite(k: AppKey, targetFid: number, remove: boolean): Promise<Write> {
  const message = await unwrap((remove ? makeLinkRemove : makeLinkAdd)({ type: "follow", targetFid }, opts(k), appSigner(k)));
  return { what: remove ? "unfollow" : "follow", message,
    landed: async (n) => ((await n.linkById(k.fid, targetFid)) !== null) !== remove };
}
```

- [ ] **Step 4: Implement `writer.ts`**

```ts
// A read node answers "accepted" once the message is valid and gossiped. That does not mean
// a validator put it in a block. So we watch for it, and send the same bytes again if it never shows up.
import { Message } from "@farcaster/core";
import { NodeError, type NodeClient, type Hex } from "./node-client.js";
import { hashOf, type Write } from "./messages.js";

const isDuplicate = (e: NodeError) => /duplicate|already (been )?merged/i.test(e.message);

export async function submitAndConfirm(node: NodeClient, w: Write,
  o: { tries?: number; waitMs?: number; pollMs?: number; sleep?: (ms: number) => Promise<void> } = {}): Promise<{ hash: Hex; tries: number }> {
  const tries = o.tries ?? 3, waitMs = o.waitMs ?? 15_000, pollMs = o.pollMs ?? 3_000;
  const sleep = o.sleep ?? ((ms) => new Promise<void>((r) => setTimeout(r, ms)));
  const bytes = Message.encode(w.message).finish();
  for (let t = 1; t <= tries; t++) {
    try { await node.submit(bytes); }
    catch (e) {
      if (!(e instanceof NodeError) || e.status >= 500) throw e;
      if (!isDuplicate(e)) throw new Error(`Your node rejected the ${w.what}: ${e.message}`);
    }
    for (let waited = 0; waited <= waitMs; waited += pollMs) {
      if (await w.landed(node)) return { hash: hashOf(w.message), tries: t };
      await sleep(pollMs);
    }
  }
  throw new Error(`Sent the ${w.what} ${tries} times. Your node never showed it. Is it synced? Run: fcx status`);
}
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `cd cli && npx vitest run test/client/writer.test.ts`
Expected: PASS (7 tests).

- [ ] **Step 6: Commit**

```bash
git add cli/src/client/messages.ts cli/src/client/writer.ts cli/test/client/writer.test.ts
git commit -m "feat(client): cast/reaction/link writes with confirm and resubmit"
```

---

### Task 4: Names, client resolution, feed

**Files:**
- Create: `cli/src/client/names.ts`, `cli/src/client/signers.ts`, `cli/src/client/feed.ts`, `cli/src/client/format.ts`, `cli/test/client/feed.test.ts`

**Interfaces:**
- Consumes: `NodeClient`, `Msg`, `Hex` (Task 1); `readCache`, `writeCache` (Task 2); `CastRef` (Task 3).
- Produces:
  - `class Names { constructor(node); username(fid): Promise<string>; fidOf(who: string): Promise<number>; save(): void }` — `who` is `@name`, `name` or a number; unknown → throws `No user '@x' on your node.`
  - `rememberCasts(items: { fid: number; hash: Hex }[]): void`, `parseRef(s: string): CastRef` — `fid/0xhash`, a full hash, or a hash prefix (≥ 8 hex chars) seen in the last feed; else throws `Unknown cast '<s>'. Use <fid>/<hash> or a hash from fcx feed.`
  - `class Clients { constructor(node); appFid(fid, signer: Hex): Promise<number>; save(): void }` — 0 when unknown.
  - `interface FeedItem { fid: number; username: string; hash: Hex; text: string; time: number; appFid: number; app: string; replyTo?: CastRef; channel?: string }` (`time` = Unix seconds)
  - `buildFeed(node, me: number, o: { limit: number; onlyClient?: number; excludeClient?: number; windowDays?: number; now?: number }): Promise<FeedItem[]>`
  - `countClients(items: FeedItem[]): { appFid: number; app: string; count: number }[]` (sorted by count desc)
  - `formatFeed(items, now: number): string`, `formatClients(rows): string`
  - `const FC_EPOCH = 1609459200`

- [ ] **Step 1: Write the failing tests**

`cli/test/client/feed.test.ts`:

```ts
import { describe, it, expect, beforeEach } from "vitest";
import { mkdtempSync } from "node:fs"; import { tmpdir } from "node:os"; import { join } from "node:path";
import { encodeAbiParameters } from "viem";
import { GASLESS_SIGNED_KEY_REQUEST_METADATA_ABI } from "@farcaster/core";
import { NodeClient, type Hex, type Msg } from "../../src/client/node-client.js";
import { buildFeed, countClients, FC_EPOCH } from "../../src/client/feed.js";
import { Names, parseRef, rememberCasts } from "../../src/client/names.js";
import { formatFeed } from "../../src/client/format.js";
import { fakeNode } from "./fake-node.js";

const NOW = FC_EPOCH + 100_000;
const h = (n: number) => `0x${n.toString(16).padStart(40, "0")}` as Hex;
const cast = (fid: number, n: number, signer: Hex, ts: number): Msg => ({ hash: h(n), signer,
  data: { type: "MESSAGE_TYPE_CAST_ADD", fid, timestamp: ts, castAddBody: { text: `cast ${n}`, embeds: [] } } });
const onchainMeta = (requestFid: number) => Buffer.from(encodeAbiParameters(GASLESS_SIGNED_KEY_REQUEST_METADATA_ABI,
  [{ requestFid: BigInt(requestFid), requestSigner: "0x0000000000000000000000000000000000000001", signature: "0x", deadline: 0n }]).slice(2), "hex").toString("base64");

let fake: ReturnType<typeof fakeNode>, node: NodeClient;
beforeEach(() => {
  process.env.FCX_HOME = mkdtempSync(join(tmpdir(), "fcx-"));
  fake = fakeNode(); node = new NodeClient("http://node", fake.fetch);
  const s = fake.store;
  for (const [fid, name] of [[1, "me"], [2, "bob"], [3, "carol"], [9152, "farcaster"], [777, "otherapp"]] as const)
    s.addAccount({ fid, custody: h(fid) as Hex, username: name });
  s.follow(1, 2); s.follow(1, 3);
  s.addKey({ fid: 2, key: "0xb0", requestFid: 9152, source: "SIGNER_SOURCE_OFFCHAIN" });
  s.addKey({ fid: 3, key: "0xc0", requestFid: 0, source: "SIGNER_SOURCE_ONCHAIN", metadata: onchainMeta(777) });
  s.addCast(cast(2, 1, "0xb0", 99_000)); s.addCast(cast(3, 2, "0xc0", 99_500)); s.addCast(cast(2, 3, "0xb0", 99_900));
  s.addCast(cast(3, 4, "0xc0", 1)); // older than the window
});

describe("feed", () => {
  it("merges followed casts newest first, with names and apps", async () => {
    const f = await buildFeed(node, 1, { limit: 10, now: NOW });
    expect(f.map((x) => [x.username, x.text, x.app])).toEqual([
      ["bob", "cast 3", "@farcaster"], ["carol", "cast 2", "@otherapp"], ["bob", "cast 1", "@farcaster"]]);
    expect(f[0].time).toBe(FC_EPOCH + 99_900);
  });
  it("only-client and exclude-client", async () => {
    expect((await buildFeed(node, 1, { limit: 10, now: NOW, onlyClient: 777 })).map((x) => x.text)).toEqual(["cast 2"]);
    expect((await buildFeed(node, 1, { limit: 10, now: NOW, excludeClient: 777 })).map((x) => x.text)).toEqual(["cast 3", "cast 1"]);
  });
  it("respects the limit and counts clients", async () => {
    const f = await buildFeed(node, 1, { limit: 2, now: NOW });
    expect(f).toHaveLength(2);
    expect(countClients(await buildFeed(node, 1, { limit: 10, now: NOW })))
      .toEqual([{ appFid: 9152, app: "@farcaster", count: 2 }, { appFid: 777, app: "@otherapp", count: 1 }]);
  });
  it("prints a readable feed", async () => {
    const out = formatFeed(await buildFeed(node, 1, { limit: 1, now: NOW }), NOW);
    expect(out).toBe("@bob · 1m · via @farcaster · 0x00000000\n  cast 3\n");
  });
});

describe("names and refs", () => {
  it("resolves @name and numbers", async () => {
    const n = new Names(node);
    expect(await n.fidOf("@bob")).toBe(2);
    expect(await n.fidOf("3")).toBe(3);
    await expect(n.fidOf("@nobody")).rejects.toThrow("No user '@nobody' on your node.");
  });
  it("parses cast refs from fid/hash or a remembered prefix", () => {
    rememberCasts([{ fid: 2, hash: h(0xabcdef12) }]);
    expect(parseRef(`5/${h(1)}`)).toEqual({ fid: 5, hash: h(1) });
    expect(parseRef("0x00000000000000000000000000000000abcdef12")).toEqual({ fid: 2, hash: h(0xabcdef12) });
    expect(parseRef("0x0000000000")).toEqual({ fid: 2, hash: h(0xabcdef12) });
    expect(() => parseRef("0xdeadbeef")).toThrow("Unknown cast '0xdeadbeef'. Use <fid>/<hash> or a hash from fcx feed.");
  });
});
```

Note: the formatted line shows the first 10 characters of the hash (`0x` + 8 hex). `0x0000000000` matches because it is a prefix of the remembered hash; if two remembered hashes share a prefix, `parseRef` throws `Cast prefix '<s>' matches more than one cast. Use more characters.` — add that test case too.

- [ ] **Step 2: Run them to verify they fail**

Run: `cd cli && npx vitest run test/client/feed.test.ts`
Expected: FAIL — cannot find `feed.js`.

- [ ] **Step 3: Implement `names.ts`**

```ts
import type { NodeClient, Hex } from "./node-client.js";
import { readCache, writeCache } from "./cache.js";
import type { CastRef } from "./messages.js";

export class Names {
  private names: Record<number, string>;
  constructor(private node: NodeClient) { this.names = readCache("names") ?? {}; }
  async username(fid: number): Promise<string> {
    if (!(fid in this.names)) this.names[fid] = (await this.node.userData(fid)).USER_DATA_TYPE_USERNAME ?? `fid:${fid}`;
    return this.names[fid];
  }
  async fidOf(who: string): Promise<number> {
    if (/^\d+$/.test(who)) return Number(who);
    const name = who.replace(/^@/, "");
    const fid = await this.node.fidByName(name);
    if (fid === null) throw new Error(`No user '@${name}' on your node.`);
    return fid;
  }
  save(): void { writeCache("names", this.names); }
}

// fcx feed shows short hashes. We remember which FID wrote each one, so "fcx like 0x1a2b3c4d" works.
export function rememberCasts(items: { fid: number; hash: Hex }[]): void {
  writeCache("casts", Object.fromEntries(items.map((i) => [i.hash, i.fid])));
}
export function parseRef(s: string): CastRef {
  const m = /^(\d+)\/(0x[0-9a-f]{40})$/i.exec(s);
  if (m) return { fid: Number(m[1]), hash: m[2].toLowerCase() as Hex };
  const seen = readCache<Record<string, number>>("casts") ?? {};
  const hits = /^0x[0-9a-f]{8,40}$/i.test(s) ? Object.keys(seen).filter((h) => h.startsWith(s.toLowerCase())) : [];
  if (hits.length > 1) throw new Error(`Cast prefix '${s}' matches more than one cast. Use more characters.`);
  if (hits.length === 0) throw new Error(`Unknown cast '${s}'. Use <fid>/<hash> or a hash from fcx feed.`);
  return { fid: seen[hits[0]], hash: hits[0] as Hex };
}
```

- [ ] **Step 4: Implement `signers.ts`**

```ts
// Which app posted a cast? The cast is signed by an app key. When that key was added, the
// SignedKeyRequest metadata named the app's own FID (requestFid). That FID is the "client".
import { decodeAbiParameters } from "viem";
import { GASLESS_SIGNED_KEY_REQUEST_METADATA_ABI } from "@farcaster/core";
import type { NodeClient, Hex, SignerInfo } from "./node-client.js";
import { readCache, writeCache } from "./cache.js";

export function requestFidOf(s: SignerInfo): number {
  if (s.requestFid) return s.requestFid;
  const meta = s.onChainEvent?.signerEventBody?.metadata;
  if (!meta) return 0;
  // Onchain keys carry the same struct, ABI-encoded and base64'd in the JSON.
  const [m] = decodeAbiParameters(GASLESS_SIGNED_KEY_REQUEST_METADATA_ABI, `0x${Buffer.from(meta, "base64").toString("hex")}`);
  return Number(m.requestFid);
}

export class Clients {
  private map: Record<string, number>;
  constructor(private node: NodeClient) { this.map = readCache("signers") ?? {}; }
  async appFid(fid: number, signer: Hex): Promise<number> {
    const id = `${fid}:${signer}`;
    if (!(id in this.map)) {
      const s = await this.node.signer(fid, signer);
      this.map[id] = s ? requestFidOf(s) : 0;
    }
    return this.map[id];
  }
  save(): void { writeCache("signers", this.map); }
}
```

- [ ] **Step 5: Implement `feed.ts`**

```ts
// There is no "home feed" endpoint on a node. We build it: who do I follow, what did each of
// them cast lately, merge newest first, then tag each cast with the app that posted it.
import type { NodeClient, Msg, Hex } from "./node-client.js";
import type { CastRef } from "./messages.js";
import { Names, rememberCasts } from "./names.js";
import { Clients } from "./signers.js";

export const FC_EPOCH = 1609459200; // Farcaster time 0 = 2021-01-01 UTC
export interface FeedItem { fid: number; username: string; hash: Hex; text: string; time: number; appFid: number; app: string; replyTo?: CastRef; channel?: string }

async function pool<T, R>(items: T[], n: number, fn: (x: T) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length); let i = 0;
  await Promise.all(Array.from({ length: Math.min(n, items.length) }, async () => {
    while (i < items.length) { const j = i++; out[j] = await fn(items[j]); }
  }));
  return out;
}

export async function buildFeed(node: NodeClient, me: number,
  o: { limit: number; onlyClient?: number; excludeClient?: number; windowDays?: number; now?: number }): Promise<FeedItem[]> {
  const now = o.now ?? Math.floor(Date.now() / 1000);
  const since = now - FC_EPOCH - (o.windowDays ?? 3) * 86400;
  const fids = [...new Set([me, ...(await node.following(me))])];
  const per = await pool(fids, 8, (fid) => node.castsByFid(fid, { pageSize: o.limit, startTimestamp: Math.max(0, since) }));
  const casts = per.flat().sort((a, b) => b.data.timestamp - a.data.timestamp);

  const names = new Names(node), clients = new Clients(node), out: FeedItem[] = [];
  for (const c of casts) {
    if (out.length >= o.limit) break;
    const appFid = await clients.appFid(c.data.fid, c.signer);
    if (o.onlyClient !== undefined && appFid !== o.onlyClient) continue;
    if (o.excludeClient !== undefined && appFid === o.excludeClient) continue;
    out.push(await toItem(c, appFid, names));
  }
  names.save(); clients.save(); rememberCasts(out);
  return out;
}

async function toItem(c: Msg, appFid: number, names: Names): Promise<FeedItem> {
  const b = c.data.castAddBody!;
  return { fid: c.data.fid, username: await names.username(c.data.fid), hash: c.hash, text: b.text, time: FC_EPOCH + c.data.timestamp,
    appFid, app: appFid ? `@${await names.username(appFid)}` : "unknown app",
    replyTo: b.parentCastId && { fid: b.parentCastId.fid, hash: b.parentCastId.hash as Hex }, channel: b.parentUrl };
}

export function countClients(items: FeedItem[]): { appFid: number; app: string; count: number }[] {
  const m = new Map<number, { appFid: number; app: string; count: number }>();
  for (const i of items) { const r = m.get(i.appFid) ?? { appFid: i.appFid, app: i.app, count: 0 }; r.count++; m.set(i.appFid, r); }
  return [...m.values()].sort((a, b) => b.count - a.count);
}
```

- [ ] **Step 6: Implement `format.ts`**

```ts
import type { FeedItem } from "./feed.js";

export function ago(sec: number): string {
  if (sec < 3600) return `${Math.max(1, Math.floor(sec / 60))}m`;
  if (sec < 86400) return `${Math.floor(sec / 3600)}h`;
  return `${Math.floor(sec / 86400)}d`;
}
export function formatFeed(items: FeedItem[], now: number): string {
  if (items.length === 0) return "Nothing in the last 3 days. Follow someone: fcx follow @dwr\n";
  return items.map((i) => {
    const where = i.replyTo ? " · reply" : i.channel ? ` · ${i.channel}` : "";
    const text = i.text.split("\n").map((l) => `  ${l}`).join("\n");
    return `@${i.username} · ${ago(now - i.time)} · via ${i.app}${where} · ${i.hash.slice(0, 10)}\n${text}\n`;
  }).join("\n");
}
export function formatClients(rows: { appFid: number; app: string; count: number }[]): string {
  return rows.map((r) => `${String(r.count).padStart(4)}  ${r.app} (fid ${r.appFid})`).join("\n") + "\n";
}
```

- [ ] **Step 7: Run tests to verify they pass**

Run: `cd cli && npx vitest run test/client/feed.test.ts`
Expected: PASS (7 tests).

- [ ] **Step 8: Commit**

```bash
git add cli/src/client/names.ts cli/src/client/signers.ts cli/src/client/feed.ts cli/src/client/format.ts cli/test/client/feed.test.ts
git commit -m "feat(client): feed, client filters, names and cast refs"
```

---

### Task 5: Login core, seed-phrase login, logout

**Files:**
- Create: `cli/src/client/login.ts`, `cli/src/client/seed.ts`, `cli/test/client/login.test.ts`

**Interfaces:**
- Consumes: `NodeClient`, `Hex` (Task 1); `newAppKey`, `saveKey`, `loadKey`, `clearKey`, `appSigner`, `AppKey` (Task 2); `Write`, `submitAndConfirm` (Task 3).
- Produces:
  - `const SCOPES: MessageType[]`, `const KEY_TTL = 30 * 86400`
  - `addAppKey(node, custody: Eip712Signer, address: Hex, o?: { log?: (s: string) => void; write?: WriteOpts }): Promise<AppKey>`
  - `logout(node, o?: { write?: WriteOpts }): Promise<"revoked" | "not-logged-in">`
  - `const NEEDS_HUMAN = "Login needs a human at the keyboard. Ask them to run: fcx login --wallet"`
  - `requireTty(io: { stdin: { isTTY?: boolean }; stdout: { isTTY?: boolean } }): void`
  - `normalizeMnemonic(s): string`, `validMnemonic(s): boolean`
  - `readHidden(prompt: string, io: { stdin: NodeJS.ReadStream; stdout: NodeJS.WriteStream }): Promise<string>`
  - `seedLogin(node, io): Promise<AppKey>`
  - `type WriteOpts = Parameters<typeof submitAndConfirm>[2]` (exported from `writer.ts`)

- [ ] **Step 1: Write the failing tests**

`cli/test/client/login.test.ts`:

```ts
import { describe, it, expect, beforeEach } from "vitest";
import { mkdtempSync } from "node:fs"; import { tmpdir } from "node:os"; import { join } from "node:path";
import { PassThrough } from "node:stream";
import { ViemLocalEip712Signer } from "@farcaster/core";
import { mnemonicToAccount } from "viem/accounts";
import { NodeClient } from "../../src/client/node-client.js";
import { addAppKey, logout } from "../../src/client/login.js";
import { validMnemonic, normalizeMnemonic, readHidden, requireTty, NEEDS_HUMAN } from "../../src/client/seed.js";
import { loadKey } from "../../src/client/keystore.js";
import { fakeNode } from "./fake-node.js";

const PHRASE = "test test test test test test test test test test test junk";
const acct = mnemonicToAccount(PHRASE); // 0xf39F…2266 (the well-known dev account; no funds, no FID)
const fast = { waitMs: 30, pollMs: 10 };
let fake: ReturnType<typeof fakeNode>, node: NodeClient;
beforeEach(() => {
  process.env.FCX_HOME = mkdtempSync(join(tmpdir(), "fcx-"));
  fake = fakeNode(); node = new NodeClient("http://node", fake.fetch);
  fake.store.addAccount({ fid: 42, custody: acct.address, units: 1 });
});

describe("addAppKey", () => {
  it("adds a gasless key for the custody address and saves it", async () => {
    const k = await addAppKey(node, new ViemLocalEip712Signer(acct), acct.address, { write: fast });
    expect(k.fid).toBe(42); expect(k.requestFid).toBe(42);
    expect(fake.store.keys.map((x) => x.key)).toEqual([k.publicKey]);
    expect(loadKey()).toEqual(k);
  });
  it("uses the next user nonce", async () => {
    fake.store.accounts.get(42)!.nonce = 7;
    await addAppKey(node, new ViemLocalEip712Signer(acct), acct.address, { write: fast });
    expect(fake.store.accounts.get(42)!.nonce).toBe(8);
  });
  it("refuses an address with no FID", async () => {
    fake.store.accounts.clear();
    await expect(addAppKey(node, new ViemLocalEip712Signer(acct), acct.address, { write: fast }))
      .rejects.toThrow(`${acct.address} is not the custody address of any FID.`);
    expect(loadKey()).toBeNull();
  });
  it("refuses an FID without storage", async () => {
    fake.store.accounts.get(42)!.units = 0;
    await expect(addAppKey(node, new ViemLocalEip712Signer(acct), acct.address, { write: fast }))
      .rejects.toThrow("FID 42 has no storage. It needs storage rent before it can post.");
  });
});

describe("logout", () => {
  it("self-revokes the key with the next app nonce and deletes the file", async () => {
    const k = await addAppKey(node, new ViemLocalEip712Signer(acct), acct.address, { write: fast });
    fake.store.accounts.get(42)!.appNonces[42] = 3;
    expect(await logout(node, { write: fast })).toBe("revoked");
    expect(fake.store.keys.find((x) => x.key === k.publicKey)).toBeUndefined();
    expect(fake.store.accounts.get(42)!.appNonces[42]).toBe(4);
    expect(loadKey()).toBeNull();
  });
  it("is fine when not logged in", async () => { expect(await logout(node)).toBe("not-logged-in"); });
});

describe("seed phrase input", () => {
  it("normalizes and validates", () => {
    expect(normalizeMnemonic("  Test test\ttest test test test test test test test test JUNK \n")).toBe(PHRASE);
    expect(validMnemonic(PHRASE)).toBe(true);
    expect(validMnemonic("abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about")).toBe(true);
    expect(validMnemonic("abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon")).toBe(false); // bad checksum
    expect(validMnemonic("test test test")).toBe(false);
    expect(validMnemonic("test test test test test test test test test test test jnuk")).toBe(false);
  });
  it("refuses without a TTY", () => {
    expect(() => requireTty({ stdin: { isTTY: false }, stdout: { isTTY: true } })).toThrow(NEEDS_HUMAN);
  });
  it("reads hidden input without echoing it", async () => {
    const stdin = Object.assign(new PassThrough(), { isTTY: true, setRawMode: () => stdin }) as unknown as NodeJS.ReadStream;
    const out = new PassThrough(); let shown = ""; out.on("data", (d) => (shown += d));
    const p = readHidden("Seed phrase: ", { stdin, stdout: out as unknown as NodeJS.WriteStream });
    stdin.write("secret wordz"); stdin.write("\x7f"); stdin.write("s\r");
    expect(await p).toBe("secret words");
    expect(shown).not.toContain("secret");
  });
});
```

- [ ] **Step 2: Run them to verify they fail**

Run: `cd cli && npx vitest run test/client/login.test.ts`
Expected: FAIL — cannot find `login.js`.

- [ ] **Step 3: Export `WriteOpts` from `writer.ts`**

Add below the imports in `cli/src/client/writer.ts`:

```ts
export type WriteOpts = { tries?: number; waitMs?: number; pollMs?: number; sleep?: (ms: number) => Promise<void> };
```
and change the `submitAndConfirm` signature's third parameter to `o: WriteOpts = {}`.

- [ ] **Step 4: Implement `login.ts`**

```ts
// Adding an app key, step by step. Your custody address signs two EIP-712 messages; no gas,
// no transaction. Our own node checks them and gossips the KEY_ADD to the validators.
import { makeKeyAddBody, makeKeyAdd, makeKeyRemoveBodySelfRevoke, makeKeyRemove, FarcasterNetwork, MessageType,
  getFarcasterTime, type Eip712Signer } from "@farcaster/core";
import type { NodeClient, Hex } from "./node-client.js";
import { newAppKey, saveKey, loadKey, clearKey, appSigner, type AppKey } from "./keystore.js";
import { submitAndConfirm, type WriteOpts } from "./writer.js";
import { bytesToHexString } from "@farcaster/core";

export const SCOPES = [MessageType.CAST_ADD, MessageType.CAST_REMOVE, MessageType.REACTION_ADD,
  MessageType.REACTION_REMOVE, MessageType.LINK_ADD, MessageType.LINK_REMOVE];
export const KEY_TTL = 30 * 86400; // the key expires 30 days after its last use
const fcNow = () => getFarcasterTime()._unsafeUnwrap();
const net = (fid: number) => ({ fid, network: FarcasterNetwork.MAINNET });

export async function addAppKey(node: NodeClient, custody: Eip712Signer, address: Hex,
  o: { log?: (s: string) => void; write?: WriteOpts } = {}): Promise<AppKey> {
  const log = o.log ?? (() => {});
  const fid = await node.fidByAddress(address);
  if (fid === null) throw new Error(`${address} is not the custody address of any FID.`);
  if ((await node.storageUnits(fid)) === 0) throw new Error(`FID ${fid} has no storage. It needs storage rent before it can post.`);
  const nonce = (await node.signersByFid(fid)).currentUserNonce + 1;
  log(`FID ${fid}. Asking the custody address to sign the new app key…`);

  const { privateKey, publicKey } = await newAppKey();
  const r = await makeKeyAddBody({ fid: BigInt(fid), key: Buffer.from(publicKey.slice(2), "hex"), scopes: SCOPES,
    ttl: KEY_TTL, nonce, deadline: fcNow() + 3600 }, custody);
  if (r.isErr()) throw new Error(/reject|denied|4001/i.test(r.error.message) ? "You rejected the request in your wallet. Nothing was added." : r.error.message);

  const k: AppKey = { fid, privateKey: bytesToHexString(privateKey)._unsafeUnwrap(), publicKey, requestFid: fid, addedAt: Math.floor(Date.now() / 1000) };
  // KEY_ADD is signed by the new key itself: proof we hold it.
  const m = await makeKeyAdd(r.value, net(fid), appSigner(k));
  if (m.isErr()) throw new Error(m.error.message);
  log("Sending KEY_ADD through your node…");
  await submitAndConfirm(node, { what: "KEY_ADD", message: m.value, landed: async (n) => (await n.signer(fid, publicKey)) !== null }, o.write);
  saveKey(k);
  return k;
}

export async function logout(node: NodeClient, o: { write?: WriteOpts } = {}): Promise<"revoked" | "not-logged-in"> {
  const k = loadKey();
  if (!k) return "not-logged-in";
  if ((await node.signer(k.fid, k.publicKey)) !== null) {
    // Self-revoke: the key signs its own removal. It uses the app nonce of the FID that requested it.
    const nonce = ((await node.signersByFid(k.fid, k.requestFid)).requesterFidNonces[String(k.requestFid)] ?? 0) + 1;
    const body = makeKeyRemoveBodySelfRevoke({ key: Buffer.from(k.publicKey.slice(2), "hex"), nonce, deadline: fcNow() + 3600 });
    if (body.isErr()) throw new Error(body.error.message);
    const m = await makeKeyRemove(body.value, net(k.fid), appSigner(k));
    if (m.isErr()) throw new Error(m.error.message);
    await submitAndConfirm(node, { what: "KEY_REMOVE", message: m.value, landed: async (n) => (await n.signer(k.fid, k.publicKey)) === null }, o.write);
  }
  clearKey();
  return "revoked";
}
```

- [ ] **Step 5: Implement `seed.ts`**

```ts
// Seed-phrase login. The phrase controls the whole account, so: a warning, hidden input,
// memory only, and we check the derived address is the account's custody address before signing.
import { createHash } from "node:crypto";
import { mnemonicToAccount, english } from "viem/accounts";
import { ViemLocalEip712Signer } from "@farcaster/core";
import type { NodeClient } from "./node-client.js";
import { addAppKey } from "./login.js";
import type { AppKey } from "./keystore.js";

export const NEEDS_HUMAN = "Login needs a human at the keyboard. Ask them to run: fcx login --wallet";
type Io = { stdin: NodeJS.ReadStream; stdout: NodeJS.WriteStream };

export function requireTty(io: { stdin: { isTTY?: boolean }; stdout: { isTTY?: boolean } }): void {
  if (!io.stdin.isTTY || !io.stdout.isTTY) throw new Error(NEEDS_HUMAN);
}
export const normalizeMnemonic = (s: string) => s.trim().toLowerCase().split(/\s+/).join(" ");

// BIP-39: each word is 11 bits; the last few bits are a SHA-256 checksum of the rest.
export function validMnemonic(s: string): boolean {
  const words = s.split(" ");
  if (![12, 15, 18, 21, 24].includes(words.length)) return false;
  const idx = words.map((w) => english.indexOf(w));
  if (idx.some((i) => i < 0)) return false;
  const bits = idx.map((i) => i.toString(2).padStart(11, "0")).join("");
  const cs = words.length / 3;
  const entropy = Buffer.from(bits.slice(0, -cs).match(/.{8}/g)!.map((b) => parseInt(b, 2)));
  const want = createHash("sha256").update(entropy).digest()[0].toString(2).padStart(8, "0").slice(0, cs);
  return want === bits.slice(-cs);
}

export function readHidden(prompt: string, io: Io): Promise<string> {
  return new Promise((resolve, reject) => {
    let s = "";
    io.stdout.write(prompt);
    io.stdin.setRawMode(true); io.stdin.resume();
    const done = (fn: () => void) => { io.stdin.setRawMode(false); io.stdin.pause(); io.stdin.off("data", onData); io.stdout.write("\n"); fn(); };
    const onData = (d: Buffer) => {
      for (const ch of d.toString("utf8")) {
        if (ch === "\r" || ch === "\n") return done(() => resolve(s));
        if (ch === "\u0003") return done(() => reject(new Error("Cancelled.")));
        if (ch === "\u007f" || ch === "\b") s = s.slice(0, -1); else s += ch;
      }
    };
    io.stdin.on("data", onData);
  });
}

export async function seedLogin(node: NodeClient, io: Io, log: (s: string) => void): Promise<AppKey> {
  requireTty(io);
  log([
    "A seed phrase controls your whole Farcaster account. Use a test account.",
    "fcx keeps it in memory only, uses it to sign two messages, and forgets it.",
    "Safer: fcx login --wallet",
  ].join("\n"));
  const phrase = normalizeMnemonic(await readHidden("Seed phrase (hidden): ", io));
  if (!validMnemonic(phrase)) throw new Error("That is not a valid 12/24-word seed phrase.");
  const account = mnemonicToAccount(phrase); // m/44'/60'/0'/0/0, the path the Farcaster app uses
  log(`Address ${account.address}.`);
  return addAppKey(node, new ViemLocalEip712Signer(account), account.address, { log });
}
```

- [ ] **Step 6: Run tests to verify they pass**

Run: `cd cli && npx vitest run test/client/login.test.ts`
Expected: PASS (9 tests).

- [ ] **Step 7: Commit**

```bash
git add cli/src/client/login.ts cli/src/client/seed.ts cli/src/client/writer.ts cli/test/client/login.test.ts
git commit -m "feat(client): gasless KEY_ADD login from a seed phrase, self-revoke logout"
```

---

### Task 6: Wallet login through a localhost bridge

**Files:**
- Create: `cli/src/client/wallet.ts`, `cli/src/client/wallet-page.ts`, `cli/test/client/wallet.test.ts`

**Interfaces:**
- Consumes: `addAppKey` (Task 5), `requireTty` (Task 5), `NodeClient` (Task 1).
- Produces:
  - `interface RpcRequest { method: string; params?: unknown[] }`
  - `startBridge(o?: { token?: string }): Promise<{ url: string; port: number; request(r: RpcRequest): Promise<unknown>; close(): void }>`
  - `explain(r: RpcRequest): string`
  - `walletLogin(node, io, log, o?: { open?: (url: string) => void; bridge?: Awaited<ReturnType<typeof startBridge>> }): Promise<AppKey>`
  - `pageHtml(token: string): string`

How it works: the CLI starts an HTTP server on `127.0.0.1:<random>`. The user opens `http://127.0.0.1:<port>/<token>`. The page connects to `window.ethereum`, then long-polls `GET /<token>/next` for the next wallet request, runs it with `window.ethereum.request(...)`, and posts the answer to `POST /<token>/result`. On the CLI side, viem's `custom` transport sends `eth_signTypedData_v4` into `bridge.request`, so `ViemWalletEip712Signer` works unchanged.

- [ ] **Step 1: Write the failing tests**

`cli/test/client/wallet.test.ts`:

```ts
import { describe, it, expect, afterEach } from "vitest";
import { startBridge, explain } from "../../src/client/wallet.js";

let close = () => {};
afterEach(() => close());

// Plays the browser page: take the next request, answer it.
async function browserAnswers(url: string, answer: (r: { id: number; method: string }) => unknown) {
  const r = await fetch(`${url}/next`);
  const req = await r.json();
  const a = answer(req);
  await fetch(`${url}/result`, { method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify(a instanceof Error ? { id: req.id, error: { code: 4001, message: a.message } } : { id: req.id, result: a }) });
}

describe("bridge", () => {
  it("serves the page only on the token path", async () => {
    const b = await startBridge({ token: "t0k" }); close = b.close;
    expect(b.url).toBe(`http://127.0.0.1:${b.port}/t0k`);
    expect((await fetch(b.url)).status).toBe(200);
    expect(await (await fetch(b.url)).text()).toContain("window.ethereum");
    expect((await fetch(`http://127.0.0.1:${b.port}/wrong`)).status).toBe(404);
  });
  it("refuses a foreign Host header (DNS rebinding)", async () => {
    const b = await startBridge({ token: "t0k" }); close = b.close;
    const { request } = await import("node:http");
    const status = await new Promise<number>((res) => request({ host: "127.0.0.1", port: b.port, path: "/t0k", headers: { host: "evil.example" } },
      (r) => res(r.statusCode!)).end());
    expect(status).toBe(403);
  });
  it("round-trips a wallet request", async () => {
    const b = await startBridge({ token: "t0k" }); close = b.close;
    const p = b.request({ method: "eth_requestAccounts" });
    await browserAnswers(b.url, () => ["0xabc"]);
    expect(await p).toEqual(["0xabc"]);
  });
  it("turns a wallet rejection into an error", async () => {
    const b = await startBridge({ token: "t0k" }); close = b.close;
    const p = b.request({ method: "eth_signTypedData_v4", params: ["0xabc", "{}"] });
    await browserAnswers(b.url, () => new Error("User rejected the request."));
    await expect(p).rejects.toThrow(/rejected/);
  });
  it("needs a JSON POST for results", async () => {
    const b = await startBridge({ token: "t0k" }); close = b.close;
    const r = await fetch(`${b.url}/result`, { method: "POST", body: "id=1" });
    expect(r.status).toBe(415);
  });
});

describe("explain", () => {
  const td = (primaryType: string, message: object) => ({ method: "eth_signTypedData_v4",
    params: ["0xabc", JSON.stringify({ primaryType, domain: { name: "Farcaster KeyAdd", chainId: 1 }, message })] });
  it("says what the KeyAdd signature does", () => {
    expect(explain(td("KeyAdd", { fid: "42", key: "0x1234567890abcdef", ttl: 2592000 })))
      .toBe("Add app key 0x12345678… to FID 42. It can cast, like, recast and follow. It expires 30 days after its last use. No gas, no transaction.");
  });
  it("says what the SignedKeyRequest signature does", () => {
    expect(explain(td("SignedKeyRequest", { requestFid: "42", key: "0x1234567890abcdef" })))
      .toBe("Name FID 42 (you) as the app that asked for key 0x12345678…. No gas, no transaction.");
  });
  it("covers account and chain requests", () => {
    expect(explain({ method: "eth_requestAccounts" })).toBe("Share your address with fcx.");
    expect(explain({ method: "wallet_switchEthereumChain" })).toBe("Switch to Ethereum mainnet. The signatures name chain 1; nothing is sent on-chain.");
  });
});
```

- [ ] **Step 2: Run them to verify they fail**

Run: `cd cli && npx vitest run test/client/wallet.test.ts`
Expected: FAIL — cannot find `wallet.js`.

- [ ] **Step 3: Implement `wallet-page.ts`**

```ts
// The one page the bridge serves. No external scripts: it only talks to window.ethereum and to fcx on 127.0.0.1.
export function pageHtml(token: string): string {
  return `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>fcx login</title><style>
body{font:16px/1.5 system-ui,sans-serif;max-width:34rem;margin:3rem auto;padding:0 1rem;color:#222;background:#fafafa}
@media (prefers-color-scheme:dark){body{color:#eee;background:#141414}}
#log p{margin:.4rem 0}.now{font-weight:600}button{font:inherit;padding:.6rem 1rem;border-radius:.5rem;border:1px solid #888;cursor:pointer}
</style></head><body>
<h1>fcx login</h1>
<p>Your wallet will ask for two signatures. Each one is explained below before it appears. No gas, no transaction.</p>
<button id="go">Connect wallet</button><div id="log"></div>
<script>
const base = "/${token}";
const log = (t, now) => { const p = document.createElement("p"); p.textContent = t; if (now) p.className = "now"; document.getElementById("log").append(p); };
async function loop() {
  for (;;) {
    const r = await fetch(base + "/next");
    if (r.status === 204) continue;
    if (r.status === 410) { log("Done. You can close this tab.", true); return; }
    const q = await r.json();
    log(q.explain, true);
    let body;
    try { body = { id: q.id, result: await window.ethereum.request({ method: q.method, params: q.params }) }; }
    catch (e) { body = { id: q.id, error: { code: e.code, message: e.message } }; }
    await fetch(base + "/result", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
  }
}
document.getElementById("go").onclick = () => {
  if (!window.ethereum) { log("No browser wallet found. Install MetaMask or Rabby, or use: fcx login", true); return; }
  document.getElementById("go").disabled = true; loop();
};
</script></body></html>`;
}
```

- [ ] **Step 4: Implement `wallet.ts`**

```ts
// Wallet login. A local page hands each signing request to your browser wallet.
// The wallet holds the custody key; fcx never sees it.
import { createServer, type IncomingMessage } from "node:http";
import { randomBytes } from "node:crypto";
import { createWalletClient, custom, getAddress } from "viem";
import { ViemWalletEip712Signer } from "@farcaster/core";
import type { NodeClient, Hex } from "./node-client.js";
import { addAppKey } from "./login.js";
import { requireTty } from "./seed.js";
import type { AppKey } from "./keystore.js";
import { pageHtml } from "./wallet-page.js";

export interface RpcRequest { method: string; params?: unknown[] }
const short = (k: string) => `${String(k).slice(0, 10)}…`;

export function explain(r: RpcRequest): string {
  if (r.method === "eth_requestAccounts") return "Share your address with fcx.";
  if (r.method === "wallet_switchEthereumChain") return "Switch to Ethereum mainnet. The signatures name chain 1; nothing is sent on-chain.";
  if (r.method === "eth_signTypedData_v4") {
    const td = JSON.parse(String(r.params?.[1] ?? "{}")), m = td.message ?? {};
    if (td.primaryType === "KeyAdd")
      return `Add app key ${short(m.key)} to FID ${m.fid}. It can cast, like, recast and follow. It expires ${Math.round(m.ttl / 86400)} days after its last use. No gas, no transaction.`;
    if (td.primaryType === "SignedKeyRequest") return `Name FID ${m.requestFid} (you) as the app that asked for key ${short(m.key)}. No gas, no transaction.`;
  }
  return `Wallet request: ${r.method}`;
}

const readBody = (req: IncomingMessage) => new Promise<string>((res) => { let s = ""; req.on("data", (d) => (s += d)); req.on("end", () => res(s)); });

export async function startBridge(o: { token?: string } = {}) {
  const token = o.token ?? randomBytes(16).toString("hex");
  const queue: { id: number; method: string; params?: unknown[]; explain: string }[] = [];
  const pending = new Map<number, { resolve(v: unknown): void; reject(e: Error): void }>();
  const waiters: (() => void)[] = [];
  let nextId = 1, finished = false;

  const server = createServer(async (req, res) => {
    const port = (server.address() as { port: number }).port;
    if (req.headers.host !== `127.0.0.1:${port}`) { res.writeHead(403).end(); return; } // blocks DNS rebinding
    const path = req.url ?? "";
    if (req.method === "GET" && path === `/${token}`) { res.writeHead(200, { "content-type": "text/html; charset=utf-8" }).end(pageHtml(token)); return; }
    if (req.method === "GET" && path === `/${token}/next`) {
      if (!queue.length && !finished) await new Promise<void>((r) => { waiters.push(r); setTimeout(r, 25_000); });
      if (finished && !queue.length) { res.writeHead(410).end(); return; }
      const q = queue.shift();
      if (!q) { res.writeHead(204).end(); return; }
      res.writeHead(200, { "content-type": "application/json" }).end(JSON.stringify(q)); return;
    }
    if (req.method === "POST" && path === `/${token}/result`) {
      // JSON only: a cross-site form post cannot send this content type without a CORS preflight, which we never answer.
      if (req.headers["content-type"] !== "application/json") { res.writeHead(415).end(); return; }
      const a = JSON.parse(await readBody(req)), p = pending.get(a.id);
      if (p) { pending.delete(a.id); a.error ? p.reject(Object.assign(new Error(a.error.message ?? "wallet error"), { code: a.error.code })) : p.resolve(a.result); }
      res.writeHead(204).end(); return;
    }
    res.writeHead(404).end();
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  const port = (server.address() as { port: number }).port;

  return {
    url: `http://127.0.0.1:${port}/${token}`, port,
    request(r: RpcRequest): Promise<unknown> {
      const id = nextId++;
      queue.push({ id, method: r.method, params: r.params, explain: explain(r) });
      waiters.splice(0).forEach((w) => w());
      return new Promise((resolve, reject) => pending.set(id, { resolve, reject }));
    },
    close() { finished = true; waiters.splice(0).forEach((w) => w()); setTimeout(() => server.close(), 1000).unref(); },
  };
}

export async function walletLogin(node: NodeClient, io: { stdin: NodeJS.ReadStream; stdout: NodeJS.WriteStream }, log: (s: string) => void,
  o: { open?: (url: string) => void; bridge?: Awaited<ReturnType<typeof startBridge>> } = {}): Promise<AppKey> {
  requireTty(io);
  const bridge = o.bridge ?? await startBridge();
  try {
    log(`Open this page in the browser that has your wallet:\n  ${bridge.url}`);
    o.open?.(bridge.url);
    const [addr] = (await bridge.request({ method: "eth_requestAccounts" })) as string[];
    const address = getAddress(addr) as Hex;
    log(`Wallet ${address}.`);
    // MetaMask refuses typed data whose chainId differs from the active chain. These messages name chain 1.
    await bridge.request({ method: "wallet_switchEthereumChain", params: [{ chainId: "0x1" }] });
    const client = createWalletClient({ account: address, transport: custom({ request: (r) => bridge.request(r) }) });
    const k = await addAppKey(node, new ViemWalletEip712Signer(client), address, { log })
      .catch((e: Error) => { throw /is not the custody address/.test(e.message)
        ? new Error(`This wallet (${address}) is not the custody address of any FID.`) : e; });
    return k;
  } catch (e) {
    if ((e as { code?: number }).code === 4001) throw new Error("You rejected the request in your wallet. Nothing was added.");
    throw e;
  } finally { bridge.close(); }
}
```

- [ ] **Step 5: Add a full wallet-login test**

Append to `cli/test/client/wallet.test.ts` — the "browser" here signs with a local viem account, exactly as a wallet would:

```ts
import { mkdtempSync } from "node:fs"; import { tmpdir } from "node:os"; import { join } from "node:path";
import { mnemonicToAccount } from "viem/accounts";
import { NodeClient } from "../../src/client/node-client.js";
import { walletLogin } from "../../src/client/wallet.js";
import { loadKey } from "../../src/client/keystore.js";
import { fakeNode } from "./fake-node.js";

const acct = mnemonicToAccount("test test test test test test test test test test test junk");
const tty = { stdin: { isTTY: true }, stdout: { isTTY: true } } as unknown as { stdin: NodeJS.ReadStream; stdout: NodeJS.WriteStream };

async function fakeWallet(url: string, o: { reject?: string } = {}) {
  for (let i = 0; i < 4; i++) {
    const r = await fetch(`${url}/next`); if (r.status !== 200) return;
    const q = await r.json(); let body;
    if (q.method === "eth_requestAccounts") body = { id: q.id, result: [acct.address] };
    else if (q.method === "wallet_switchEthereumChain") body = { id: q.id, result: null };
    else {
      const td = JSON.parse(q.params[1]);
      if (td.primaryType === o.reject) body = { id: q.id, error: { code: 4001, message: "User rejected the request." } };
      else { delete td.types.EIP712Domain; body = { id: q.id, result: await acct.signTypedData(td) }; }
    }
    await fetch(`${url}/result`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
  }
}

describe("walletLogin", () => {
  it("adds the key with wallet signatures", async () => {
    process.env.FCX_HOME = mkdtempSync(join(tmpdir(), "fcx-"));
    const fake = fakeNode(); fake.store.addAccount({ fid: 42, custody: acct.address });
    const b = await startBridge(); close = b.close;
    const p = walletLogin(new NodeClient("http://node", fake.fetch), tty, () => {}, { bridge: b });
    await fakeWallet(b.url);
    expect((await p).fid).toBe(42);
    expect(loadKey()!.fid).toBe(42);
  });
  it("rejecting in the wallet adds nothing", async () => {
    process.env.FCX_HOME = mkdtempSync(join(tmpdir(), "fcx-"));
    const fake = fakeNode(); fake.store.addAccount({ fid: 42, custody: acct.address });
    const b = await startBridge(); close = b.close;
    const p = walletLogin(new NodeClient("http://node", fake.fetch), tty, () => {}, { bridge: b });
    void fakeWallet(b.url, { reject: "KeyAdd" });
    await expect(p).rejects.toThrow("You rejected the request in your wallet. Nothing was added.");
    expect(loadKey()).toBeNull();
    expect(fake.store.keys).toHaveLength(0);
  });
  it("a wallet that is not a custody address", async () => {
    process.env.FCX_HOME = mkdtempSync(join(tmpdir(), "fcx-"));
    const fake = fakeNode();
    const b = await startBridge(); close = b.close;
    const p = walletLogin(new NodeClient("http://node", fake.fetch), tty, () => {}, { bridge: b });
    void fakeWallet(b.url);
    await expect(p).rejects.toThrow(`This wallet (${acct.address}) is not the custody address of any FID.`);
  });
});
```

Note: in the reject case, `makeKeyAddBody` wraps the wallet error in a `HubError`, so `addAppKey`'s `/reject|denied|4001/` check produces the same message. If the `code` survives instead, the `catch` in `walletLogin` produces it. Both paths are covered by this one test.

- [ ] **Step 6: Run tests to verify they pass**

Run: `cd cli && npx vitest run test/client/wallet.test.ts`
Expected: PASS (11 tests).

- [ ] **Step 7: Commit**

```bash
git add cli/src/client/wallet.ts cli/src/client/wallet-page.ts cli/test/client/wallet.test.ts
git commit -m "feat(client): wallet login through a localhost bridge page"
```

---

### Task 7: CLI commands

**Files:**
- Modify: `cli/src/cli.ts`
- Create: `cli/src/client/commands.ts`, `cli/test/client/commands.test.ts`

**Interfaces:**
- Consumes: everything above; `COMMANDS` and `main` in `cli.ts`.
- Produces: `CLIENT_COMMANDS: Record<string, { summary: string; run(argv: string[], ctx?: Ctx): Promise<void> }>` merged into `COMMANDS`; `interface Ctx { open(): Promise<{ node: NodeClient; close(): void }>; out(s: string): void; io: { stdin: NodeJS.ReadStream; stdout: NodeJS.WriteStream }; now(): number; write?: WriteOpts }`.

Commands and output (human / `--json`):

| Command | Human output | `--json` |
|---|---|---|
| `login [--wallet]` | `Logged in as @alice (FID 42). App key 0x1234abcd… added. Try: fcx feed` | — |
| `logout` | `App key removed. Logged out.` / `Not logged in.` | — |
| `whoami` | `@alice (FID 42), app key 0x1234abcd…, added 2026-10-20` | `{fid,username,publicKey,addedAt}` |
| `feed [--limit 30] [--only-client <fid>] [--exclude-client <fid>]` | `formatFeed` | `FeedItem[]` |
| `clients [--limit 100]` | `formatClients` | rows |
| `cast "<text>" [--reply-to <ref>] [--channel <url>]` | `Cast sent: 42/0x…(full hash)` | `{hash,tries}` |
| `follow\|unfollow <user>` | `Following @bob.` / `Unfollowed @bob.` | `{hash,tries}` |
| `like\|unlike\|recast\|unrecast <ref>` | `Liked 0x1a2b3c4d.` / `Unliked …` / `Recast …` / `Removed recast …` | `{hash,tries}` |
| `user <user>` | `@bob (FID 2)\n<bio>\nfollowing: 120` | `{fid,username,bio,following}` |

- [ ] **Step 1: Write the failing tests**

`cli/test/client/commands.test.ts`:

```ts
import { describe, it, expect, beforeEach } from "vitest";
import { mkdtempSync } from "node:fs"; import { tmpdir } from "node:os"; import { join } from "node:path";
import { bytesToHexString } from "@farcaster/core";
import { NodeClient } from "../../src/client/node-client.js";
import { CLIENT_COMMANDS, type Ctx } from "../../src/client/commands.js";
import { newAppKey, saveKey } from "../../src/client/keystore.js";
import { COMMANDS } from "../../src/cli.js";
import { fakeNode } from "./fake-node.js";

let fake: ReturnType<typeof fakeNode>, out: string[], ctx: Ctx;
const notTty = { stdin: { isTTY: false }, stdout: { isTTY: false } } as unknown as Ctx["io"];
beforeEach(async () => {
  process.env.FCX_HOME = mkdtempSync(join(tmpdir(), "fcx-"));
  fake = fakeNode(); out = [];
  fake.store.addAccount({ fid: 42, custody: "0x00000000000000000000000000000000000000a1", username: "alice" });
  fake.store.addAccount({ fid: 2, custody: "0x00000000000000000000000000000000000000b2", username: "bob" });
  ctx = { open: async () => ({ node: new NodeClient("http://node", fake.fetch), close() {} }), out: (s) => out.push(s),
    io: notTty, now: () => 1609459200 + 100_000, write: { waitMs: 30, pollMs: 10 } };
  const n = await newAppKey();
  saveKey({ fid: 42, privateKey: bytesToHexString(n.privateKey)._unsafeUnwrap(), publicKey: n.publicKey, requestFid: 42, addedAt: 1 });
  fake.store.addKey({ fid: 42, key: n.publicKey, requestFid: 42, source: "SIGNER_SOURCE_OFFCHAIN" });
});

describe("client commands", () => {
  it("are all registered in fcx", () => {
    for (const c of ["login", "logout", "whoami", "feed", "clients", "cast", "follow", "unfollow", "like", "unlike", "recast", "unrecast", "user"])
      expect(COMMANDS[c], c).toBeDefined();
  });
  it("login refuses without a TTY in both modes", async () => {
    await expect(CLIENT_COMMANDS.login.run([], ctx)).rejects.toThrow("Login needs a human at the keyboard");
    await expect(CLIENT_COMMANDS.login.run(["--wallet"], ctx)).rejects.toThrow("Login needs a human at the keyboard");
  });
  it("cast, then like it by short hash from the feed", async () => {
    await CLIENT_COMMANDS.cast.run(["gm from my own node"], ctx);
    expect(out[0]).toMatch(/^Cast sent: 42\/0x[0-9a-f]{40}$/);
    await CLIENT_COMMANDS.feed.run([], ctx);
    const short = out[1].match(/0x[0-9a-f]{8}/)![0];
    await CLIENT_COMMANDS.like.run([short], ctx);
    expect(out[2]).toBe(`Liked ${short}.`);
    expect(fake.store.reactions).toHaveLength(1);
  });
  it("follow @bob and print json", async () => {
    await CLIENT_COMMANDS.follow.run(["@bob", "--json"], ctx);
    expect(JSON.parse(out[0]).tries).toBe(1);
    await CLIENT_COMMANDS.whoami.run(["--json"], ctx);
    expect(JSON.parse(out[1])).toMatchObject({ fid: 42, username: "alice" });
  });
  it("feed --only-client needs a number", async () => {
    await expect(CLIENT_COMMANDS.feed.run(["--only-client", "abc"], ctx)).rejects.toThrow("--only-client needs an app FID, e.g. 9152.");
  });
});
```

- [ ] **Step 2: Run them to verify they fail**

Run: `cd cli && npx vitest run test/client/commands.test.ts`
Expected: FAIL — cannot find `commands.js`.

- [ ] **Step 3: Implement `commands.ts`**

```ts
import { parseArgs } from "node:util";
import { spawn } from "node:child_process";
import type { NodeClient } from "./node-client.js";
import { openNode } from "./connect.js";
import { requireKey, loadKey } from "./keystore.js";
import { castWrite, reactionWrite, followWrite, type Write } from "./messages.js";
import { submitAndConfirm, type WriteOpts } from "./writer.js";
import { buildFeed, countClients } from "./feed.js";
import { formatFeed, formatClients } from "./format.js";
import { Names, parseRef } from "./names.js";
import { logout } from "./login.js";
import { seedLogin } from "./seed.js";
import { walletLogin } from "./wallet.js";

export interface Ctx {
  open(): Promise<{ node: NodeClient; close(): void }>; out(s: string): void;
  io: { stdin: NodeJS.ReadStream; stdout: NodeJS.WriteStream }; now(): number; write?: WriteOpts;
}
const defaultCtx = (): Ctx => ({ open: () => openNode(), out: (s) => console.log(s), io: { stdin: process.stdin, stdout: process.stdout },
  now: () => Math.floor(Date.now() / 1000) });
const openBrowser = (url: string) => {
  const cmd = process.platform === "darwin" ? "open" : process.platform === "win32" ? "explorer" : "xdg-open";
  spawn(cmd, [url], { stdio: "ignore", detached: true }).on("error", () => {}).unref();
};

async function withNode<T>(ctx: Ctx, fn: (node: NodeClient) => Promise<T>): Promise<T> {
  const c = await ctx.open();
  try { return await fn(c.node); } finally { c.close(); }
}
const fidArg = (v: string | undefined, flag: string) => {
  if (v === undefined) return undefined;
  if (!/^\d+$/.test(v)) throw new Error(`${flag} needs an app FID, e.g. 9152.`);
  return Number(v);
};
function write(argv: string[], ctx: Ctx, make: (rest: string[], node: NodeClient) => Promise<{ w: Write; done: string }>) {
  const { values, positionals } = parseArgs({ args: argv, allowPositionals: true, options: { json: { type: "boolean", default: false } } });
  return withNode(ctx, async (node) => {
    const { w, done } = await make(positionals, node);
    const r = await submitAndConfirm(node, w, ctx.write);
    ctx.out(values.json ? JSON.stringify(r) : done.replace("{hash}", r.hash));
  });
}
const need = (v: string | undefined, usage: string) => { if (!v) throw new Error(`Usage: ${usage}`); return v; };

type Cmd = { summary: string; run(argv: string[], ctx?: Ctx): Promise<void> };
const react = (kind: "like" | "recast", remove: boolean, done: string): Cmd => ({
  summary: `${remove ? "Undo a " + kind : kind[0].toUpperCase() + kind.slice(1) + " a cast"}: <hash>`,
  run: (argv, ctx = defaultCtx()) => write(argv, ctx, async ([ref]) => {
    const r = need(ref, `fcx ${remove ? "un" : ""}${kind} <hash>`);
    return { w: await reactionWrite(requireKey(), kind, parseRef(r), remove), done: `${done} ${r}.` };
  }),
});
const link = (remove: boolean): Cmd => ({
  summary: remove ? "Unfollow: @user" : "Follow: @user",
  run: (argv, ctx = defaultCtx()) => write(argv, ctx, async ([who], node) => {
    const u = need(who, `fcx ${remove ? "un" : ""}follow @user`);
    const fid = await new Names(node).fidOf(u);
    return { w: await followWrite(requireKey(), fid, remove), done: remove ? `Unfollowed ${u}.` : `Following ${u}.` };
  }),
});

export const CLIENT_COMMANDS: Record<string, Cmd> = {
  login: {
    summary: "(2) Add an app key. --wallet (recommended) or seed phrase",
    async run(argv, ctx = defaultCtx()) {
      const { values } = parseArgs({ args: argv, options: { wallet: { type: "boolean", default: false } } });
      const log = (s: string) => ctx.out(s);
      if (!ctx.io.stdin.isTTY || !ctx.io.stdout.isTTY) { await (values.wallet ? walletLogin : seedLogin)(null as never, ctx.io, log); return; }
      await withNode(ctx, async (node) => {
        const k = values.wallet ? await walletLogin(node, ctx.io, log, { open: openBrowser }) : await seedLogin(node, ctx.io, log);
        const name = await new Names(node).username(k.fid);
        ctx.out(`Logged in as @${name} (FID ${k.fid}). App key ${k.publicKey.slice(0, 10)}… added. Try: fcx feed`);
      });
    },
  },
  logout: {
    summary: "Remove the app key from your account (no seed phrase needed)",
    run: (argv, ctx = defaultCtx()) => withNode(ctx, async (node) =>
      ctx.out((await logout(node, { write: ctx.write })) === "revoked" ? "App key removed. Logged out." : "Not logged in.")),
  },
  whoami: {
    summary: "Your FID and app key. --json",
    async run(argv, ctx = defaultCtx()) {
      const { values } = parseArgs({ args: argv, options: { json: { type: "boolean", default: false } } });
      const k = loadKey();
      if (!k) { ctx.out("Not logged in. Run: fcx login --wallet"); return; }
      await withNode(ctx, async (node) => {
        const username = await new Names(node).username(k.fid);
        const r = { fid: k.fid, username, publicKey: k.publicKey, addedAt: k.addedAt };
        ctx.out(values.json ? JSON.stringify(r)
          : `@${username} (FID ${k.fid}), app key ${k.publicKey.slice(0, 10)}…, added ${new Date(k.addedAt * 1000).toISOString().slice(0, 10)}`);
      });
    },
  },
  feed: {
    summary: "Casts from people you follow. --limit N --only-client <fid> --exclude-client <fid> --json",
    async run(argv, ctx = defaultCtx()) {
      const { values } = parseArgs({ args: argv, options: { limit: { type: "string", default: "30" }, json: { type: "boolean", default: false },
        "only-client": { type: "string" }, "exclude-client": { type: "string" } } });
      const o = { limit: Number(values.limit), onlyClient: fidArg(values["only-client"], "--only-client"),
        excludeClient: fidArg(values["exclude-client"], "--exclude-client"), now: ctx.now() };
      const me = requireKey().fid;
      await withNode(ctx, async (node) => {
        const items = await buildFeed(node, me, o);
        ctx.out(values.json ? JSON.stringify(items) : formatFeed(items, o.now).trimEnd());
      });
    },
  },
  clients: {
    summary: "Which apps posted the casts in your feed. --json",
    async run(argv, ctx = defaultCtx()) {
      const { values } = parseArgs({ args: argv, options: { limit: { type: "string", default: "100" }, json: { type: "boolean", default: false } } });
      const me = requireKey().fid;
      await withNode(ctx, async (node) => {
        const rows = countClients(await buildFeed(node, me, { limit: Number(values.limit), now: ctx.now() }));
        ctx.out(values.json ? JSON.stringify(rows) : formatClients(rows).trimEnd());
      });
    },
  },
  cast: {
    summary: "Post: \"<text>\" --reply-to <hash> --channel <url>",
    async run(argv, ctx = defaultCtx()) {
      const { values, positionals } = parseArgs({ args: argv, allowPositionals: true, options: {
        "reply-to": { type: "string" }, channel: { type: "string" }, json: { type: "boolean", default: false } } });
      const text = need(positionals[0], 'fcx cast "<text>"');
      const k = requireKey();
      await write(values.json ? ["--json"] : [], ctx, async () => ({
        w: await castWrite(k, text, { replyTo: values["reply-to"] ? parseRef(values["reply-to"]) : undefined, channel: values.channel }),
        done: `Cast sent: ${k.fid}/{hash}` }));
    },
  },
  follow: link(false), unfollow: link(true),
  like: react("like", false, "Liked"), unlike: react("like", true, "Unliked"),
  recast: react("recast", false, "Recast"), unrecast: react("recast", true, "Removed recast"),
  user: {
    summary: "Profile: @user --json",
    async run(argv, ctx = defaultCtx()) {
      const { values, positionals } = parseArgs({ args: argv, allowPositionals: true, options: { json: { type: "boolean", default: false } } });
      const who = need(positionals[0], "fcx user @user");
      await withNode(ctx, async (node) => {
        const fid = await new Names(node).fidOf(who);
        const d = await node.userData(fid), following = (await node.following(fid)).length;
        const r = { fid, username: d.USER_DATA_TYPE_USERNAME ?? `fid:${fid}`, bio: d.USER_DATA_TYPE_BIO ?? "", following };
        ctx.out(values.json ? JSON.stringify(r) : `@${r.username} (FID ${fid})\n${r.bio}\nfollowing: ${following}`.replace("\n\n", "\n"));
      });
    },
  },
};
```

Note on the login branch: when there is no TTY, call the login function with no node so it fails on `requireTty` before opening a tunnel. Both `seedLogin` and `walletLogin` call `requireTty` first, so the `null` node is never touched.

- [ ] **Step 4: Wire into `cli.ts`**

In `cli/src/cli.ts`, add the import and merge after the `COMMANDS` literal:

```ts
import { CLIENT_COMMANDS } from "./client/commands.js";
```
```ts
Object.assign(COMMANDS, CLIENT_COMMANDS);
```

Change `help()` so the command list fits the longer names: `k.padEnd(10)` stays (longest name `unrecast`/`allow-ip`/`provision` fit).

- [ ] **Step 5: Run the whole suite**

Run: `cd cli && npx vitest run && npx tsc -p . --noEmit`
Expected: all test files PASS (Plan 1's 56 + this plan's); `tsc` prints nothing.

- [ ] **Step 6: Commit**

```bash
git add cli/src/cli.ts cli/src/client/commands.ts cli/test/client/commands.test.ts
git commit -m "feat(client): fcx login/logout/whoami/feed/clients/cast/follow/like/user"
```

---

### Task 8: Package check

**Files:**
- Modify: `cli/package.json` (only if the check fails)

- [ ] **Step 1: Pack and run from the tarball**

```bash
cd cli && npm pack --silent && mkdir -p /tmp/fcx-pack && cd /tmp/fcx-pack && npm init -y >/dev/null \
  && npm install --silent ../../$(ls -t "$OLDPWD"/fcx-cli-*.tgz | head -1) && npx fcx help
```
Expected: help text lists `login`, `feed`, `cast`, `like`, etc. No `Cannot find module` errors (proves `@farcaster/core` and `viem` are runtime `dependencies`, not dev).

- [ ] **Step 2: Size check**

Run: `cd cli && npm pack --dry-run 2>&1 | tail -5`
Expected: package size under 200 kB (deps are installed, not bundled). If `test/` or `src/` appear in the file list, fix `files` in `package.json`.

- [ ] **Step 3: Commit (only if `package.json` changed)**

```bash
git add cli/package.json && git commit -m "chore(cli): package contents"
```

---

### Task 9: Live run on the dev node (run 2)

Needs the Vultr dev node from Plan 1 (`fcx provision --host root@<IP> --data-dir /mnt/fcx`, then `fcx node` until ready) and the user's **test** Farcaster account. The human runs every `fcx login`; the agent never sees the seed phrase.

**Files:**
- Create: `cli/test/fixtures/node/*.json`, `docs/runs/run-2.md`
- Modify: `cli/test/client/fake-node.ts` (only where real responses differ)

- [ ] **Step 1: Record real responses**

With the tunnel open (`ssh -i ~/.fcx/ssh_ed25519 -N -L 3381:127.0.0.1:3381 root@<IP> &`) and the test account's FID as `$FID`:

```bash
N=http://127.0.0.1:3381; D=cli/test/fixtures/node; mkdir -p $D
curl -s $N/v1/info > $D/info.json
curl -s "$N/v1/castsByFid?fid=3&reverse=true&pageSize=5" > $D/castsByFid.json
curl -s "$N/v1/linksByFid?fid=3&link_type=follow&pageSize=5" > $D/linksByFid.json
curl -s "$N/v1/userDataByFid?fid=3" > $D/userDataByFid.json
curl -s "$N/v1/userNameProofByName?name=dwr" > $D/userNameProofByName.json
curl -s "$N/v1/signersByFid?fid=$FID&requesterFids=$FID" > $D/signersByFid.json
curl -s "$N/v1/storageLimitsByFid?fid=$FID" > $D/storageLimitsByFid.json
S=$(jq -r '.messages[0].signer' $D/castsByFid.json); curl -s "$N/v1/signer?fid=3&signer=$S" > $D/signer-onchain.json
curl -s -o $D/castById-missing.json -w '%{http_code}\n' "$N/v1/castById?fid=3&hash=0x0000000000000000000000000000000000000000"
```
Expected: JSON in each file. Write down the HTTP status of the missing cast (the code assumes any 4xx means "not found").

- [ ] **Step 2: Check the assumptions against the fixtures**

| Assumption (code) | Check | If wrong |
|---|---|---|
| Missing item → 4xx (`maybe()`) | status from step 1 | change `maybe()`; ledger it |
| Onchain signer has `onChainEvent.signerEventBody.metadata` (base64) or `requestFid` | `signer-onchain.json` | change `requestFidOf()` |
| `requesterFidNonces` keys are strings | `signersByFid.json` | change `logout()` lookup |
| `userNameProofByName` returns `fid` | file | change `fidByName()` |
| `castsByFid` honors `startTimestamp` in Farcaster seconds | compare timestamps | change `buildFeed()` |

Add one test per fixture to `node-client.test.ts` that feeds the recorded file through a stub fetch and checks the parsed value. Update `fake-node.ts` wherever the real shape differs. Run `npx vitest run`; expected all PASS.

- [ ] **Step 3: End-to-end on the real network**

The human runs, in order, and pastes the output (seed phrase never pasted):

```bash
fcx login --wallet         # or: fcx login  (seed of the TEST account)
fcx whoami
fcx feed --limit 10
fcx clients
fcx feed --only-client 9152 --limit 5
fcx feed --exclude-client 9152 --limit 5
fcx cast "Posted from my own Snapchain read node with fcx"
fcx like <hash from feed>; fcx unlike <same>
fcx follow @dwr; fcx unfollow @dwr
fcx logout
fcx login                  # the other mode, to test both
```
Expected: each write prints its success line with `tries` 1–3; the cast appears in the Farcaster app within a minute; `logout` makes the key disappear from `signersByFid`.

- [ ] **Step 4: Write `docs/runs/run-2.md`**

Record: date, node IP region, each command with its real output (trimmed), tries per write, time from `cast` to visible in the Farcaster app, any assumption that was wrong and the fix commit. Real numbers only.

- [ ] **Step 5: Commit**

```bash
git add cli/test/fixtures/node docs/runs/run-2.md cli/test/client cli/src/client
git commit -m "test(client): real node fixtures and run 2 log"
```
