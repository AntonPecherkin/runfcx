import { describe, it, expect, beforeEach } from "vitest";
import { mkdtempSync } from "node:fs"; import { tmpdir } from "node:os"; import { join } from "node:path";
import { encodeAbiParameters } from "viem";
import { GASLESS_SIGNED_KEY_REQUEST_METADATA_ABI } from "@farcaster/core";
import { NodeClient, type Hex, type Msg } from "../../src/client/node-client.js";
import { buildFeed, countClients, FC_EPOCH } from "../../src/client/feed.js";
import { Names, parseRef, rememberCasts } from "../../src/client/names.js";
import { formatFeed } from "../../src/client/format.js";
import { fakeNode } from "./fake-node.js";

const NOW = FC_EPOCH + 400_000;
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
  s.addCast(cast(2, 1, "0xb0", 399_000)); s.addCast(cast(3, 2, "0xc0", 399_500)); s.addCast(cast(2, 3, "0xb0", 399_900));
  s.addCast(cast(3, 4, "0xc0", 1)); // older than the window
});

describe("feed", () => {
  it("merges followed casts newest first, with names and apps", async () => {
    const f = await buildFeed(node, 1, { limit: 10, now: NOW });
    expect(f.map((x) => [x.username, x.text, x.app])).toEqual([
      ["bob", "cast 3", "@farcaster"], ["carol", "cast 2", "@otherapp"], ["bob", "cast 1", "@farcaster"]]);
    expect(f[0].time).toBe(FC_EPOCH + 399_900);
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
    expect(() => parseRef("0xdeadbeef")).toThrow("Unknown cast '0xdeadbeef'. Use <fid>/<hash> or a hash from runfcx feed.");
  });
});

describe("ambiguous refs", () => {
  it("refuses a prefix that matches two casts", () => {
    rememberCasts([{ fid: 2, hash: h(0xabcdef12) }, { fid: 3, hash: h(0xabcdef13) }]);
    expect(() => parseRef("0x00000000")).toThrow("Cast prefix '0x00000000' matches more than one cast. Use more characters.");
  });
});

describe("feed on real-world data", () => {
  it("drops old casts even when the node ignores startTimestamp", async () => {
    fake.knobs.ignoreStartTimestamp = true;
    expect((await buildFeed(node, 1, { limit: 10, now: NOW })).map((x) => x.text)).toEqual(["cast 3", "cast 2", "cast 1"]);
  });
  it("looks up apps in parallel", async () => {
    fake.knobs.signerLatencyMs = 20;
    await buildFeed(node, 1, { limit: 10, now: NOW });
    expect(fake.store.maxInFlight).toBeGreaterThan(1);
  });
  it("a malformed onchain signer does not break the feed", async () => {
    fake.store.keys.find((x) => x.key === "0xc0")!.metadata = "AAAA";
    expect((await buildFeed(node, 1, { limit: 10, now: NOW })).map((x) => x.app)).toEqual(["@farcaster", "unknown app", "@farcaster"]);
  });
});

describe("deleted casts", () => {
  it("skips CAST_REMOVE messages that castsByFid returns alongside casts", async () => {
    fake.store.addCast({ hash: h(99), signer: "0xb0", data: { type: "MESSAGE_TYPE_CAST_REMOVE", fid: 2, timestamp: 399_950 } } as Msg);
    expect((await buildFeed(node, 1, { limit: 10, now: NOW })).map((x) => x.text)).toEqual(["cast 3", "cast 2", "cast 1"]);
  });
});
