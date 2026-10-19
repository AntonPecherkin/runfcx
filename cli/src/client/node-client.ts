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
  constructor(public base: string, private f: typeof fetch = fetch) {}

  private async call<T>(path: string, params: Params = {}, init?: RequestInit): Promise<T> {
    const u = new URL(path, this.base);
    for (const [k, v] of Object.entries(params)) {
      if (Array.isArray(v)) v.forEach((x) => u.searchParams.append(k, String(x)));
      else if (v !== undefined) u.searchParams.set(k, String(v));
    }
    const r = await this.f(u, init);
    const body = await r.json().catch(() => ({}));
    if (!r.ok) throw new NodeError(body.details ?? body.error_detail ?? body.error ?? `HTTP ${r.status}`, r.status);
    return body as T;
  }
  // The node answers "not found" with a 4xx. For lookups that is a normal answer.
  private async maybe<T>(path: string, params: Params): Promise<T | null> {
    try { return await this.call<T>(path, params); }
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
    return (await this.maybe<{ fid: number }>("/v1/onChainIdRegistryEventByAddress", { address }))?.fid ?? null;
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
