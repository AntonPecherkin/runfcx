import { describe, it, expect } from "vitest";
import { getStatus, formatLine, formatHuman } from "../../src/infra/status.js";

const ok = (stdout: string) => ({ run: async () => ({ code: 0, stdout, stderr: "" }) }) as any;
const base = { shard: null, chunk: null, chunks: null, eta: null, max_block_delay: null,
  disk_used_gb: 200, disk_free_gb: 1300, ram_used_gb: 3, deadline: 0, ttl: "none" };

describe("status", () => {
  it("parses remote JSON and marks ssh ok", async () => {
    const s = await getStatus(ok(JSON.stringify({ ...base, phase: "ready" })));
    expect(s.phase).toBe("ready"); expect(s.ssh).toBe("ok");
  });
  it("ssh failure → blocked with allow-ip hint", async () => {
    const s = await getStatus({ run: async () => ({ code: 255, stdout: "", stderr: "timed out" }) } as any);
    expect(s.phase).toBe("error"); expect(s.ssh).toBe("blocked");
    expect(formatHuman(s)).toMatch(/fcx allow-ip/);
  });
  it("other remote failures are errors with detail, not 'IP changed'", async () => {
    const s = await getStatus({ run: async () => ({ code: 127, stdout: "", stderr: "bash: /opt/fcx/status-remote.sh: No such file" }) } as any);
    expect(s.ssh).toBe("ok"); expect(s.phase).toBe("error");
    expect(formatHuman(s)).toMatch(/No such file/); expect(formatHuman(s)).not.toMatch(/allow-ip/);
  });
  it("line for downloading", () => {
    expect(formatLine({ ...base, phase: "downloading", shard: 1, chunk: 120, chunks: 2671, eta: "7h6m", ssh: "ok" } as any))
      .toBe("downloading shard 1 120/2671 ETA 7h6m  disk 200G");
  });
  it("line for syncing", () => {
    expect(formatLine({ ...base, phase: "syncing", max_block_delay: 5400, ssh: "ok" } as any))
      .toBe("syncing 5400 blocks behind  disk 200G");
  });
  it("human shows TTL warning", () => {
    expect(formatHuman({ ...base, phase: "ready", ttl: "warn", ssh: "ok" } as any)).toMatch(/fcx extend/);
  });
});
