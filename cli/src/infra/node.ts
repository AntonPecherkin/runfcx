import { readdirSync } from "node:fs";
import { join } from "node:path";
import { remoteDir } from "./paths.js";
import type { Ssh } from "./ssh.js";
import type { RunState } from "./state.js";
import { getStatus, formatLine } from "./status.js";

export async function startNode(s: RunState, ssh: Ssh,
  o: { wait: boolean; pollMs: number; log: (s: string) => void; line: (s: string) => void }): Promise<void> {
  await ssh.run("sudo mkdir -p /opt/fcx && sudo chown $(id -u) /opt/fcx");
  const files = readdirSync(remoteDir()).filter((f) => !f.endsWith(".tpl")).map((f) => join(remoteDir(), f));
  await ssh.copy(files, "/opt/fcx");
  const keep = s.deadline === 0 ? "yes" : "no";
  o.log("Installing the Snapchain read node (Docker + upstream snapchain.sh v0.14.3)…");
  const r = await ssh.run(`sudo bash /opt/fcx/node-setup.sh ${keep} ${s.dataDir}`, { inherit: true });
  if (r.code !== 0) throw new Error("Node install failed. See the lines above.");
  if (!o.wait) { o.log("Started. Check progress with: fcx status"); return; }

  o.log("Syncing. This takes a few hours. Safe to Ctrl-C: the node keeps going.");
  for (;;) {
    const st = await getStatus(ssh);
    if (st.ssh === "blocked") throw new Error("SSH blocked. Your IP may have changed. Run: fcx allow-ip");
    o.line(formatLine(st));
    if (st.phase === "ready") { o.log("\nNode is synced. Next: fcx login"); return; }
    if (st.phase === "disk_full") throw new Error("Disk is full. Run: fcx status");
    await new Promise((res) => setTimeout(res, o.pollMs));
  }
}
