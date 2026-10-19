// Seed-phrase login. The phrase controls the whole account, so: a warning, hidden input,
// memory only, and we check the derived address is the account's custody address before signing.
import { createHash } from "node:crypto";
import { mnemonicToAccount, english } from "viem/accounts";
import { ViemLocalEip712Signer } from "@farcaster/core";
import type { NodeClient } from "./node-client.js";
import { addAppKey } from "./login.js";
import type { AppKey } from "./keystore.js";

export const NEEDS_HUMAN = "Login needs a human at the keyboard. Ask them to run: fcx login --wallet";
type Io = { stdin: NodeJS.ReadStream; stdout: NodeJS.WriteStream };

export function requireTty(io: { stdin: { isTTY?: boolean }; stdout: { isTTY?: boolean } }): void {
  if (!io.stdin.isTTY || !io.stdout.isTTY) throw new Error(NEEDS_HUMAN);
}
export const normalizeMnemonic = (s: string) => s.trim().toLowerCase().split(/\s+/).join(" ");

// BIP-39: each word is 11 bits; the last few bits are a SHA-256 checksum of the rest.
export function validMnemonic(s: string): boolean {
  const words = s.split(" ");
  if (![12, 15, 18, 21, 24].includes(words.length)) return false;
  const idx = words.map((w) => english.indexOf(w));
  if (idx.some((i) => i < 0)) return false;
  const bits = idx.map((i) => i.toString(2).padStart(11, "0")).join("");
  const cs = words.length / 3;
  const entropy = Buffer.from(bits.slice(0, -cs).match(/.{8}/g)!.map((b) => parseInt(b, 2)));
  const want = createHash("sha256").update(entropy).digest()[0].toString(2).padStart(8, "0").slice(0, cs);
  return want === bits.slice(-cs);
}

export function readHidden(prompt: string, io: Io): Promise<string> {
  return new Promise((resolve, reject) => {
    let s = "";
    io.stdout.write(prompt);
    io.stdin.setRawMode(true); io.stdin.resume();
    const done = (fn: () => void) => { io.stdin.setRawMode(false); io.stdin.pause(); io.stdin.off("data", onData); io.stdout.write("\n"); fn(); };
    const onData = (d: Buffer) => {
      for (const ch of d.toString("utf8")) {
        if (ch === "\r" || ch === "\n") return done(() => resolve(s));
        if (ch === "\u0003") return done(() => reject(new Error("Cancelled.")));
        if (ch === "\u007f" || ch === "\b") s = s.slice(0, -1); else s += ch;
      }
    };
    io.stdin.on("data", onData);
  });
}

export async function seedLogin(node: NodeClient, io: Io, log: (s: string) => void): Promise<AppKey> {
  requireTty(io);
  log([
    "A seed phrase controls your whole Farcaster account. Use a test account.",
    "fcx keeps it in memory only, uses it to sign two messages, and forgets it.",
    "Safer: fcx login --wallet",
  ].join("\n"));
  const phrase = normalizeMnemonic(await readHidden("Seed phrase (hidden): ", io));
  if (!validMnemonic(phrase)) throw new Error("That is not a valid 12/24-word seed phrase.");
  const account = mnemonicToAccount(phrase); // m/44'/60'/0'/0/0, the path the Farcaster app uses
  log(`Address ${account.address}.`);
  return addAppKey(node, new ViemLocalEip712Signer(account), account.address, { log });
}
