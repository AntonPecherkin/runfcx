import { describe, it, expect, beforeEach } from "vitest";
import { mkdtempSync, statSync } from "node:fs";
import { tmpdir } from "node:os"; import { join } from "node:path";
import { loadState, saveState, clearState, requireState } from "../../src/infra/state.js";

beforeEach(() => { process.env.FCX_HOME = mkdtempSync(join(tmpdir(), "fcx-")); });

describe("state", () => {
  it("round-trips with 0600", () => {
    const s = { name: "t1", mode: "hetzner" as const, sshTarget: "root@1.2.3.4", dataDir: "/mnt/fcx", deadline: 9 };
    saveState(s);
    expect(loadState()).toEqual(s);
    expect(statSync(join(process.env.FCX_HOME!, "state.json")).mode & 0o777).toBe(0o600);
  });
  it("clear and require", () => {
    clearState(); expect(loadState()).toBeNull();
    expect(() => requireState()).toThrow(/fcx provision/);
  });
});
