import { createServer } from "node:net";
import { NodeClient } from "./node-client.js";
import { requireState } from "../infra/state.js";
import { makeSsh } from "../infra/ssh.js";

const freePort = () => new Promise<number>((resolve) => {
  const s = createServer().listen(0, "127.0.0.1", () => { const p = (s.address() as { port: number }).port; s.close(() => resolve(p)); });
});

// Port 3381 is bound to 127.0.0.1 on the server, so we reach it through an SSH tunnel.
export async function openNode(o: { waitMs?: number; fetch?: typeof fetch } = {}): Promise<{ node: NodeClient; close(): void }> {
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
  const node = new NodeClient(base, o.fetch);
  if (waitMs === 0) return { node, close };
  const end = Date.now() + waitMs;
  while (Date.now() < end) {
    let info;
    try { info = await node.info(); } catch { await new Promise((r) => setTimeout(r, 250)); continue; }
    // A node that is still catching up answers "not found" for things that exist. Refuse early.
    const behind = Math.max(0, ...info.shardInfos.map((s) => s.blockDelay ?? 0));
    if (behind > 10) { close(); throw new Error("Your node is still syncing. Run: runfcx status"); }
    return { node, close };
  }
  close();
  throw new Error("Can't reach your node. Run: runfcx status");
}
