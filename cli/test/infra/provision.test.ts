import { describe, it, expect, beforeEach } from "vitest";
import { mkdtempSync } from "node:fs"; import { tmpdir } from "node:os"; import { join } from "node:path";
import { provision, type ProvisionDeps } from "../../src/infra/provision.js";
import { loadState } from "../../src/infra/state.js";

beforeEach(() => { process.env.FCX_HOME = mkdtempSync(join(tmpdir(), "fcx-")); });

function deps(existing: string[] = []) {
  const calls: string[] = [];
  const api: any = {
    listByLabel: async (k: string) => (existing.includes(k) ? [{ id: 1, name: "x" }] : []),
    ensureSshKey: async () => { calls.push("sshkey"); },
    createFirewall: async (n: string, _l: string, rules: any) => { calls.push(`fw ${n} ${JSON.stringify(rules)}`); return 22; },
    createServer: async (o: any) => { calls.push(`server ${o.name} ${o.type} ${o.location} ${o.userData.startsWith("#cloud-config")}`); return { id: 7, ip: "1.2.3.4" }; },
    createVolume: async (o: any) => { calls.push(`volume ${o.name} ${o.sizeGb}`); return 11; },
  };
  const ssh: any = { run: async () => ({ code: 0, stdout: "", stderr: "" }), copy: async () => {} };
  const d: ProvisionDeps = { api: () => api, ssh: () => ssh, myIp: async () => "5.6.7.8", now: () => 1000,
    publicKey: async () => "ssh-ed25519 AAA", readToken: () => "SECRET123", waitMs: 0, log: () => {} };
  return { d, calls };
}

describe("provision", () => {
  it("creates firewall, server, volume in order with locked-down rules", async () => {
    const { d, calls } = deps();
    await provision({ ttl: "2h", name: "t1", type: "ccx23", location: "fsn1", keep: false }, d);
    expect(calls[0]).toBe("sshkey");
    expect(calls[1]).toBe('fw fcx-t1 [{"direction":"in","protocol":"tcp","port":"22","source_ips":["5.6.7.8/32"]},{"direction":"in","protocol":"udp","port":"3382","source_ips":["0.0.0.0/0","::/0"]}]');
    expect(calls[2]).toBe("server fcx-t1 ccx23 fsn1 true");
    expect(calls[3]).toBe("volume fcx-t1 1500");
  });
  it("saves state with deadline = now + ttl", async () => {
    const { d } = deps();
    await provision({ ttl: "2h", name: "t1", type: "ccx23", location: "fsn1", keep: false }, d);
    expect(loadState()).toEqual({ name: "t1", mode: "hetzner", sshTarget: "root@1.2.3.4", dataDir: "/mnt/fcx", deadline: 1000 + 7200 });
  });
  it("keep → deadline 0", async () => {
    const { d } = deps();
    await provision({ ttl: "8h", name: "t1", type: "ccx23", location: "fsn1", keep: true }, d);
    expect(loadState()!.deadline).toBe(0);
  });
  it("refuses when any labelled resource exists", async () => {
    const { d, calls } = deps(["firewalls"]);
    await expect(provision({ ttl: "8h", name: "t1", type: "ccx23", location: "fsn1", keep: false }, d))
      .rejects.toThrow(/already exists[\s\S]*fcx destroy/);
    expect(calls).toEqual([]);
  });
  it("bad ttl fails before any API call", async () => {
    const { d, calls } = deps();
    await expect(provision({ ttl: "soon", type: "ccx23", location: "fsn1", keep: false }, d)).rejects.toThrow(/bad TTL/);
    expect(calls).toEqual([]);
  });
  it("--host makes no Hetzner calls and runs host-check", async () => {
    const { d, calls } = deps(); const ran: string[] = [];
    d.ssh = () => ({ run: async (c: string) => { ran.push(c); return { code: 0, stdout: "ok", stderr: "" }; },
      copy: async () => {}, tunnel: () => ({ close() {} }) });
    const s = await provision({ ttl: "8h", type: "ccx23", location: "fsn1", keep: false, host: "ubuntu@9.9.9.9" }, d);
    expect(calls).toEqual([]); expect(s.mode).toBe("host"); expect(s.deadline).toBe(0);
    expect(ran.some((c) => c.includes("host-check.sh"))).toBe(true);
  });
});
