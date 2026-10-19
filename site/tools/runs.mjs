// docs/runs/*.md → site/data/runs.json. The site only shows numbers a run recorded.
import { readFileSync, writeFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

export function parseRun(md) {
  const n = md.match(/```fcx-numbers\n([\s\S]*?)```/);
  if (!n) throw new Error("no fcx-numbers block");
  const numbers = Object.fromEntries(n[1].trim().split(/\s+/).map((kv) => kv.split("="))
    .map(([k, v]) => [k, /^-?\d+(\.\d+)?$/.test(v) ? Number(v) : v]));
  const terminal = Object.fromEntries([...md.matchAll(/```fcx-term ([\w-]+)\n([\s\S]*?)\n```/g)].map((m) => [m[1], m[2]]));
  return { numbers, terminal };
}
if (import.meta.url === `file://${process.argv[1]}`) {
  const root = new URL("../..", import.meta.url).pathname, out = { terminal: {} };
  for (const f of readdirSync(join(root, "docs/runs")).filter((f) => f.endsWith(".md")).sort()) {
    const r = parseRun(readFileSync(join(root, "docs/runs", f), "utf8"));
    out[f.replace(".md", "").replace("-", "")] = r.numbers; Object.assign(out.terminal, r.terminal);
  }
  writeFileSync(join(root, "site/data/runs.json"), JSON.stringify(out, null, 2) + "\n");
}
