#!/usr/bin/env node
import { parseArgs } from "node:util";
import { realpathSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { createInterface } from "node:readline/promises";
import { provision, defaultProvisionDeps } from "./infra/provision.js";
import { startNode } from "./infra/node.js";
import { getStatus, formatHuman } from "./infra/status.js";
import { extend } from "./infra/extend.js";
import { allowIp } from "./infra/allowip.js";
import { destroy } from "./infra/destroy.js";
import { loadState, requireState } from "./infra/state.js";
import { makeSsh } from "./infra/ssh.js";
import { Hetzner } from "./infra/hetzner.js";
import { readToken } from "./infra/token.js";
import { CLIENT_COMMANDS } from "./client/commands.js";

const now = () => Math.floor(Date.now() / 1000);
const myIp = async () => (await (await fetch("https://api.ipify.org")).text()).trim();

export const COMMANDS: Record<string, { summary: string; run: (argv: string[]) => Promise<void> }> = {
  provision: {
    summary: "(0) Get a server. --ttl 8h (default) | --keep | --host user@box",
    async run(argv) {
      const { values } = parseArgs({ args: argv, options: {
        ttl: { type: "string", default: "8h" }, keep: { type: "boolean", default: false },
        name: { type: "string" }, type: { type: "string", default: "ccx23" },
        location: { type: "string", default: "fsn1" }, host: { type: "string" }, "data-dir": { type: "string" } } });
      await provision({ ttl: values.ttl!, keep: values.keep!, name: values.name, type: values.type!,
        location: values.location!, host: values.host, dataDir: values["data-dir"] }, defaultProvisionDeps());
    },
  },
  node: {
    summary: "(1) Install the read node and wait until synced. --no-wait",
    async run(argv) {
      const { values } = parseArgs({ args: argv, options: { "no-wait": { type: "boolean", default: false } } });
      const s = requireState();
      await startNode(s, makeSsh(s.sshTarget), { wait: !values["no-wait"], pollMs: 60_000,
        log: (t) => console.log(t), line: (t) => process.stdout.write(`\r\x1b[K${t}`) });
    },
  },
  status: {
    summary: "Sync progress, disk, TTL. --json",
    async run(argv) {
      const { values } = parseArgs({ args: argv, options: { json: { type: "boolean", default: false } } });
      const st = await getStatus(makeSsh(requireState().sshTarget));
      console.log(values.json ? JSON.stringify(st) : formatHuman(st));
      if (st.ssh === "blocked") process.exitCode = 1;
    },
  },
  extend: {
    summary: "Move auto-destroy to now + TTL, e.g. fcx extend 4h (0 = off)",
    async run(argv) {
      const s = requireState();
      const n = await extend(s, makeSsh(s.sshTarget), argv[0] ?? "", now());
      console.log(n.deadline === 0 ? "Auto-destroy is off. Remember: fcx destroy"
                                   : `Auto-destroy at ${new Date(n.deadline * 1000).toLocaleString()}.`);
    },
  },
  "allow-ip": {
    summary: "Allow SSH from your current IP (after a network change)",
    async run() {
      const ip = await myIp();
      await allowIp(requireState(), new Hetzner(readToken()), ip);
      console.log(`SSH allowed from ${ip}.`);
    },
  },
  destroy: {
    summary: "Delete the server and volume. Billing stops. --yes",
    async run(argv) {
      const { values } = parseArgs({ args: argv, options: { yes: { type: "boolean", default: false } } });
      const s = loadState();
      if (s && s.mode === "hetzner" && !values.yes) {
        if (!process.stdin.isTTY) throw new Error("Add --yes to confirm.");
        const rl = createInterface({ input: process.stdin, output: process.stdout });
        const a = await rl.question(`Delete run '${s.name}' and its 1.5 TB volume? [y/N] `); rl.close();
        if (!a.toLowerCase().startsWith("y")) return;
      }
      await destroy(s, () => new Hetzner(readToken()), makeSsh, { sleepMs: 5000, log: (t) => console.log(t) });
    },
  },
};

Object.assign(COMMANDS, CLIENT_COMMANDS);

function help(): void {
  console.log([
    "fcx: your own Farcaster read node and client.",
    "",
    "Quickstart:",
    "  fcx provision --ttl 8h",
    "  fcx node",
    "  fcx login --wallet",
    "",
    "Commands:",
    ...Object.entries(COMMANDS).map(([k, v]) => `  ${k.padEnd(10)} ${v.summary}`),
  ].join("\n"));
}

export async function main(argv: string[]): Promise<number> {
  const [cmd, ...rest] = argv;
  if (!cmd || cmd === "help" || cmd === "--help") { help(); return 0; }
  const c = COMMANDS[cmd];
  if (!c) { console.error(`Unknown command '${cmd}'. Run: fcx help`); return 1; }
  try { await c.run(rest); return Number(process.exitCode ?? 0); }
  catch (e) {
    console.error(process.env.FCX_DEBUG ? e : `error: ${(e as Error).message}`);
    return 1;
  }
}

const isEntry = !!process.argv[1] && realpathSync(process.argv[1]) === fileURLToPath(import.meta.url);
if (isEntry) main(process.argv.slice(2)).then((code) => process.exit(code));
