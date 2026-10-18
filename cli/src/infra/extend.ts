import { parseTtl } from "./ttl.js";
import { saveState, type RunState } from "./state.js";
import type { Ssh } from "./ssh.js";

export async function extend(s: RunState, ssh: Ssh, ttl: string, now: number): Promise<RunState> {
  if (s.mode !== "hetzner") throw new Error("Only trial runs on Hetzner have a TTL.");
  const secs = parseTtl(ttl);
  const deadline = secs === 0 ? 0 : now + secs;
  if (secs > 0) {
    const t = await ssh.run("test -x /usr/local/bin/fcx-ttl-destroy");
    if (t.code === 255) throw new Error("Could not reach the server. Run: fcx allow-ip");
    if (t.code !== 0) throw new Error("This run was created with --keep. It has no auto-destroy. Delete it with: fcx destroy");
  }
  const r = await ssh.run(`echo ${deadline} | sudo tee /etc/fcx/deadline >/dev/null`);
  if (r.code !== 0) throw new Error("Could not reach the server. Run: fcx allow-ip");
  const next = { ...s, deadline };
  saveState(next);
  return next;
}
