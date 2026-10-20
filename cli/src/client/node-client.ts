// The read node's HTTP API (port 3381). Reads, plus submitMessage for writes:
// a read node validates a message and gossips it to validators. It does not store it itself.
export type Hex = `0x${string}`;
export interface CastBody { text: string; embeds: { url?: string }[]; parentCastId?: { fid: number; hash: string }; parentUrl?: string }
export interface Msg {
  data: { type: string; fid: number; timestamp: number; castAddBody?: CastBody;
    reactionBody?: { type: string; targetCastId?: { fid: number; hash: string } };
    linkBody?: { type: string; targetFid?: number }; userDataBody?: { type: string; value: string } };
  hash: Hex; signer: Hex;
}
export interface SignerInfo { key: Hex; fid: number; source: string; requestFid?: number; onChainEvent?: { signerEventBody?: { metadata: string } } }
type Params = Record<string, string | number | boolean | undefined | (string | number)[]>;

export class NodeError extends Error {
  constructor(message: string, public status: number) { super(message); }
}

export class NodeClient {
  constructor(public base: string, private f: typeof fetch = fetch, private o: { timeoutMs?: number; slowTimeoutMs?: number } = {}) {}

  private async call<T>(path: string, params: Params = {}, init?: RequestInit, slow = false): Promise<T> {
    const u = new URL(path, this.base);
    const lists: string[] = [];
    for (const [k, v] of Object.entries(params)) {
      // The node reads a list only as k[]=a&k[]=b with literal brackets; it ignores %5B%5D.
      if (Array.isArray(v)) v.forEach((x) => lists.push(`${k}[]=${encodeURIComponent(String(x))}`));
      else if (v !== undefined) u.searchParams.set(k, String(v));
    }
    if (lists.length) u.search = (u.search ? `${u.search}&` : "?") + lists.join("&");
    // A stalled tunnel or a busy node must not hang the CLI. Writes get a little longer.
    const ms = slow ? (this.o.slowTimeoutMs ?? 60_000) : (this.o.timeoutMs ?? 10_000) * (init?.method === "POST" ? 1.5 : 1);
    let r: Response;
    try { r = await this.f(u, { ...init, signal: AbortSignal.timeout(ms) }); }
    catch (e) {
      if ((e as Error).name === "TimeoutError" || (e as Error).name === "AbortError") throw new Error("Your node did not answer in time. Run: runfcx status");
      throw e;
    }
    const text = await r.text();
    let body: Record<string, string> = {};
    try { body = JSON.parse(text); } catch { /* some errors come back as plain text */ }
    if (!r.ok) throw new NodeError(body.details ?? body.error_detail ?? body.error ?? (text.trim().slice(0, 200) || `HTTP ${r.status}`), r.status);
    return body as T;
  }
  // The node answers "not found" with a 4xx. For lookups that is a normal answer.
  private async maybe<T>(path: string, params: Params, slow = false): Promise<T | null> {
    try { return await this.call<T>(path, params, undefined, slow); }
    catch (e) { if (e instanceof NodeError && e.status < 500) return null; throw e; }
  }

  info() { return this.call<{ shardInfos: { blockDelay?: number }[] }>("/v1/info"); }

  async castsByFid(fid: number, o: { pageSize?: number; startTimestamp?: number } = {}): Promise<Msg[]> {
    const r = await this.call<{ messages: Msg[] }>("/v1/castsByFid", { fid, reverse: true, pageSize: o.pageSize ?? 25, startTimestamp: o.startTimestamp });
    return r.messages;
  }
  async following(fid: number): Promise<number[]> {
    const out: number[] = [];
    let pageToken: string | undefined;
    do {
      const r = await this.call<{ messages: Msg[]; nextPageToken?: string }>("/v1/linksByFid", { fid, link_type: "follow", pageSize: 1000, pageToken });
      for (const m of r.messages) if (m.data.linkBody?.targetFid) out.push(m.data.linkBody.targetFid);
      pageToken = r.nextPageToken || undefined;
    } while (pageToken);
    return out;
  }
  async userData(fid: number): Promise<Record<string, string>> {
    const r = await this.call<{ messages: Msg[] }>("/v1/userDataByFid", { fid });
    return Object.fromEntries(r.messages.filter((m) => m.data.userDataBody).map((m) => [m.data.userDataBody!.type, m.data.userDataBody!.value]));
  }
  async signer(fid: number, key: Hex): Promise<SignerInfo | null> {
    return (await this.maybe<{ signer: SignerInfo }>("/v1/signer", { fid, signer: key }))?.signer ?? null;
  }
  signersByFid(fid: number, requesterFid?: number) {
    return this.call<{ currentUserNonce: number; requesterFidNonces?: Record<string, number> }>("/v1/signersByFid",
      { fid, requesterFids: requesterFid === undefined ? undefined : [requesterFid] })
      .then((r) => ({ currentUserNonce: r.currentUserNonce, requesterFidNonces: r.requesterFidNonces ?? {} }));
  }
  async fidByAddress(address: Hex): Promise<number | null> {
    // The node searches every shard for this one; on mainnet it takes ~20 s.
    return (await this.maybe<{ fid: number }>("/v1/onChainIdRegistryEventByAddress", { address }, true))?.fid ?? null;
  }
  async storageUnits(fid: number): Promise<number> {
    return (await this.call<{ units: number }>("/v1/storageLimitsByFid", { fid })).units;
  }
  async fidByName(name: string): Promise<number | null> {
    return (await this.maybe<{ fid: number }>("/v1/userNameProofByName", { name }))?.fid ?? null;
  }
  castById(fid: number, hash: Hex) { return this.maybe<Msg>("/v1/castById", { fid, hash }); }
  reactionById(fid: number, type: "Like" | "Recast", t: { fid: number; hash: Hex }) {
    return this.maybe<Msg>("/v1/reactionById", { fid, reaction_type: type, target_fid: t.fid, target_hash: t.hash });
  }
  linkById(fid: number, targetFid: number) {
    return this.maybe<Msg>("/v1/linkById", { fid, target_fid: targetFid, link_type: "follow" });
  }
  submit(bytes: Uint8Array): Promise<Msg> {
    return this.call<Msg>("/v1/submitMessage", {}, { method: "POST", headers: { "content-type": "application/octet-stream" }, body: bytes });
  }
}
