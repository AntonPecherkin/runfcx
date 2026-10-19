// Code on the site is copied from cli/src at build time, so the tutorial can't drift from the code it explains.
import { readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const esc = (s) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

export function extract(source) {
  const out = new Map();
  for (const m of source.matchAll(/^[ \t]*\/\/ @snippet ([\w-]+)\n([\s\S]*?)^[ \t]*\/\/ @end/gm)) {
    const lines = m[2].replace(/\n$/, "").split("\n");
    const pad = Math.min(...lines.filter((l) => l.trim()).map((l) => l.match(/^ */)[0].length));
    out.set(m[1], lines.map((l) => l.slice(pad)).join("\n"));
  }
  return out;
}
export const inject = (html, s) => html.replace(/(<pre data-snippet="([\w-]+)">)[\s\S]*?(<\/pre>)/g,
  (all, open, name, close) => (s.has(name) ? open + esc(s.get(name)) + close : all));
export const drift = (html, s) => [...html.matchAll(/<pre data-snippet="([\w-]+)">([\s\S]*?)<\/pre>/g)]
  .filter(([, name, body]) => !s.has(name) || body !== esc(s.get(name))).map(([, name]) => name);

export function loadAll(srcDir) {
  const all = new Map();
  for (const f of readdirSync(srcDir)) if (f.endsWith(".ts")) for (const [k, v] of extract(readFileSync(join(srcDir, f), "utf8"))) all.set(k, v);
  return all;
}
// node site/tools/snippets.mjs  → rewrites every site/*.html in place
if (import.meta.url === `file://${process.argv[1]}`) {
  const root = new URL("../..", import.meta.url).pathname, s = loadAll(join(root, "cli/src/client"));
  for (const f of readdirSync(join(root, "site"))) if (f.endsWith(".html")) {
    const p = join(root, "site", f); writeFileSync(p, inject(readFileSync(p, "utf8"), s));
  }
}
