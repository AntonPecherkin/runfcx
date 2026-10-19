import type { NodeClient, Hex } from "./node-client.js";
import { readCache, writeCache } from "./cache.js";
import type { CastRef } from "./messages.js";

export class Names {
  private names: Record<number, string>;
  constructor(private node: NodeClient) { this.names = readCache("names") ?? {}; }
  async username(fid: number): Promise<string> {
    if (!(fid in this.names)) this.names[fid] = (await this.node.userData(fid)).USER_DATA_TYPE_USERNAME ?? `fid:${fid}`;
    return this.names[fid];
  }
  async fidOf(who: string): Promise<number> {
    if (/^\d+$/.test(who)) return Number(who);
    const name = who.replace(/^@/, "");
    const fid = await this.node.fidByName(name);
    if (fid === null) throw new Error(`No user '@${name}' on your node.`);
    return fid;
  }
  save(): void { writeCache("names", this.names); }
}

// fcx feed shows short hashes. We remember which FID wrote each one, so "fcx like 0x1a2b3c4d" works.
export function rememberCasts(items: { fid: number; hash: Hex }[]): void {
  writeCache("casts", Object.fromEntries(items.map((i) => [i.hash, i.fid])));
}
export function parseRef(s: string): CastRef {
  const m = /^(\d+)\/(0x[0-9a-f]{40})$/i.exec(s);
  if (m) return { fid: Number(m[1]), hash: m[2].toLowerCase() as Hex };
  const seen = readCache<Record<string, number>>("casts") ?? {};
  const hits = /^0x[0-9a-f]{8,40}$/i.test(s) ? Object.keys(seen).filter((h) => h.startsWith(s.toLowerCase())) : [];
  if (hits.length > 1) throw new Error(`Cast prefix '${s}' matches more than one cast. Use more characters.`);
  if (hits.length === 0) throw new Error(`Unknown cast '${s}'. Use <fid>/<hash> or a hash from fcx feed.`);
  return { fid: seen[hits[0]], hash: hits[0] as Hex };
}
