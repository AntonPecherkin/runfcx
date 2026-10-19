import { test } from "node:test";
import assert from "node:assert/strict";
import { motion } from "../rules.mjs";
test("animation must respect reduced motion", () => {
  assert.deepEqual(motion("const r = matchMedia('(prefers-reduced-motion: reduce)').matches; setInterval(step, r ? 0 : 400)"), []);
  assert.ok(motion("setInterval(step, 400)").length === 1);
});
