// In-memory stand-in for a Snapchain read node's HTTP API (port 3381).
// It decodes the real protobuf bytes we submit, so tests exercise our actual messages.
import { Message, MessageType, bytesToHexString } from "@farcaster/core";
import type { Hex, Msg } from "../../src/client/node-client.js";

const hex = (b: Uint8Array) => bytesToHexString(b)._unsafeUnwrap() as Hex;
const TYPE: Record<number, string> = { 1: "MESSAGE_TYPE_CAST_ADD", 2: "MESSAGE_TYPE_CAST_REMOVE", 3: "MESSAGE_TYPE_REACTION_ADD",
  4: "MESSAGE_TYPE_REACTION_REMOVE", 5: "MESSAGE_TYPE_LINK_ADD", 6: "MESSAGE_TYPE_LINK_REMOVE", 11: "MESSAGE_TYPE_USER_DATA_ADD",
  16: "MESSAGE_TYPE_KEY_ADD", 17: "MESSAGE_TYPE_KEY_REMOVE" };

export function toJson(m: Message): Msg {
  const d = m.data!;
  const out: Msg = { data: { type: TYPE[d.type] ?? String(d.type), fid: d.fid, timestamp: d.timestamp }, hash: hex(m.hash), signer: hex(m.signer) };
  const c = d.castAddBody;
  if (c) out.data.castAddBody = { text: c.text, embeds: c.embeds.map((e) => ({ url: e.url })),
    parentCastId: c.parentCastId && { fid: c.parentCastId.fid, hash: hex(c.parentCastId.hash) }, parentUrl: c.parentUrl };
  const r = d.reactionBody;
  if (r) out.data.reactionBody = { type: r.type === 1 ? "REACTION_TYPE_LIKE" : "REACTION_TYPE_RECAST",
    targetCastId: r.targetCastId && { fid: r.targetCastId.fid, hash: hex(r.targetCastId.hash) } };
  const l = d.linkBody;
  if (l) out.data.linkBody = { type: l.type, targetFid: l.targetFid };
  return out;
}

interface Account { fid: number; custody: Hex; units: number; username: string; nonce: number; appNonces: Record<number, number> }
interface Key { key: Hex; fid: number; requestFid: number; source: string; metadata?: string }

export class FakeStore {
  accounts = new Map<number, Account>();
  casts: Msg[] = []; reactions: Msg[] = []; links: Msg[] = []; keys: Key[] = [];
  submits = 0; maxInFlight = 0;
  addAccount(a: { fid: number; custody: Hex; units?: number; username?: string }) {
    this.accounts.set(a.fid, { units: 1, username: `user${a.fid}`, nonce: 0, appNonces: {}, ...a });
  }
  addKey(k: Key) { this.keys.push(k); }
  addCast(m: Msg) { this.casts.push(m); }
  follow(fid: number, targetFid: number) {
    this.links.push({ data: { type: "MESSAGE_TYPE_LINK_ADD", fid, timestamp: 1, linkBody: { type: "follow", targetFid } },
      hash: `0x${String(this.links.length).padStart(40, "0")}`, signer: "0x00" });
  }
  merge(m: Message): void {
    const d = m.data!, j = toJson(m);
    if (d.type === MessageType.CAST_ADD) this.casts.push(j);
    if (d.type === MessageType.REACTION_ADD) this.reactions.push(j);
    if (d.type === MessageType.REACTION_REMOVE) this.reactions = this.reactions.filter((x) =>
      !(x.data.fid === d.fid && x.data.reactionBody?.targetCastId?.hash === j.data.reactionBody?.targetCastId?.hash
        && x.data.reactionBody?.type === j.data.reactionBody?.type));
    if (d.type === MessageType.LINK_ADD) this.links.push(j);
    if (d.type === MessageType.LINK_REMOVE) this.links = this.links.filter((x) =>
      !(x.data.fid === d.fid && x.data.linkBody?.targetFid === d.linkBody!.targetFid));
    if (d.type === MessageType.KEY_ADD) {
      const a = this.accounts.get(d.fid)!; a.nonce = d.keyAddBody!.nonce;
      this.keys.push({ key: hex(d.keyAddBody!.key), fid: d.fid, requestFid: d.fid, source: "SIGNER_SOURCE_OFFCHAIN" });
    }
    if (d.type === MessageType.KEY_REMOVE) {
      const key = hex(d.keyRemoveBody!.key);
      const k = this.keys.find((x) => x.fid === d.fid && x.key === key);
      if (k) this.accounts.get(d.fid)!.appNonces[k.requestFid] = d.keyRemoveBody!.nonce;
      this.keys = this.keys.filter((x) => !(x.fid === d.fid && x.key === key));
    }
  }
}

export function fakeNode() {
  const store = new FakeStore();
  const knobs = { dropSubmits: 0, reject: undefined as string | undefined, rejectFrom: 0, duplicateOnResubmit: false, pageSize: 1000,
    blockDelay: 0, ignoreStartTimestamp: false, signerLatencyMs: 0 };
  let inFlight = 0;
  const seen = new Set<string>();
  const ok = (body: unknown) => new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json" } });
  const notFound = () => new Response(JSON.stringify({ errCode: "not_found", details: "not found" }), { status: 400 });
  const page = (all: Msg[], token: string | null) => {
    const start = token ? Number(token) : 0, end = start + knobs.pageSize;
    return ok({ messages: all.slice(start, end), nextPageToken: end < all.length ? String(end) : "" });
  };

  const f = async (input: string | URL | Request, init?: RequestInit): Promise<Response> => {
    const u = new URL(String(input)), q = u.searchParams, fid = Number(q.get("fid"));
    switch (u.pathname) {
      case "/v1/info": return ok({ shardInfos: [{ shardId: 1, maxHeight: 10, blockDelay: knobs.blockDelay }] });
      case "/v1/castsByFid": {
        const start = knobs.ignoreStartTimestamp ? 0 : Number(q.get("startTimestamp") ?? 0);
        const mine = store.casts.filter((c) => c.data.fid === fid && c.data.timestamp >= start)
          .sort((a, b) => b.data.timestamp - a.data.timestamp);
        return ok({ messages: mine.slice(0, Number(q.get("pageSize") ?? 1000)), nextPageToken: "" });
      }
      case "/v1/castById": return store.casts.find((c) => c.data.fid === fid && c.hash === q.get("hash")) ? ok(store.casts.find((c) => c.hash === q.get("hash"))) : notFound();
      case "/v1/linksByFid": return page(store.links.filter((l) => l.data.fid === fid), q.get("pageToken"));
      case "/v1/linkById": {
        const l = store.links.find((x) => x.data.fid === fid && x.data.linkBody?.targetFid === Number(q.get("target_fid")));
        return l ? ok(l) : notFound();
      }
      case "/v1/reactionById": {
        const t = q.get("reaction_type") === "Like" ? "REACTION_TYPE_LIKE" : "REACTION_TYPE_RECAST";
        const r = store.reactions.find((x) => x.data.fid === fid && x.data.reactionBody?.type === t
          && x.data.reactionBody.targetCastId?.hash === q.get("target_hash"));
        return r ? ok(r) : notFound();
      }
      case "/v1/userDataByFid": {
        const a = store.accounts.get(fid);
        return ok({ messages: a ? [{ data: { type: "MESSAGE_TYPE_USER_DATA_ADD", fid, timestamp: 1,
          userDataBody: { type: "USER_DATA_TYPE_USERNAME", value: a.username } }, hash: "0x01", signer: "0x02" }] : [], nextPageToken: "" });
      }
      case "/v1/userNameProofByName": {
        const a = [...store.accounts.values()].find((x) => x.username === q.get("name"));
        return a ? ok({ name: a.username, fid: a.fid, owner: a.custody, type: "USERNAME_TYPE_FNAME", timestamp: 1, signature: "" }) : notFound();
      }
      case "/v1/onChainIdRegistryEventByAddress": {
        const a = [...store.accounts.values()].find((x) => x.custody.toLowerCase() === q.get("address")!.toLowerCase());
        return a ? ok({ type: "EVENT_TYPE_ID_REGISTER", fid: a.fid, idRegisterEventBody: { to: a.custody } }) : notFound();
      }
      case "/v1/storageLimitsByFid": return ok({ limits: [], units: store.accounts.get(fid)?.units ?? 0, unitDetails: [], tier_subscriptions: [] });
      case "/v1/signer": {
        inFlight++; store.maxInFlight = Math.max(store.maxInFlight, inFlight);
        await new Promise((r) => setTimeout(r, knobs.signerLatencyMs));
        inFlight--;
        const k = store.keys.find((x) => x.fid === fid && x.key === q.get("signer"));
        return k ? ok({ signer: { key: k.key, keyType: 1, fid: k.fid, source: k.source, scopes: [],
          ...(k.source === "SIGNER_SOURCE_OFFCHAIN" ? { requestFid: k.requestFid } : { onChainEvent: { signerEventBody: { metadata: k.metadata } } }) } }) : notFound();
      }
      case "/v1/signersByFid": {
        const a = store.accounts.get(fid)!;
        const req = q.getAll("requesterFids").map(Number);
        return ok({ signers: store.keys.filter((k) => k.fid === fid), gaslessSignerCount: 0, gaslessSignerLimit: 1000,
          currentUserNonce: a.nonce, ...(req.length ? { requesterFidNonces: Object.fromEntries(req.map((r) => [String(r), a.appNonces[r] ?? 0])) } : {}) });
      }
      case "/v1/submitMessage": {
        store.submits++;
        if (knobs.reject && store.submits >= knobs.rejectFrom) return new Response(JSON.stringify({ errCode: "bad_request.validation_failure", details: knobs.reject }), { status: 400 });
        const bytes = new Uint8Array(await new Response(init!.body as BodyInit).arrayBuffer());
        const m = Message.decode(bytes), h = hex(m.hash);
        if (knobs.duplicateOnResubmit && seen.has(h))
          return new Response(JSON.stringify({ errCode: "bad_request.duplicate", details: "message has already been merged" }), { status: 400 });
        seen.add(h);
        if (knobs.dropSubmits > 0) { knobs.dropSubmits--; return ok(toJson(m)); } // accepted, lost in gossip
        store.merge(m);
        return ok(toJson(m));
      }
    }
    return new Response("{}", { status: 404 });
  };
  return { fetch: f as typeof fetch, store, knobs };
}
