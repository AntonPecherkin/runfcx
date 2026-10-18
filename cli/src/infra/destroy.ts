import { clearState, type RunState } from "./state.js";
import type { Hetzner } from "./hetzner.js";
import type { Ssh } from "./ssh.js";

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function retry(f: () => Promise<void>, ms: number): Promise<void> {
  for (let i = 0; i < 6; i++) {
    try { await f(); return; } catch { await sleep(ms); }
  }
}

// State is cleared only when nothing billable is left, so a failed destroy can be re-run.
export async function destroy(s: RunState | null, api: () => Hetzner, ssh: (t: string) => Ssh,
  o: { sleepMs: number; log: (s: string) => void }): Promise<void> {
  if (!s) { o.log("Nothing to destroy."); return; }
  if (s.mode === "host") {
    const r = await ssh(s.sshTarget).run("sudo bash -c 'cd /root/snapchain && ./snapchain.sh down'");
    if (r.code !== 0) throw new Error(`Could not stop the node on ${s.sshTarget}: ${r.stderr.trim()}`);
    clearState(); o.log(`Node stopped on ${s.sshTarget}. Data kept.`); return;
  }
  const h = api();
  for (const x of await h.listByLabel("servers", s.name)) await h.deleteServer(x.id);
  // server deletion is async; the volume stays attached until the server is gone
  for (let i = 0; i < 24 && (await h.listByLabel("servers", s.name)).length > 0; i++) await sleep(o.sleepMs);
  for (const v of await h.listByLabel("volumes", s.name)) {
    await h.detachVolume(v.id).catch(() => {});
    await retry(() => h.deleteVolume(v.id), o.sleepMs);
  }
  for (const f of await h.listByLabel("firewalls", s.name)) await retry(() => h.deleteFirewall(f.id), o.sleepMs);
  const left = [...await h.listByLabel("servers", s.name), ...await h.listByLabel("volumes", s.name)];
  if (left.length > 0) throw new Error(`Server or volume still there (${left.map((x) => x.id).join(", ")}). Run fcx destroy again, or check the Hetzner console.`);
  clearState();
  o.log(`Run '${s.name}' deleted. Billing stopped.`);
}
