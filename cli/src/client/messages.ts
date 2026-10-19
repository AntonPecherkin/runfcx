// Each write is a signed protobuf Message plus a check that tells us it reached the network.
import { makeCastAdd, makeReactionAdd, makeReactionRemove, makeLinkAdd, makeLinkRemove, FarcasterNetwork, ReactionType,
  CastType, Message, bytesToHexString, hexStringToBytes, type HubAsyncResult } from "@farcaster/core";
import type { NodeClient, Hex } from "./node-client.js";
import { appSigner, type AppKey } from "./keystore.js";

export interface CastRef { fid: number; hash: Hex }
export interface Write { what: string; message: Message; landed(node: NodeClient): Promise<boolean> }

const opts = (k: AppKey) => ({ fid: k.fid, network: FarcasterNetwork.MAINNET });
const bytes = (h: Hex) => hexStringToBytes(h)._unsafeUnwrap();
export const hashOf = (m: Message) => bytesToHexString(m.hash)._unsafeUnwrap() as Hex;
async function unwrap(r: HubAsyncResult<Message>): Promise<Message> {
  const v = await r; if (v.isErr()) throw new Error(v.error.message); return v.value;
}

// @snippet cast-write
export async function castWrite(k: AppKey, text: string, o: { replyTo?: CastRef; channel?: string } = {}): Promise<Write> {
  const size = Buffer.byteLength(text);
  if (size > 320) throw new Error(`Cast is too long (${size} bytes, max 320).`);
  const message = await unwrap(makeCastAdd({ text, type: CastType.CAST, embeds: [], embedsDeprecated: [], mentions: [], mentionsPositions: [],
    parentCastId: o.replyTo && { fid: o.replyTo.fid, hash: bytes(o.replyTo.hash) }, parentUrl: o.channel }, opts(k), appSigner(k)));
  return { what: "cast", message, landed: async (n) => (await n.castById(k.fid, hashOf(message))) !== null };
}
// @end

export async function reactionWrite(k: AppKey, kind: "like" | "recast", t: CastRef, remove: boolean): Promise<Write> {
  const body = { type: kind === "like" ? ReactionType.LIKE : ReactionType.RECAST, targetCastId: { fid: t.fid, hash: bytes(t.hash) } };
  const message = await unwrap((remove ? makeReactionRemove : makeReactionAdd)(body, opts(k), appSigner(k)));
  const type = kind === "like" ? "Like" : "Recast";
  return { what: remove ? `un${kind}` : kind, message,
    landed: async (n) => ((await n.reactionById(k.fid, type, t)) !== null) !== remove };
}

export async function followWrite(k: AppKey, targetFid: number, remove: boolean): Promise<Write> {
  const message = await unwrap((remove ? makeLinkRemove : makeLinkAdd)({ type: "follow", targetFid }, opts(k), appSigner(k)));
  return { what: remove ? "unfollow" : "follow", message,
    landed: async (n) => ((await n.linkById(k.fid, targetFid)) !== null) !== remove };
}
