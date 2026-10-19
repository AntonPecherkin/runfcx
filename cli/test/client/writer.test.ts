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

describe("resubmit edge cases", () => {
  it("a resubmit refused after the message landed counts as success", async () => {
    fake.knobs.dropSubmits = 1; fake.knobs.reject = "nonce already used"; fake.knobs.rejectFrom = 2;
    const w = await castWrite(k, "gm");
    // The first copy lands just as we resubmit; the node then refuses the second copy.
    const racing = (async (u: string | URL | Request, init?: RequestInit) => {
      if (String(u).endsWith("/v1/submitMessage") && fake.store.submits === 1) fake.store.merge(w.message);
      return fake.fetch(u, init);
    }) as typeof fetch;
    expect((await submitAndConfirm(new NodeClient("http://node", racing), w, fast)).tries).toBe(2);
  });
  it("'already exists' on resubmit is not a rejection", async () => {
    fake.knobs.dropSubmits = 99; fake.knobs.reject = "message already exists"; fake.knobs.rejectFrom = 2;
    await expect(submitAndConfirm(node, await castWrite(k, "gm"), fast)).rejects.toThrow("Sent the cast 3 times");
  });
});
