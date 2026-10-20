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
    const p = expect(b.request({ method: "eth_signTypedData_v4", params: ["0xabc", "{}"] })).rejects.toThrow(/rejected/);
    await browserAnswers(b.url, () => new Error("User rejected the request."));
    await p;
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
    expect(explain({ method: "eth_requestAccounts" })).toBe("Share your address with runfcx.");
    expect(explain({ method: "wallet_switchEthereumChain" })).toBe("Switch to Ethereum mainnet. The signatures name chain 1; nothing is sent on-chain.");
  });
});

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
