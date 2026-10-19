// There is no "home feed" endpoint on a node. We build it: who do I follow, what did each of
// them cast lately, merge newest first, then tag each cast with the app that posted it.
import type { NodeClient, Msg, Hex } from "./node-client.js";
import type { CastRef } from "./messages.js";
import { Names, rememberCasts } from "./names.js";
import { Clients } from "./signers.js";

export const FC_EPOCH = 1609459200; // Farcaster time 0 = 2021-01-01 UTC
export interface FeedItem { fid: number; username: string; hash: Hex; text: string; time: number; appFid: number; app: string; replyTo?: CastRef; channel?: string }

async function pool<T, R>(items: T[], n: number, fn: (x: T) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length); let i = 0;
  await Promise.all(Array.from({ length: Math.min(n, items.length) }, async () => {
    while (i < items.length) { const j = i++; out[j] = await fn(items[j]); }
  }));
  return out;
}

export async function buildFeed(node: NodeClient, me: number,
  o: { limit: number; onlyClient?: number; excludeClient?: number; windowDays?: number; now?: number }): Promise<FeedItem[]> {
  const now = o.now ?? Math.floor(Date.now() / 1000);
  const since = now - FC_EPOCH - (o.windowDays ?? 3) * 86400;
  // @snippet feed-build
  const fids = [...new Set([me, ...(await node.following(me))])];
  const per = await pool(fids, 8, (fid) => node.castsByFid(fid, { pageSize: o.limit, startTimestamp: Math.max(0, since) }));
  // Filter here too: not every node applies startTimestamp.
  const casts = per.flat().filter((c) => c.data.timestamp >= since).sort((a, b) => b.data.timestamp - a.data.timestamp);
  // @end

  const names = new Names(node), clients = new Clients(node), kept: { c: Msg; appFid: number }[] = [];
  // Look up apps a batch at a time, in parallel, until we have enough casts that pass the filter.
  for (let i = 0; i < casts.length && kept.length < o.limit; i += o.limit) {
    const batch = casts.slice(i, i + o.limit);
    const apps = await pool(batch, 8, (c) => clients.appFid(c.data.fid, c.signer));
    batch.forEach((c, j) => {
      if (o.onlyClient !== undefined && apps[j] !== o.onlyClient) return;
      if (o.excludeClient !== undefined && apps[j] === o.excludeClient) return;
      kept.push({ c, appFid: apps[j] });
    });
  }
  const out = await pool(kept.slice(0, o.limit), 8, ({ c, appFid }) => toItem(c, appFid, names));
  names.save(); clients.save(); rememberCasts(out);
  return out;
}

async function toItem(c: Msg, appFid: number, names: Names): Promise<FeedItem> {
  const b = c.data.castAddBody!;
  return { fid: c.data.fid, username: await names.username(c.data.fid), hash: c.hash, text: b.text, time: FC_EPOCH + c.data.timestamp,
    appFid, app: appFid ? `@${await names.username(appFid)}` : "unknown app",
    replyTo: b.parentCastId && { fid: b.parentCastId.fid, hash: b.parentCastId.hash as Hex }, channel: b.parentUrl };
}

export function countClients(items: FeedItem[]): { appFid: number; app: string; count: number }[] {
  const m = new Map<number, { appFid: number; app: string; count: number }>();
  for (const i of items) { const r = m.get(i.appFid) ?? { appFid: i.appFid, app: i.app, count: 0 }; r.count++; m.set(i.appFid, r); }
  return [...m.values()].sort((a, b) => b.count - a.count);
}
