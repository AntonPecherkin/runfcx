import { test } from "node:test";
import assert from "node:assert/strict";
import { parseRun } from "../runs.mjs";

test("reads numbers and transcripts", () => {
  const md = "x\n```fcx-numbers\nprovider=vultr hourly_usd=0.34 peak_disk_gb=1180\n```\n```fcx-term feed\n@bob · 1m\n  gm\n```\n";
  assert.deepEqual(parseRun(md), { numbers: { provider: "vultr", hourly_usd: 0.34, peak_disk_gb: 1180 }, terminal: { feed: "@bob · 1m\n  gm" } });
});
test("a run without numbers is an error", () => {
  assert.throws(() => parseRun("nothing"), /no fcx-numbers block/);
});
