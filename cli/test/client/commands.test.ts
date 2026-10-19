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

describe("logout --forget", () => {
  it("refuses, then forgets on request", async () => {
    fake.store.keys = [];
    await expect(CLIENT_COMMANDS.logout.run([], ctx)).rejects.toThrow("fcx logout --forget");
    await CLIENT_COMMANDS.logout.run(["--forget"], ctx);
    expect(out[0]).toBe("Local app key deleted. It stays on your account until it expires, 30 days after its last use.");
  });
});
