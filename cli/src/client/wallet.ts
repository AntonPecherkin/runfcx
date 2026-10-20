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
  if (r.method === "eth_requestAccounts") return "Share your address with runfcx.";
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
