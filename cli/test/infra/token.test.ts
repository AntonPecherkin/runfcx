import { describe, it, expect, beforeEach } from "vitest";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os"; import { join } from "node:path";
import { readToken } from "../../src/infra/token.js";

beforeEach(() => { delete process.env.HCLOUD_TOKEN; process.env.FCX_CONFIG = mkdtempSync(join(tmpdir(), "cfg-")); });

describe("token", () => {
  it("env wins", () => { process.env.HCLOUD_TOKEN = "A"; expect(readToken()).toBe("A"); });
  it("reads file, trims", () => {
    writeFileSync(join(process.env.FCX_CONFIG!, "hcloud-token"), "B\n"); expect(readToken()).toBe("B");
  });
  it("explains setup when missing", () => { expect(() => readToken()).toThrow(/new project/i); });
});
