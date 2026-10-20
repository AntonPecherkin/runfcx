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
    await expect(openNode({ waitMs: 300 })).rejects.toThrow("Can't reach your node. Run: runfcx status");
    delete process.env.FCX_NODE;
  });
  it("needs a server when FCX_NODE is not set", async () => {
    await expect(openNode({ waitMs: 0 })).rejects.toThrow(/fcx provision/);
  });
});

describe("reaching an unready node", () => {
  it("openNode refuses a node that is still syncing", async () => {
    process.env.FCX_NODE = "http://node"; fake.knobs.blockDelay = 500;
    await expect(openNode({ waitMs: 300, fetch: fake.fetch })).rejects.toThrow("Your node is still syncing. Run: runfcx status");
    delete process.env.FCX_NODE;
  });
  it("openNode accepts a node within 10 blocks", async () => {
    process.env.FCX_NODE = "http://node"; fake.knobs.blockDelay = 10;
    expect((await openNode({ waitMs: 300, fetch: fake.fetch })).node.base).toBe("http://node");
    delete process.env.FCX_NODE;
  });
  it("a stalled request times out", async () => {
    const stall = ((_u: unknown, init?: RequestInit) => new Promise<Response>((_, rej) =>
      init!.signal!.addEventListener("abort", () => rej(init!.signal!.reason)))) as typeof fetch;
    const n = new NodeClient("http://node", stall, { timeoutMs: 50 });
    await expect(n.info()).rejects.toThrow("Your node did not answer in time. Run: runfcx status");
  });
});

describe("slow lookups", () => {
  it("fidByAddress waits longer than ordinary reads (the node scans every shard, ~22 s on mainnet)", async () => {
    const slow = (async (u: string | URL | Request, init?: RequestInit) => {
      await new Promise((r, rej) => { const t = setTimeout(r, 120); init?.signal?.addEventListener("abort", () => { clearTimeout(t); rej(init.signal!.reason); }); });
      return fake.fetch(u, init);
    }) as typeof fetch;
    const n = new NodeClient("http://node", slow, { timeoutMs: 50, slowTimeoutMs: 1000 });
    expect(await n.fidByAddress(ALICE)).toBe(10);
    await expect(n.storageUnits(10)).rejects.toThrow("did not answer in time");
  });
});

describe("requesterFids", () => {
  it("sends requesterFids[] with literal brackets (a real node ignores %5B%5D and rejects plain or repeated keys)", async () => {
    const urls: string[] = [];
    const spy = (async (u: string | URL | Request, init?: RequestInit) => { urls.push(String(u)); return fake.fetch(u, init); }) as typeof fetch;
    await new NodeClient("http://node", spy).signersByFid(10, 42);
    expect(urls[0]).toContain("requesterFids[]=42");
    expect(urls[0]).not.toContain("%5B");
  });
});

describe("error text", () => {
  it("shows a plain-text error body from the node", async () => {
    const plain = (async () => new Response("Invalid query parameters: expected a sequence", { status: 400 })) as typeof fetch;
    await expect(new NodeClient("http://node", plain).storageUnits(1)).rejects.toThrow("Invalid query parameters: expected a sequence");
  });
});
