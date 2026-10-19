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
