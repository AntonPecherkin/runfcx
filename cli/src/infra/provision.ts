import { join } from "node:path";
import { createHash } from "node:crypto";
import { Hetzner, firewallRules } from "./hetzner.js";
import { makeSsh, ensureKey, waitForSsh, forgetHost, type Ssh } from "./ssh.js";
import { parseTtl } from "./ttl.js";
import { readToken } from "./token.js";
import { renderCloudInit } from "./cloudinit.js";
import { saveState, loadState, clearState, type RunState } from "./state.js";
import { remoteDir } from "./paths.js";
import { destroy } from "./destroy.js";

// The snapshot restore peaks near 1.6 TB (measured in run 1), so 1.5 TB volumes fail.
export const VOLUME_GB = 2000;

export interface ProvisionOpts { ttl: string; name?: string; type: string; location: string;
  keep: boolean; host?: string; dataDir?: string }
export interface ProvisionDeps { api: () => Hetzner; ssh: (target: string) => Ssh;
  myIp: () => Promise<string>; now: () => number; publicKey: () => Promise<string>;
  readToken: () => string; waitMs: number; sleepMs: number; forgetHost: (ip: string) => Promise<void>;
  log: (s: string) => void }

export function defaultProvisionDeps(): ProvisionDeps {
  return {
    api: () => new Hetzner(readToken()), ssh: makeSsh, now: () => Math.floor(Date.now() / 1000),
    myIp: async () => (await (await fetch("https://api.ipify.org")).text()).trim(),
    publicKey: ensureKey, readToken, waitMs: 5 * 60_000, sleepMs: 5000, forgetHost, log: (s) => console.log(s),
  };
}

const stamp = () => new Date().toISOString().slice(0, 16).replace(/[-:T]/g, "");

// These values end up in hostnames and remote shell commands, so only plain characters pass.
function validate(o: ProvisionOpts, name: string): void {
  if (!/^[a-z0-9-]{1,50}$/.test(name)) throw new Error(`Bad --name '${name}'. Use a-z, 0-9 and '-'.`);
  if (o.host !== undefined && !/^[A-Za-z0-9._-]+@?[A-Za-z0-9._:-]*$/.test(o.host) || o.host?.startsWith("-"))
    throw new Error(`Bad --host '${o.host}'. Use user@hostname.`);
  if (o.dataDir !== undefined && !/^\/[A-Za-z0-9._/-]+$/.test(o.dataDir))
    throw new Error(`Bad --data-dir '${o.dataDir}'. Use an absolute path with a-z, 0-9, '.', '_', '-', '/'.`);
}

export async function provision(o: ProvisionOpts, d: ProvisionDeps): Promise<RunState> {
  const secs = o.keep ? 0 : parseTtl(o.ttl);
  const name = o.name ?? `trial-${stamp()}`;
  validate(o, name);
  const existing = loadState();
  if (existing) throw new Error(`Run '${existing.name}' exists. Use it, or delete it first: fcx destroy`);

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
    if ((await api.listByLabel(kind)).length > 0)
      throw new Error("This Hetzner project already has fcx resources. Delete them in the console, or use another project.");
  }
  const deadline = secs === 0 ? 0 : d.now() + secs;
  // saved before the first create, so fcx destroy can always find what exists
  let s: RunState = { name, mode: "hetzner", sshTarget: "", dataDir: "/mnt/fcx", deadline };
  saveState(s);

  d.log(`Creating firewall, 2 TB volume and server (${o.type}, ${o.location})…`);
  let ip: string;
  try {
    const pub = await d.publicKey();
    const keyName = "fcx-" + createHash("sha256").update(pub).digest("hex").slice(0, 8);
    await api.ensureSshKey(keyName, pub);
    const fw = await api.createFirewall(`fcx-${name}`, name, firewallRules(await d.myIp()));
    const vol = await api.createVolume({ name: `fcx-${name}`, location: o.location, label: name, sizeGb: VOLUME_GB });
    const server = await api.createServer({ name: `fcx-${name}`, type: o.type, location: o.location,
      sshKey: keyName, firewallId: fw, volumeId: vol, label: name,
      userData: renderCloudInit({ name, deadline, keep: secs === 0 }) });
    ip = server.ip;
  } catch (e) {
    d.log("Create failed. Removing what was created…");
    await destroy(s, () => api, d.ssh, { sleepMs: d.sleepMs, log: d.log }).catch(() => {
      d.log(`Cleanup incomplete. Run: fcx destroy`);
    });
    throw e;
  }

  s = { ...s, sshTarget: `root@${ip}` };
  saveState(s);
  await d.forgetHost(ip);
  const ssh = d.ssh(s.sshTarget);
  if (d.waitMs > 0) await waitForSsh(ssh, d.waitMs);
  if (deadline > 0) {
    // token goes over SSH stdin: not in user-data (readable on the box), not in argv
    const r = await ssh.run("sudo sh -c 'umask 077; cat > /etc/fcx/token'", { input: d.readToken() });
    if (r.code !== 0) throw new Error("Could not install auto-destroy on the server. Delete it now: fcx destroy");
  }
  d.log(`Server ready at ${ip}.`);
  d.log(deadline === 0 ? "No auto-destroy. You pay until you run: fcx destroy"
                       : `Auto-destroy in ${o.ttl}. Extend with: fcx extend 4h`);
  d.log("Next: fcx node");
  return s;
}
