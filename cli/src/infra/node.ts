import { readdirSync } from "node:fs";
import { join } from "node:path";
import { remoteDir } from "./paths.js";
import type { Ssh } from "./ssh.js";
import type { RunState } from "./state.js";
import { getStatus, formatLine, GENESIS, RESTORE_STOPPED } from "./status.js";

export async function startNode(s: RunState, ssh: Ssh,
  o: { wait: boolean; pollMs: number; log: (s: string) => void; line: (s: string) => void }): Promise<void> {
  await ssh.run("sudo mkdir -p /opt/fcx && sudo chown $(id -u) /opt/fcx");
  const files = readdirSync(remoteDir()).filter((f) => !f.endsWith(".tpl")).map((f) => join(remoteDir(), f));
  await ssh.copy(files, "/opt/fcx");
  const keep = s.deadline === 0 ? "yes" : "no";
  o.log("Installing the Snapchain read node (Docker + upstream snapchain.sh v0.14.3)…");
  const r = await ssh.run(`sudo bash /opt/fcx/node-setup.sh ${keep} ${s.dataDir} ${s.mode}`, { inherit: true });
  if (r.code !== 0) throw new Error("Node install failed. See the lines above.");
  if (!o.wait) { o.log("Started. Check progress with: fcx status"); return; }

  o.log("Syncing. This takes a few hours. Safe to Ctrl-C: the node keeps going.");
  let failures = 0;
  for (;;) {
    const st = await getStatus(ssh);
    if (st.phase === "error") {
      // a blip should not end a multi-hour wait; three in a row is a real problem
      if (++failures >= 3) throw new Error(st.ssh === "blocked"
        ? "SSH blocked. Your IP may have changed. Run: fcx allow-ip" : `Status check failed: ${st.detail ?? ""}`);
      await new Promise((res) => setTimeout(res, o.pollMs));
      continue;
    }
    failures = 0;
    o.line(formatLine(st));
    if (st.phase === "ready") { o.log("\nNode is synced. Next: fcx login"); return; }
    if (st.phase === "shard_from_genesis") throw new Error(GENESIS(st.stale_shard));
    if (st.phase === "restore_failed") throw new Error(RESTORE_STOPPED(st.detail));
    if (st.phase === "disk_full") throw new Error("Disk is full. Run: fcx status");
    await new Promise((res) => setTimeout(res, o.pollMs));
  }
}
