import { test } from "node:test";
import assert from "node:assert/strict";
import { bannedPhrases, structure, cssTokens, links } from "../rules.mjs";

test("banned words and contrasts", () => {
  assert.deepEqual(bannedPhrases("Run the node. It syncs in 3 hours."), []);
  assert.ok(bannedPhrases("A seamless, robust setup.").length >= 2);
  assert.ok(bannedPhrases("Let's dive in.").length === 1);
  assert.ok(bannedPhrases("It is not a server, but a relay.").length === 1);
  assert.ok(bannedPhrases("Keys, not passwords.").length === 1);
  assert.ok(bannedPhrases("fast — cheap — simple").length === 1); // em-dash chain
  assert.ok(bannedPhrases("Ready 🚀🔥").length === 1);
  assert.ok(bannedPhrases("In summary, we set up a node.").length === 1); // recap
});

test("page structure", () => {
  const good = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>fcx</title></head><body><main><img src="a.svg" alt="x"></main></body></html>`;
  assert.deepEqual(structure(good, "a.html"), []);
  assert.ok(structure(good.replace(' alt="x"', ""), "a.html").some((p) => p.includes("alt")));
  assert.ok(structure(good.replace("<title>fcx</title>", ""), "a.html").some((p) => p.includes("title")));
  assert.ok(structure(good.replace("</main>", '</main><script src="https://cdn.x/y.js"></script>'), "a.html").some((p) => p.includes("external script")));
});

test("css tokens", () => {
  const ok = `:root{--accent:#855DCD}[data-theme=dark]{--accent:#A88BE0}pre{overflow-x:auto}a{color:var(--accent)}`;
  assert.deepEqual(cssTokens(ok), []);
  assert.ok(cssTokens(ok + "h1{color:#333}").some((p) => p.includes("#333")));
  assert.ok(cssTokens(ok.replace("pre{overflow-x:auto}", "")).some((p) => p.includes("overflow-x")));
});

test("internal links", () => {
  const files = new Map([["index.html", `<a href="tutorial.html#keys">k</a><a href="#top">t</a><h1 id="top">x</h1>`],
    ["tutorial.html", `<h2 id="keys">Keys</h2>`]]);
  assert.deepEqual(links(files), []);
  files.set("index.html", `<a href="tutorial.html#nope">k</a>`);
  assert.deepEqual(links(files), ["index.html: broken link tutorial.html#nope"]);
});

test("asset hrefs are not page links", () => {
  assert.deepEqual(links(new Map([["index.html", `<link rel="stylesheet" href="assets/style.css"><a href="agent.md">a</a>`]])), []);
});

import { placeholders } from "../rules.mjs";
test("release blocks unfilled placeholders", () => {
  assert.deepEqual(placeholders(`<b>$0.34</b>`), []);
  assert.deepEqual(placeholders(`<span class="tbd">[sync time]</span> antonpecherkin.github.io/fcx-cli`), ["unmeasured value [sync time]", "unfilled antonpecherkin.github.io/fcx-cli"]);
});
