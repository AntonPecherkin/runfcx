import { join } from "node:path";
import { Hetzner, firewallRules } from "./hetzner.js";
import { makeSsh, ensureKey, waitForSsh, type Ssh } from "./ssh.js";
import { parseTtl } from "./ttl.js";
import { readToken } from "./token.js";
import { renderCloudInit } from "./cloudinit.js";
import { saveState, type RunState } from "./state.js";
import { remoteDir } from "./paths.js";

export interface ProvisionOpts { ttl: string; name?: string; type: string; location: string;
  keep: boolean; host?: string; dataDir?: string }
export interface ProvisionDeps { api: () => Hetzner; ssh: (target: string) => Ssh;
  myIp: () => Promise<string>; now: () => number; publicKey: () => Promise<string>;
  readToken: () => string; waitMs: number; log: (s: string) => void }

export function defaultProvisionDeps(): ProvisionDeps {
  return {
    api: () => new Hetzner(readToken()), ssh: makeSsh, now: () => Math.floor(Date.now() / 1000),
    myIp: async () => (await (await fetch("https://api.ipify.org")).text()).trim(),
    publicKey: ensureKey, readToken, waitMs: 5 * 60_000, log: (s) => console.log(s),
  };
}

const stamp = () => new Date().toISOString().slice(0, 16).replace(/[-:T]/g, "");

export async function provision(o: ProvisionOpts, d: ProvisionDeps): Promise<RunState> {
  const secs = o.keep ? 0 : parseTtl(o.ttl);
  const name = o.name ?? `trial-${stamp()}`;

  if (o.host) {
    await d.publicKey();
    const ssh = d.ssh(o.host);
    const dataDir = o.dataDir ?? "/mnt/fcx";
    await ssh.run("sudo mkdir -p /opt/fcx && sudo chown $(id -u) /opt/fcx");
    await ssh.copy([join(remoteDir(), "host-check.sh")], "/opt/fcx");
    const r = await ssh.run(`sudo bash /opt/fcx/host-check.sh ${dataDir}`);
    d.log(r.stdout.trim());
    if (r.code !== 0) throw new Error("This server does not meet the requirements above.");
    const s: RunState = { name, mode: "host", sshTarget: o.host, dataDir, deadline: 0 };
    saveState(s);
    d.log(`Using your server ${o.host}. Next: fcx node`);
    return s;
  }

  const api = d.api();
  for (const kind of ["servers", "volumes", "firewalls"] as const) {
    if ((await api.listByLabel(kind, name)).length > 0)
      throw new Error(`Run '${name}' already exists. Use it, or run: fcx destroy`);
  }
  const deadline = secs === 0 ? 0 : d.now() + secs;
  const userData = renderCloudInit({ name, deadline, token: d.readToken(), keep: secs === 0 });

  d.log(`Creating firewall, server (${o.type}, ${o.location}) and 1.5 TB volume…`);
  await api.ensureSshKey("fcx", await d.publicKey());
  const fw = await api.createFirewall(`fcx-${name}`, name, firewallRules(await d.myIp()));
  const server = await api.createServer({ name: `fcx-${name}`, type: o.type, location: o.location,
    sshKey: "fcx", firewallId: fw, label: name, userData });
  await api.createVolume({ name: `fcx-${name}`, serverId: server.id, label: name, sizeGb: 1500 });

  const s: RunState = { name, mode: "hetzner", sshTarget: `root@${server.ip}`, dataDir: "/mnt/fcx", deadline };
  saveState(s);
  if (d.waitMs > 0) await waitForSsh(d.ssh(s.sshTarget), d.waitMs);
  d.log(`Server ready at ${server.ip}.`);
  d.log(deadline === 0 ? "No auto-destroy. You pay until you run: fcx destroy"
                       : `Auto-destroy in ${o.ttl}. Extend with: fcx extend 4h`);
  d.log("Next: fcx node");
  return s;
}
