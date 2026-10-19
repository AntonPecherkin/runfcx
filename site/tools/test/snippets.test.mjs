import { test } from "node:test";
import assert from "node:assert/strict";
import { extract, inject, drift } from "../snippets.mjs";

const src = `a();\n  // @snippet hello\n  const x = 1;\n  if (x) y("<b>");\n  // @end\nb();`;
test("extract dedents and stops at @end", () => {
  assert.equal(extract(src).get("hello"), 'const x = 1;\nif (x) y("<b>");');
});
test("inject escapes HTML", () => {
  const html = inject('<pre data-snippet="hello">old</pre>', extract(src));
  assert.equal(html, '<pre data-snippet="hello">const x = 1;\nif (x) y(&quot;&lt;b&gt;&quot;);</pre>');
});
test("detects drift", () => {
  const s = extract(src);
  assert.deepEqual(drift(inject('<pre data-snippet="hello"></pre>', s), s), []);
  assert.deepEqual(drift('<pre data-snippet="hello">const x = 2;</pre>', s), ["hello"]);
  assert.deepEqual(drift('<pre data-snippet="nope"></pre>', s), ["nope"]);
});
