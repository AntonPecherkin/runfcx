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

describe("logout safety", () => {
  it("keeps the key when the node does not see it", async () => {
    const k = await addAppKey(node, new ViemLocalEip712Signer(acct), acct.address, { write: fast });
    fake.store.keys = []; // e.g. a fresh node that has not synced yet
    await expect(logout(node, { write: fast })).rejects.toThrow(
      "Your node doesn't see this app key. Is it synced? Run: runfcx status. To delete the local key anyway: runfcx logout --forget");
    expect(loadKey()).toEqual(k);
    expect(await logout(node, { write: fast, forget: true })).toBe("forgotten");
    expect(loadKey()).toBeNull();
  });
});
