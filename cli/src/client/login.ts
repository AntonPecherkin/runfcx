// Adding an app key, step by step. Your custody address signs two EIP-712 messages; no gas,
// no transaction. Our own node checks them and gossips the KEY_ADD to the validators.
import { makeKeyAddBody, makeKeyAdd, makeKeyRemoveBodySelfRevoke, makeKeyRemove, FarcasterNetwork, MessageType,
  getFarcasterTime, type Eip712Signer } from "@farcaster/core";
import type { NodeClient, Hex } from "./node-client.js";
import { newAppKey, saveKey, loadKey, clearKey, appSigner, type AppKey } from "./keystore.js";
import { submitAndConfirm, type WriteOpts } from "./writer.js";
import { bytesToHexString } from "@farcaster/core";

export const SCOPES = [MessageType.CAST_ADD, MessageType.CAST_REMOVE, MessageType.REACTION_ADD,
  MessageType.REACTION_REMOVE, MessageType.LINK_ADD, MessageType.LINK_REMOVE];
export const KEY_TTL = 30 * 86400; // the key expires 30 days after its last use
const fcNow = () => getFarcasterTime()._unsafeUnwrap();
const net = (fid: number) => ({ fid, network: FarcasterNetwork.MAINNET });

export async function addAppKey(node: NodeClient, custody: Eip712Signer, address: Hex,
  o: { log?: (s: string) => void; write?: WriteOpts } = {}): Promise<AppKey> {
  const log = o.log ?? (() => {});
  const fid = await node.fidByAddress(address);
  if (fid === null) throw new Error(`${address} is not the custody address of any FID.`);
  if ((await node.storageUnits(fid)) === 0) throw new Error(`FID ${fid} has no storage. It needs storage rent before it can post.`);
  const nonce = (await node.signersByFid(fid)).currentUserNonce + 1;
  log(`FID ${fid}. Asking the custody address to sign the new app key…`);

  const { privateKey, publicKey } = await newAppKey();
  const r = await makeKeyAddBody({ fid: BigInt(fid), key: Buffer.from(publicKey.slice(2), "hex"), scopes: SCOPES,
    ttl: KEY_TTL, nonce, deadline: fcNow() + 3600 }, custody);
  if (r.isErr()) throw new Error(/reject|denied|4001/i.test(r.error.message) ? "You rejected the request in your wallet. Nothing was added." : r.error.message);

  const k: AppKey = { fid, privateKey: bytesToHexString(privateKey)._unsafeUnwrap(), publicKey, requestFid: fid, addedAt: Math.floor(Date.now() / 1000) };
  // KEY_ADD is signed by the new key itself: proof we hold it.
  const m = await makeKeyAdd(r.value, net(fid), appSigner(k));
  if (m.isErr()) throw new Error(m.error.message);
  log("Sending KEY_ADD through your node…");
  await submitAndConfirm(node, { what: "KEY_ADD", message: m.value, landed: async (n) => (await n.signer(fid, publicKey)) !== null }, o.write);
  saveKey(k);
  return k;
}

export async function logout(node: NodeClient, o: { write?: WriteOpts } = {}): Promise<"revoked" | "not-logged-in"> {
  const k = loadKey();
  if (!k) return "not-logged-in";
  if ((await node.signer(k.fid, k.publicKey)) !== null) {
    // Self-revoke: the key signs its own removal. It uses the app nonce of the FID that requested it.
    const nonce = ((await node.signersByFid(k.fid, k.requestFid)).requesterFidNonces[String(k.requestFid)] ?? 0) + 1;
    const body = makeKeyRemoveBodySelfRevoke({ key: Buffer.from(k.publicKey.slice(2), "hex"), nonce, deadline: fcNow() + 3600 });
    if (body.isErr()) throw new Error(body.error.message);
    const m = await makeKeyRemove(body.value, net(k.fid), appSigner(k));
    if (m.isErr()) throw new Error(m.error.message);
    await submitAndConfirm(node, { what: "KEY_REMOVE", message: m.value, landed: async (n) => (await n.signer(k.fid, k.publicKey)) === null }, o.write);
  }
  clearKey();
  return "revoked";
}
