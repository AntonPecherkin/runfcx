import { describe, it, expect, beforeEach } from "vitest";
import { mkdtempSync } from "node:fs"; import { tmpdir } from "node:os"; import { join } from "node:path";
import { extend } from "../../src/infra/extend.js";
import { allowIp } from "../../src/infra/allowip.js";
import { loadState } from "../../src/infra/state.js";

beforeEach(() => { process.env.FCX_HOME = mkdtempSync(join(tmpdir(), "fcx-")); });
const st = { name: "t1", mode: "hetzner" as const, sshTarget: "root@1.2.3.4", dataDir: "/mnt/fcx", deadline: 9 };
const sshRec = (code = 0) => { const ran: string[] = []; return { ran, s: { run: async (c: string) => { ran.push(c); return { code, stdout: "", stderr: "" }; } } as any }; };

describe("extend", () => {
  it("writes now + ttl to the server and saves state", async () => {
    const { ran, s } = sshRec();
    const n = await extend(st, s, "4h", 1000);
    expect(n.deadline).toBe(1000 + 14400);
    expect(ran[0]).toBe("echo 15400 | sudo tee /etc/fcx/deadline >/dev/null");
    expect(loadState()!.deadline).toBe(15400);
  });
  it("0 turns auto-destroy off", async () => {
    const { ran, s } = sshRec();
    expect((await extend(st, s, "0", 1000)).deadline).toBe(0);
    expect(ran[0]).toMatch(/^echo 0 /);
  });
  it("unreachable server → allow-ip hint, state unchanged", async () => {
    const { s } = sshRec(255);
    await expect(extend(st, s, "4h", 1000)).rejects.toThrow(/fcx allow-ip/);
    expect(loadState()).toBeNull();
  });
  it("host mode has no TTL", async () => {
    await expect(extend({ ...st, mode: "host" }, sshRec().s, "4h", 1000)).rejects.toThrow(/Only trial/);
  });
});

describe("allowIp", () => {
  it("replaces rules on this run's firewall with the new IP", async () => {
    const set: any[] = [];
    const api: any = { listByLabel: async () => [{ id: 22, name: "fcx-t1" }], setFirewallRules: async (id: number, r: any) => set.push([id, r]) };
    await allowIp(st, api, "9.8.7.6");
    expect(set[0][0]).toBe(22);
    expect(set[0][1][0].source_ips).toEqual(["9.8.7.6/32"]);
  });
});
