import { describe, it, expect, beforeEach } from "vitest";
import { mkdtempSync } from "node:fs"; import { tmpdir } from "node:os"; import { join } from "node:path";
import { destroy } from "../../src/infra/destroy.js";
import { saveState, loadState } from "../../src/infra/state.js";

beforeEach(() => { process.env.FCX_HOME = mkdtempSync(join(tmpdir(), "fcx-")); });
const st = { name: "t1", mode: "hetzner" as const, sshTarget: "root@1.2.3.4", dataDir: "/mnt/fcx", deadline: 9 };

describe("destroy", () => {
  it("deletes server, then volumes, then firewalls; clears state", async () => {
    const calls: string[] = [];
    let volumesLeft = [{ id: 11, name: "x" }];
    const api: any = {
      listByLabel: async (k: string) => k === "servers" ? [{ id: 7, name: "x" }] : k === "volumes" ? volumesLeft : [{ id: 22, name: "x" }],
      deleteServer: async (id: number) => { calls.push(`server ${id}`); },
      detachVolume: async () => {},
      deleteVolume: async (id: number) => { calls.push(`volume ${id}`); volumesLeft = []; },
      deleteFirewall: async (id: number) => { calls.push(`fw ${id}`); },
    };
    saveState(st); const logs: string[] = [];
    await destroy(st, () => api, () => ({}) as any, { sleepMs: 0, log: (s) => logs.push(s) });
    expect(calls).toEqual(["server 7", "volume 11", "fw 22"]);
    expect(loadState()).toBeNull();
    expect(logs.join()).toMatch(/Billing stopped/);
  });
  it("no state → nothing to destroy", async () => {
    const logs: string[] = [];
    await destroy(null, () => { throw new Error("no api"); }, () => ({}) as any, { sleepMs: 0, log: (s) => logs.push(s) });
    expect(logs.join()).toMatch(/Nothing to destroy/);
  });
  it("host mode stops the node and keeps the box", async () => {
    const ran: string[] = [];
    await destroy({ ...st, mode: "host" }, () => { throw new Error("no api"); },
      () => ({ run: async (c: string) => { ran.push(c); return { code: 0, stdout: "", stderr: "" }; } }) as any,
      { sleepMs: 0, log: () => {} });
    expect(ran[0]).toMatch(/snapchain.sh down/);
  });
});
