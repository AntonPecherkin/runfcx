import { describe, it, expect } from "vitest";
import { startNode } from "../../src/infra/node.js";

const st = { name: "t1", mode: "hetzner" as const, sshTarget: "root@1.2.3.4", dataDir: "/mnt/fcx", deadline: 9 };
function ssh(phases: string[], statusCode = 0) {
  const cmds: string[] = []; let i = 0;
  return { cmds, s: {
    run: async (c: string) => { cmds.push(c);
      if (c.includes("status-remote")) return { code: statusCode, stdout: statusCode ? "" : JSON.stringify({
        phase: phases[Math.min(i++, phases.length - 1)], disk_used_gb: 1, disk_free_gb: 1, ram_used_gb: 1, deadline: 0, ttl: "none" }), stderr: "" };
      return { code: 0, stdout: "", stderr: "" }; },
    copy: async () => {}, tunnel: () => ({ close() {} }) } as any };
}
const quiet = { log: () => {}, line: () => {} };

describe("node", () => {
  it("uploads, runs setup with keep=no for trial, waits until ready", async () => {
    const { s, cmds } = ssh(["downloading", "syncing", "ready"]);
    await startNode(st, s, { wait: true, pollMs: 0, ...quiet });
    expect(cmds.some((c) => c.includes("node-setup.sh no /mnt/fcx"))).toBe(true);
    expect(cmds.filter((c) => c.includes("status-remote")).length).toBe(3);
  });
  it("keep mode passes yes", async () => {
    const { s, cmds } = ssh(["ready"]);
    await startNode({ ...st, deadline: 0 }, s, { wait: true, pollMs: 0, ...quiet });
    expect(cmds.some((c) => c.includes("node-setup.sh yes"))).toBe(true);
  });
  it("disk_full stops waiting with an error", async () => {
    const { s } = ssh(["unpacking", "disk_full"]);
    await expect(startNode(st, s, { wait: true, pollMs: 0, ...quiet })).rejects.toThrow(/disk/i);
  });
  it("blocked SSH stops waiting with allow-ip hint", async () => {
    const { s } = ssh([], 255);
    await expect(startNode(st, s, { wait: true, pollMs: 0, ...quiet })).rejects.toThrow(/fcx allow-ip/);
  });
  it("one transient status failure does not abort a multi-hour wait", async () => {
    const cmds: string[] = []; let n = 0;
    const s: any = { copy: async () => {}, run: async (c: string) => { cmds.push(c);
      if (!c.includes("status-remote")) return { code: 0, stdout: "", stderr: "" };
      n++; if (n === 1) return { code: 255, stdout: "", stderr: "timeout" };
      return { code: 0, stdout: JSON.stringify({ phase: "ready", disk_used_gb: 1, disk_free_gb: 1, ram_used_gb: 1, deadline: 0, ttl: "none" }), stderr: "" }; } };
    await startNode(st, s, { wait: true, pollMs: 0, ...quiet });
    expect(n).toBe(2);
  });
  it("passes the mode so Hetzner runs insist on the volume", async () => {
    const { s, cmds } = ssh(["ready"]);
    await startNode(st, s, { wait: true, pollMs: 0, ...quiet });
    expect(cmds.some((c) => c.includes("node-setup.sh no /mnt/fcx hetzner"))).toBe(true);
  });
  it("--no-wait returns after setup", async () => {
    const { s, cmds } = ssh(["downloading"]);
    await startNode(st, s, { wait: false, pollMs: 0, ...quiet });
    expect(cmds.some((c) => c.includes("status-remote"))).toBe(false);
  });
});
