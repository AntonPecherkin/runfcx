import { describe, it, expect, beforeEach } from "vitest";
import { mkdtempSync } from "node:fs"; import { tmpdir } from "node:os"; import { join } from "node:path";
import { createHash } from "node:crypto";
import { provision, type ProvisionDeps } from "../../src/infra/provision.js";
import { loadState, saveState } from "../../src/infra/state.js";

beforeEach(() => { process.env.FCX_HOME = mkdtempSync(join(tmpdir(), "fcx-")); });
const PUB = "ssh-ed25519 AAA";
const KEYNAME = "fcx-" + createHash("sha256").update(PUB).digest("hex").slice(0, 8);

function deps(o: { existing?: string[]; failServer?: boolean; sshCode?: number } = {}) {
  const calls: string[] = []; const ran: { cmd: string; input?: string }[] = [];
  const live = { servers: [] as any[], volumes: [] as any[], firewalls: [] as any[] };
  const api: any = {
    listByLabel: async (k: "servers" | "volumes" | "firewalls") => (o.existing?.includes(k) ? [{ id: 1, name: "x" }] : live[k]),
    ensureSshKey: async (n: string) => { calls.push(`sshkey ${n}`); },
    createFirewall: async (n: string, _l: string, rules: any) => { calls.push(`fw ${n} ${JSON.stringify(rules)}`); live.firewalls.push({ id: 22 }); return 22; },
    createVolume: async (v: any) => { calls.push(`volume ${v.name} ${v.sizeGb} ${v.location}`); live.volumes.push({ id: 11 }); return 11; },
    createServer: async (v: any) => {
      if (o.failServer) throw new Error("server_limit");
      calls.push(`server ${v.name} ${v.type} ${v.location} vol=${v.volumeId} key=${v.sshKey} token=${v.userData.includes("SECRET123")}`);
      live.servers.push({ id: 7 }); return { id: 7, ip: "1.2.3.4" }; },
    deleteServer: async () => { calls.push("del server"); live.servers = []; },
    detachVolume: async () => {},
    deleteVolume: async () => { calls.push("del volume"); live.volumes = []; },
    deleteFirewall: async () => { calls.push("del fw"); live.firewalls = []; },
  };
  const ssh: any = { run: async (cmd: string, opt?: any) => { ran.push({ cmd, input: opt?.input }); return { code: o.sshCode ?? 0, stdout: "", stderr: "" }; }, copy: async () => {} };
  const d: ProvisionDeps = { api: () => api, ssh: () => ssh, myIp: async () => "5.6.7.8", now: () => 1000,
    publicKey: async () => PUB, readToken: () => "SECRET123", waitMs: 0, sleepMs: 0, forgetHost: async () => {}, log: () => {} };
  return { d, calls, ran };
}
const base = { ttl: "2h", name: "t1", type: "ccx23", location: "fsn1", keep: false };

describe("provision", () => {
  it("creates firewall, volume, then server with the volume attached", async () => {
    const { d, calls } = deps();
    await provision(base, d);
    expect(calls[0]).toBe(`sshkey ${KEYNAME}`);
    expect(calls[1]).toBe('fw fcx-t1 [{"direction":"in","protocol":"tcp","port":"22","source_ips":["5.6.7.8/32"]},{"direction":"in","protocol":"udp","port":"3382","source_ips":["0.0.0.0/0","::/0"]}]');
    expect(calls[2]).toBe("volume fcx-t1 2000 fsn1");
    expect(calls[3]).toBe(`server fcx-t1 ccx23 fsn1 vol=11 key=${KEYNAME} token=false`);
  });
  it("installs the token over SSH stdin, never in argv or user-data", async () => {
    const { d, ran } = deps();
    await provision(base, d);
    const push = ran.find((r) => r.input !== undefined)!;
    expect(push.input).toBe("SECRET123");
    expect(push.cmd).toMatch(/\/etc\/fcx\/token/);
    expect(ran.every((r) => !r.cmd.includes("SECRET123"))).toBe(true);
  });
  it("keep mode never sends the token", async () => {
    const { d, ran } = deps();
    await provision({ ...base, keep: true }, d);
    expect(ran.some((r) => r.input !== undefined)).toBe(false);
    expect(loadState()!.deadline).toBe(0);
  });
  it("token install fails → error says run fcx destroy, state kept", async () => {
    const { d } = deps({ sshCode: 1 });
    await expect(provision(base, d)).rejects.toThrow(/auto-destroy[\s\S]*fcx destroy/);
    expect(loadState()!.name).toBe("t1");
  });
  it("saves state with deadline = now + ttl", async () => {
    const { d } = deps();
    await provision(base, d);
    expect(loadState()).toEqual({ name: "t1", mode: "hetzner", sshTarget: "root@1.2.3.4", dataDir: "/mnt/fcx", deadline: 1000 + 7200 });
  });
  it("server create fails → rolls back volume and firewall, clears state", async () => {
    const { d, calls } = deps({ failServer: true });
    await expect(provision(base, d)).rejects.toThrow(/server_limit/);
    expect(calls).toContain("del volume"); expect(calls).toContain("del fw");
    expect(loadState()).toBeNull();
  });
  it("refuses when a local run exists", async () => {
    saveState({ name: "old", mode: "hetzner", sshTarget: "root@9.9.9.9", dataDir: "/mnt/fcx", deadline: 5 });
    const { d, calls } = deps();
    await expect(provision(base, d)).rejects.toThrow(/Run 'old' exists[\s\S]*fcx destroy/);
    expect(calls).toEqual([]);
  });
  it("refuses when any fcx resource exists in the project", async () => {
    const { d, calls } = deps({ existing: ["firewalls"] });
    await expect(provision(base, d)).rejects.toThrow(/already has fcx resources/);
    expect(calls).toEqual([]);
  });
  it("bad ttl fails before any API call", async () => {
    const { d, calls } = deps();
    await expect(provision({ ...base, ttl: "soon" }, d)).rejects.toThrow(/bad TTL/);
    expect(calls).toEqual([]);
  });
  it("rejects unsafe name, host and data dir", async () => {
    const { d } = deps();
    await expect(provision({ ...base, name: "My_Run" }, d)).rejects.toThrow(/name/);
    await expect(provision({ ...base, host: "-oProxyCommand=x" }, d)).rejects.toThrow(/host/);
    await expect(provision({ ...base, host: "u@h", dataDir: "/d; rm -rf /" }, d)).rejects.toThrow(/data-dir/);
  });
  it("--host makes no Hetzner calls and runs host-check", async () => {
    const { d, calls, ran } = deps();
    const s = await provision({ ...base, host: "ubuntu@9.9.9.9" }, d);
    expect(calls).toEqual([]); expect(s.mode).toBe("host"); expect(s.deadline).toBe(0);
    expect(ran.some((r) => r.cmd.includes("host-check.sh"))).toBe(true);
  });
});
