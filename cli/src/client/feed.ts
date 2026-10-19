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
  const fids = [...new Set([me, ...(await node.following(me))])];
  const per = await pool(fids, 8, (fid) => node.castsByFid(fid, { pageSize: o.limit, startTimestamp: Math.max(0, since) }));
  const casts = per.flat().sort((a, b) => b.data.timestamp - a.data.timestamp);

  const names = new Names(node), clients = new Clients(node), out: FeedItem[] = [];
  for (const c of casts) {
    if (out.length >= o.limit) break;
    const appFid = await clients.appFid(c.data.fid, c.signer);
    if (o.onlyClient !== undefined && appFid !== o.onlyClient) continue;
    if (o.excludeClient !== undefined && appFid === o.excludeClient) continue;
    out.push(await toItem(c, appFid, names));
  }
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
