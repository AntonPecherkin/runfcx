import { test } from "node:test";
import assert from "node:assert/strict";
import { agentCoverage } from "../rules.mjs";
const md = "## Reading status\n| phase | do |\n|---|---|\n| downloading | wait |\n## Errors\n| symptom | cause | fix |\n|---|---|---|\n| Can't reach your node. Run: fcx status | tunnel down | fcx status |\n";
test("phases and errors are covered", () => {
  assert.deepEqual(agentCoverage(md, ["downloading"], ["Can't reach your node. Run: fcx status"]), []);
  assert.deepEqual(agentCoverage(md, ["disk_full"], []), ["agent.md: phase disk_full not covered"]);
  assert.deepEqual(agentCoverage(md, [], ["Your node is still syncing. Run: fcx status"]),
    ["agent.md: error not covered: Your node is still syncing. Ru"]);
});
