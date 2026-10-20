// The site's writing and structure rules, as code. Each check returns a list of problems.
const WORDS = ["seamless", "robust", "leverage", "delve", "unlock", "powerful", "journey", "dive in"];
const RECAP = /\b(in summary|to sum up|in conclusion|to recap|all in all)\b/i;
const NOT_BUT = /\bnot (an? |the )?[\w-]+( [\w-]+)?, but\b/i;          // "not a server, but a relay"
const X_NOT_Y = /\b[\w-]+, not [\w-]+\.?/i;                              // "Keys, not passwords."
const EMDASH_CHAIN = /—[^—\n]{0,40}—/;
const HYPE = /[\u{1F525}\u{1F680}\u{2728}\u{1F389}\u{1F4AF}\u{1F64C}\u{26A1}]/u;

const visible = (html) => html.replace(/<(script|style|pre|code)[\s\S]*?<\/\1>/g, " ").replace(/<[^>]+>/g, " ");

export function bannedPhrases(text) {
  const t = visible(text), out = [];
  for (const w of WORDS) if (new RegExp(`\\b${w}\\b`, "i").test(t)) out.push(`banned word "${w}"`);
  if (NOT_BUT.test(t)) out.push(`"not X, but Y" contrast: ${t.match(NOT_BUT)[0]}`);
  if (X_NOT_Y.test(t)) out.push(`"A, not B" contrast: ${t.match(X_NOT_Y)[0]}`);
  if (EMDASH_CHAIN.test(t)) out.push("em-dash chain");
  if (HYPE.test(t)) out.push("hype emoji");
  if (RECAP.test(t)) out.push(`recap phrase: ${t.match(RECAP)[0]}`);
  return out;
}

export function structure(html, file) {
  const out = [], need = (re, what) => { if (!re.test(html)) out.push(`${file}: missing ${what}`); };
  need(/<html[^>]+lang="/, "<html lang>");
  need(/<meta name="viewport" content="width=device-width/, "viewport meta");
  need(/<title>[^<]+<\/title>/, "<title>");
  need(/<main[\s>]/, "<main>");
  for (const img of html.match(/<img\b[^>]*>/g) ?? []) if (!/\balt="/.test(img)) out.push(`${file}: img without alt: ${img}`);
  for (const s of html.match(/<script\b[^>]*\bsrc="https?:[^"]*"/g) ?? []) out.push(`${file}: external script ${s}`);
  return out;
}

export function cssTokens(css) {
  const out = [];
  const outside = css.replace(/(:root|\[data-theme[^\]]*\])[^{]*\{[^}]*\}/g, "").replace(/@media[^{]*\{\s*(:root|\[data-theme[^\]]*\])[^{]*\{[^}]*\}\s*\}/g, "");
  for (const hex of outside.match(/#[0-9a-fA-F]{3,8}\b/g) ?? []) out.push(`color ${hex} outside the token blocks`);
  if (!/pre\s*\{[^}]*overflow-x:\s*auto/.test(css)) out.push("pre needs overflow-x:auto (phones)");
  return out;
}

export function links(files) {
  const ids = new Map([...files].map(([f, h]) => [f, new Set([...h.matchAll(/\bid="([^"]+)"/g)].map((m) => m[1]))]));
  const out = [];
  for (const [f, h] of files) for (const [, href] of h.matchAll(/href="([^"]*)"/g)) {
    if (!href || href.includes(":")) continue; // http:, https:, mailto: are external
    const [page, hash] = href.split("#");
    if (page && !page.endsWith(".html")) continue; // stylesheets, images, agent.md
    const target = page || f;
    if (page && !files.has(page)) { out.push(`${f}: broken link ${href}`); continue; }
    if (hash && !ids.get(target)?.has(hash)) out.push(`${f}: broken link ${href}`);
  }
  return out;
}

// Release gate: nothing ships with a value we haven't measured or a name we haven't chosen.
export function placeholders(html) {
  const out = [...html.matchAll(/class="tbd"[^>]*>([^<]*)</g)].map((m) => `unmeasured value ${m[1]}`);
  for (const m of new Set(html.match(/\{\{[A-Z]+\}\}/g) ?? [])) out.push(`unfilled ${m}`);
  return out;
}

// A claim that waits on unmerged work (data-wait="branch") may sit on a branch, never on main.
export const waiting = (html) => [...new Set([...html.matchAll(/\bdata-wait="([^"]+)"/g)].map((m) => m[1]))]
  .map((b) => `claim waits on ${b} (remove data-wait once it is merged)`);

export function motion(js) {
  const animates = /setInterval|requestAnimationFrame|\.animate\(|setTimeout\([^,]+,\s*\d{2,}/.test(js);
  return animates && !/prefers-reduced-motion/.test(js) ? ["app.js animates without a prefers-reduced-motion check"] : [];
}

// agent.md must tell an agent what to do for every status phase and every error fcx can print.
export function agentCoverage(md, phases, errors) {
  const out = [];
  for (const p of phases) if (!new RegExp(`\\|\\s*\`?${p}\`?\\s*\\|`).test(md)) out.push(`agent.md: phase ${p} not covered`);
  const table = md.split("## Errors")[1] ?? "";
  for (const e of errors) if (!table.includes(e.slice(0, 30))) out.push(`agent.md: error not covered: ${e.slice(0, 30)}`);
  return out;
}
