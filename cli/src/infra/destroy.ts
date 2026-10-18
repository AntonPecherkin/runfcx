import { clearState, type RunState } from "./state.js";
import type { Hetzner } from "./hetzner.js";
import type { Ssh } from "./ssh.js";

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function retry(f: () => Promise<void>, ms: number): Promise<void> {
  for (let i = 0; i < 6; i++) {
    try { await f(); return; } catch { await sleep(ms); }
  }
}

export async function destroy(s: RunState | null, api: () => Hetzner, ssh: (t: string) => Ssh,
  o: { sleepMs: number; log: (s: string) => void }): Promise<void> {
  if (!s) { o.log("Nothing to destroy."); return; }
  if (s.mode === "host") {
    await ssh(s.sshTarget).run("cd ~/snapchain && sudo ./snapchain.sh down");
    clearState(); o.log(`Node stopped on ${s.sshTarget}. Data kept.`); return;
  }
  const h = api();
  for (const x of await h.listByLabel("servers", s.name)) await h.deleteServer(x.id);
  for (const v of await h.listByLabel("volumes", s.name)) {
    await h.detachVolume(v.id).catch(() => {});
    await retry(() => h.deleteVolume(v.id), o.sleepMs);
  }
  for (const f of await h.listByLabel("firewalls", s.name)) await retry(() => h.deleteFirewall(f.id), o.sleepMs);
  const left = (await h.listByLabel("volumes", s.name)).length;
  clearState();
  o.log(left === 0 ? `Run '${s.name}' deleted. Billing stopped.`
                   : "Warning: a volume is still there. Check the Hetzner console.");
}
