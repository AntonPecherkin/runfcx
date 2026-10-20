import { parseArgs } from "node:util";
import { spawn } from "node:child_process";
import type { NodeClient } from "./node-client.js";
import { openNode } from "./connect.js";
import { requireKey, loadKey } from "./keystore.js";
import { castWrite, reactionWrite, followWrite, type Write } from "./messages.js";
import { submitAndConfirm, type WriteOpts } from "./writer.js";
import { buildFeed, countClients } from "./feed.js";
import { formatFeed, formatClients } from "./format.js";
import { Names, parseRef } from "./names.js";
import { logout } from "./login.js";
import { seedLogin } from "./seed.js";
import { walletLogin } from "./wallet.js";

export interface Ctx {
  open(): Promise<{ node: NodeClient; close(): void }>; out(s: string): void;
  io: { stdin: NodeJS.ReadStream; stdout: NodeJS.WriteStream }; now(): number; write?: WriteOpts;
}
const defaultCtx = (): Ctx => ({ open: () => openNode(), out: (s) => console.log(s), io: { stdin: process.stdin, stdout: process.stdout },
  now: () => Math.floor(Date.now() / 1000) });
const openBrowser = (url: string) => {
  const cmd = process.platform === "darwin" ? "open" : process.platform === "win32" ? "explorer" : "xdg-open";
  spawn(cmd, [url], { stdio: "ignore", detached: true }).on("error", () => {}).unref();
};

async function withNode<T>(ctx: Ctx, fn: (node: NodeClient) => Promise<T>): Promise<T> {
  const c = await ctx.open();
  try { return await fn(c.node); } finally { c.close(); }
}
const fidArg = (v: string | undefined, flag: string) => {
  if (v === undefined) return undefined;
  if (!/^\d+$/.test(v)) throw new Error(`${flag} needs an app FID, e.g. 9152.`);
  return Number(v);
};
function write(argv: string[], ctx: Ctx, make: (rest: string[], node: NodeClient) => Promise<{ w: Write; done: string }>) {
  const { values, positionals } = parseArgs({ args: argv, allowPositionals: true, options: { json: { type: "boolean", default: false } } });
  return withNode(ctx, async (node) => {
    const { w, done } = await make(positionals, node);
    const r = await submitAndConfirm(node, w, ctx.write);
    ctx.out(values.json ? JSON.stringify(r) : done.replace("{hash}", r.hash));
  });
}
const need = (v: string | undefined, usage: string) => { if (!v) throw new Error(`Usage: ${usage}`); return v; };

type Cmd = { summary: string; run(argv: string[], ctx?: Ctx): Promise<void> };
const react = (kind: "like" | "recast", remove: boolean, done: string): Cmd => ({
  summary: `${remove ? "Undo a " + kind : kind[0].toUpperCase() + kind.slice(1) + " a cast"}: <hash>`,
  run: (argv, ctx = defaultCtx()) => write(argv, ctx, async ([ref]) => {
    const r = need(ref, `runfcx ${remove ? "un" : ""}${kind} <hash>`);
    return { w: await reactionWrite(requireKey(), kind, parseRef(r), remove), done: `${done} ${r}.` };
  }),
});
const link = (remove: boolean): Cmd => ({
  summary: remove ? "Unfollow: @user" : "Follow: @user",
  run: (argv, ctx = defaultCtx()) => write(argv, ctx, async ([who], node) => {
    const u = need(who, `runfcx ${remove ? "un" : ""}follow @user`);
    const fid = await new Names(node).fidOf(u);
    return { w: await followWrite(requireKey(), fid, remove), done: remove ? `Unfollowed ${u}.` : `Following ${u}.` };
  }),
});

export const CLIENT_COMMANDS: Record<string, Cmd> = {
  login: {
    summary: "(2) Add an app key. --wallet (recommended) or seed phrase",
    async run(argv, ctx = defaultCtx()) {
      const { values } = parseArgs({ args: argv, options: { wallet: { type: "boolean", default: false } } });
      const log = (s: string) => ctx.out(s);
      if (!ctx.io.stdin.isTTY || !ctx.io.stdout.isTTY) { await (values.wallet ? walletLogin : seedLogin)(null as never, ctx.io, log); return; }
      await withNode(ctx, async (node) => {
        const k = values.wallet ? await walletLogin(node, ctx.io, log, { open: openBrowser }) : await seedLogin(node, ctx.io, log);
        const name = await new Names(node).username(k.fid);
        ctx.out(`Logged in as @${name} (FID ${k.fid}). App key ${k.publicKey.slice(0, 10)}… added. Try: runfcx feed`);
      });
    },
  },
  logout: {
    summary: "Remove the app key from your account (no seed phrase needed). --forget",
    async run(argv, ctx = defaultCtx()) {
      const { values } = parseArgs({ args: argv, options: { forget: { type: "boolean", default: false } } });
      const msg = { revoked: "App key removed. Logged out.", "not-logged-in": "Not logged in.",
        forgotten: "Local app key deleted. It stays on your account until it expires, 30 days after its last use." };
      if (values.forget) { ctx.out(msg[await logout(null as never, { forget: true })]); return; }
      await withNode(ctx, async (node) => ctx.out(msg[await logout(node, { write: ctx.write })]));
    },
  },
  whoami: {
    summary: "Your FID and app key. --json",
    async run(argv, ctx = defaultCtx()) {
      const { values } = parseArgs({ args: argv, options: { json: { type: "boolean", default: false } } });
      const k = loadKey();
      if (!k) { ctx.out("Not logged in. Run: runfcx login --wallet"); return; }
      await withNode(ctx, async (node) => {
        const username = await new Names(node).username(k.fid);
        const r = { fid: k.fid, username, publicKey: k.publicKey, addedAt: k.addedAt };
        ctx.out(values.json ? JSON.stringify(r)
          : `@${username} (FID ${k.fid}), app key ${k.publicKey.slice(0, 10)}…, added ${new Date(k.addedAt * 1000).toISOString().slice(0, 10)}`);
      });
    },
  },
  feed: {
    summary: "Casts from people you follow. --limit N --only-client <fid> --exclude-client <fid> --json",
    async run(argv, ctx = defaultCtx()) {
      const { values } = parseArgs({ args: argv, options: { limit: { type: "string", default: "30" }, json: { type: "boolean", default: false },
        "only-client": { type: "string" }, "exclude-client": { type: "string" } } });
      const o = { limit: Number(values.limit), onlyClient: fidArg(values["only-client"], "--only-client"),
        excludeClient: fidArg(values["exclude-client"], "--exclude-client"), now: ctx.now() };
      const me = requireKey().fid;
      await withNode(ctx, async (node) => {
        const items = await buildFeed(node, me, o);
        ctx.out(values.json ? JSON.stringify(items) : formatFeed(items, o.now).trimEnd());
      });
    },
  },
  clients: {
    summary: "Which apps posted the casts in your feed. --json",
    async run(argv, ctx = defaultCtx()) {
      const { values } = parseArgs({ args: argv, options: { limit: { type: "string", default: "100" }, json: { type: "boolean", default: false } } });
      const me = requireKey().fid;
      await withNode(ctx, async (node) => {
        const rows = countClients(await buildFeed(node, me, { limit: Number(values.limit), now: ctx.now() }));
        ctx.out(values.json ? JSON.stringify(rows) : formatClients(rows).trimEnd());
      });
    },
  },
  cast: {
    summary: "Post: \"<text>\" --reply-to <hash> --channel <url>",
    async run(argv, ctx = defaultCtx()) {
      const { values, positionals } = parseArgs({ args: argv, allowPositionals: true, options: {
        "reply-to": { type: "string" }, channel: { type: "string" }, json: { type: "boolean", default: false } } });
      const text = need(positionals[0], 'runfcx cast "<text>"');
      const k = requireKey();
      await write(values.json ? ["--json"] : [], ctx, async () => ({
        w: await castWrite(k, text, { replyTo: values["reply-to"] ? parseRef(values["reply-to"]) : undefined, channel: values.channel }),
        done: `Cast sent: ${k.fid}/{hash}` }));
    },
  },
  follow: link(false), unfollow: link(true),
  like: react("like", false, "Liked"), unlike: react("like", true, "Unliked"),
  recast: react("recast", false, "Recast"), unrecast: react("recast", true, "Removed recast"),
  user: {
    summary: "Profile: @user --json",
    async run(argv, ctx = defaultCtx()) {
      const { values, positionals } = parseArgs({ args: argv, allowPositionals: true, options: { json: { type: "boolean", default: false } } });
      const who = need(positionals[0], "runfcx user @user");
      await withNode(ctx, async (node) => {
        const fid = await new Names(node).fidOf(who);
        const d = await node.userData(fid), following = (await node.following(fid)).length;
        const r = { fid, username: d.USER_DATA_TYPE_USERNAME ?? `fid:${fid}`, bio: d.USER_DATA_TYPE_BIO ?? "", following };
        ctx.out(values.json ? JSON.stringify(r) : `@${r.username} (FID ${fid})\n${r.bio}\nfollowing: ${following}`.replace("\n\n", "\n"));
      });
    },
  },
};
