#!/usr/bin/env node
// Usage: node site/tools/check.mjs [--release]. Exit 1 on any problem.
import { readFileSync, readdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { bannedPhrases, structure, cssTokens, links } from "./rules.mjs";

const site = join(dirname(fileURLToPath(import.meta.url)), "..");
const release = process.argv.includes("--release");
const pages = new Map(readdirSync(site).filter((f) => f.endsWith(".html")).map((f) => [f, readFileSync(join(site, f), "utf8")]));
const problems = [];
for (const [f, h] of pages) {
  problems.push(...structure(h, f), ...bannedPhrases(h).map((p) => `${f}: ${p}`));
  if (release && /\{\{(OWNER|SITE)\}\}/.test(h)) problems.push(`${f}: unfilled {{OWNER}}/{{SITE}}`);
}
const agent = readFileSync(join(site, "agent.md"), "utf8");
problems.push(...bannedPhrases(agent).map((p) => `agent.md: ${p}`));
problems.push(...cssTokens(readFileSync(join(site, "assets/style.css"), "utf8")).map((p) => `style.css: ${p}`));
problems.push(...links(pages));
// later tasks add: snippet drift (Task 2), agent coverage (Task 5), motion (Task 4)
if (problems.length) { console.error(problems.join("\n")); process.exit(1); }
console.log(`site ok: ${pages.size} pages`);
