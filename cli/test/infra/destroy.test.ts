import { describe, it, expect, beforeEach } from "vitest";
import { mkdtempSync } from "node:fs"; import { tmpdir } from "node:os"; import { join } from "node:path";
import { destroy } from "../../src/infra/destroy.js";
import { saveState, loadState } from "../../src/infra/state.js";

beforeEach(() => { process.env.FCX_HOME = mkdtempSync(join(tmpdir(), "fcx-")); });
const st = { name: "t1", mode: "hetzner" as const, sshTarget: "root@1.2.3.4", dataDir: "/mnt/fcx", deadline: 9 };

function api(o: { serverLingers?: number; volumeStuck?: boolean } = {}) {
  const calls: string[] = []; let serverPolls = o.serverLingers ?? 0;
  let servers = [{ id: 7, name: "x" }], volumes = [{ id: 11, name: "x" }], fws = [{ id: 22, name: "x" }];
  const a: any = {
    listByLabel: async (k: string) => {
      if (k === "servers") { if (servers.length === 0 && serverPolls-- > 0) return [{ id: 7, name: "x" }]; return servers; }
      return k === "volumes" ? volumes : fws; },
    deleteServer: async (id: number) => { calls.push(`server ${id}`); servers = []; },
    detachVolume: async () => {},
    deleteVolume: async (id: number) => { if (o.volumeStuck) throw new Error("locked"); calls.push(`volume ${id}`); volumes = []; },
    deleteFirewall: async (id: number) => { calls.push(`fw ${id}`); fws = []; },
  };
  return { a, calls };
}

describe("destroy", () => {
  it("deletes server, waits for it to go, then volume and firewall; clears state", async () => {
    const { a, calls } = api({ serverLingers: 2 });
    saveState(st); const logs: string[] = [];
    await destroy(st, () => a, () => ({}) as any, { sleepMs: 0, log: (s) => logs.push(s) });
    expect(calls).toEqual(["server 7", "volume 11", "fw 22"]);
    expect(loadState()).toBeNull();
    expect(logs.join()).toMatch(/Billing stopped/);
  });
  it("volume cannot be deleted → keeps state and fails, so the next destroy retries", async () => {
    const { a } = api({ volumeStuck: true });
    saveState(st);
    await expect(destroy(st, () => a, () => ({}) as any, { sleepMs: 0, log: () => {} })).rejects.toThrow(/still there/);
    expect(loadState()).not.toBeNull();
  });
  it("no state → nothing to destroy", async () => {
    const logs: string[] = [];
    await destroy(null, () => { throw new Error("no api"); }, () => ({}) as any, { sleepMs: 0, log: (s) => logs.push(s) });
    expect(logs.join()).toMatch(/Nothing to destroy/);
  });
  it("host mode stops the node under sudo in /root/snapchain", async () => {
    const ran: string[] = [];
    await destroy({ ...st, mode: "host" }, () => { throw new Error("no api"); },
      () => ({ run: async (c: string) => { ran.push(c); return { code: 0, stdout: "", stderr: "" }; } }) as any,
      { sleepMs: 0, log: () => {} });
    expect(ran[0]).toBe("sudo bash -c 'cd /root/snapchain && ./snapchain.sh down'");
  });
  it("host mode stop fails → state kept, error", async () => {
    saveState({ ...st, mode: "host" });
    await expect(destroy({ ...st, mode: "host" }, () => { throw new Error("no api"); },
      () => ({ run: async () => ({ code: 1, stdout: "", stderr: "x" }) }) as any, { sleepMs: 0, log: () => {} })).rejects.toThrow(/Could not stop/);
    expect(loadState()).not.toBeNull();
  });
});
