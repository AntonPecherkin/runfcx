import { describe, it, expect, vi } from "vitest";
import { main, COMMANDS } from "../../src/cli.js";

describe("cli", () => {
  it("help shows the three-command quickstart", async () => {
    const out: string[] = []; vi.spyOn(console, "log").mockImplementation((s) => { out.push(String(s)); });
    expect(await main(["help"])).toBe(0);
    const text = out.join("\n");
    expect(text).toMatch(/fcx provision --host root@YOUR_IP --data-dir \/mnt\/fcx\n  fcx node\n  fcx login --wallet/);
  });
  it("unknown command exits 1", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    expect(await main(["nope"])).toBe(1);
  });
  it("registers infra commands", () => {
    for (const c of ["provision", "node", "status", "extend", "allow-ip", "destroy"]) expect(COMMANDS[c]).toBeDefined();
  });
});
