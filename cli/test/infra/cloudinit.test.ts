import { describe, it, expect } from "vitest";
import { renderCloudInit } from "../../src/infra/cloudinit.js";

describe("cloud-init", () => {
  it("trial embeds name, deadline, token (base64) and TTL cron", () => {
    const y = renderCloudInit({ name: "t1", deadline: 123, token: "SECRET123", keep: false });
    expect(y).toContain('content: "t1\\n"'); expect(y).toContain('content: "123\\n"');
    expect(y).toContain(Buffer.from("SECRET123").toString("base64"));
    expect(y).toContain("fcx-ttl"); expect(y).not.toMatch(/@[A-Z_0-9]+@/);
    expect(y).not.toContain("SECRET123");
  });
  it("keep mode has no token and no TTL", () => {
    const y = renderCloudInit({ name: "t1", deadline: 0, token: "SECRET123", keep: true });
    expect(y).not.toContain("/etc/fcx/token"); expect(y).not.toContain("fcx-ttl");
    expect(y).not.toContain(Buffer.from("SECRET123").toString("base64"));
  });
});
