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
    expect(() => requireKey()).toThrow("Not logged in. Run: runfcx login --wallet");
  });
  it("cache round-trips", () => {
    expect(readCache("x")).toBeUndefined();
    writeCache("x", { a: 1 }); expect(readCache("x")).toEqual({ a: 1 });
  });
});
