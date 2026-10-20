// The app key is an Ed25519 key that lives only on this laptop. Your custody address
// authorized it once (KEY_ADD); from then on it signs casts, likes and follows for you.
import { readFileSync, writeFileSync, rmSync, existsSync } from "node:fs";
import { randomBytes } from "node:crypto";
import { join } from "node:path";
import { NobleEd25519Signer, ed25519, bytesToHexString, hexStringToBytes } from "@farcaster/core";
import { fcxHome } from "../infra/paths.js";
import type { Hex } from "./node-client.js";

export interface AppKey { fid: number; privateKey: Hex; publicKey: Hex; requestFid: number; addedAt: number }
const file = () => join(fcxHome(), "key");

export function loadKey(): AppKey | null {
  return existsSync(file()) ? (JSON.parse(readFileSync(file(), "utf8")) as AppKey) : null;
}
export function requireKey(): AppKey {
  const k = loadKey();
  if (!k) throw new Error("Not logged in. Run: runfcx login --wallet");
  return k;
}
export function saveKey(k: AppKey): void { writeFileSync(file(), JSON.stringify(k, null, 2) + "\n", { mode: 0o600 }); }
export function clearKey(): void { rmSync(file(), { force: true }); }

export function appSigner(k: AppKey): NobleEd25519Signer {
  return new NobleEd25519Signer(hexStringToBytes(k.privateKey)._unsafeUnwrap());
}
export async function newAppKey(): Promise<{ privateKey: Uint8Array; publicKey: Hex }> {
  const privateKey = new Uint8Array(randomBytes(32));
  const pub = (await ed25519.getPublicKey(privateKey))._unsafeUnwrap();
  return { privateKey, publicKey: bytesToHexString(pub)._unsafeUnwrap() };
}
