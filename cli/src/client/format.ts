import type { FeedItem } from "./feed.js";

export function ago(sec: number): string {
  if (sec < 3600) return `${Math.max(1, Math.floor(sec / 60))}m`;
  if (sec < 86400) return `${Math.floor(sec / 3600)}h`;
  return `${Math.floor(sec / 86400)}d`;
}
export function formatFeed(items: FeedItem[], now: number): string {
  if (items.length === 0) return "Nothing in the last 3 days. Follow someone: fcx follow @dwr\n";
  return items.map((i) => {
    const where = i.replyTo ? " · reply" : i.channel ? ` · ${i.channel}` : "";
    const text = i.text.split("\n").map((l) => `  ${l}`).join("\n");
    return `@${i.username} · ${ago(now - i.time)} · via ${i.app}${where} · ${i.hash.slice(0, 10)}\n${text}\n`;
  }).join("\n");
}
export function formatClients(rows: { appFid: number; app: string; count: number }[]): string {
  return rows.map((r) => `${String(r.count).padStart(4)}  ${r.app} (fid ${r.appFid})`).join("\n") + "\n";
}
