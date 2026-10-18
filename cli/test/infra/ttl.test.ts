import { describe, it, expect } from "vitest";
import { parseTtl, ttlState, ipCidr } from "../../src/infra/ttl.js";

describe("ttl", () => {
  it("parses", () => {
    expect(parseTtl("90m")).toBe(5400); expect(parseTtl("8h")).toBe(28800);
    expect(parseTtl("2d")).toBe(172800); expect(parseTtl("0")).toBe(0);
  });
  it("rejects junk", () => {
    for (const s of ["8x", "", "-1h", "soon"]) expect(() => parseTtl(s)).toThrow(/bad TTL/);
  });
  it("state", () => {
    expect(ttlState(0, 100)).toBe("none"); expect(ttlState(5000, 100)).toBe("ok");
    expect(ttlState(1900, 100)).toBe("warn"); expect(ttlState(100, 100)).toBe("expired");
  });
  it("cidr", () => {
    expect(ipCidr("1.2.3.4")).toBe("1.2.3.4/32"); expect(ipCidr("2001:db8::1")).toBe("2001:db8::1/128");
  });
});
