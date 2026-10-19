// Which app posted a cast? The cast is signed by an app key. When that key was added, the
// SignedKeyRequest metadata named the app's own FID (requestFid). That FID is the "client".
import { decodeAbiParameters } from "viem";
import { GASLESS_SIGNED_KEY_REQUEST_METADATA_ABI } from "@farcaster/core";
import type { NodeClient, Hex, SignerInfo } from "./node-client.js";
import { readCache, writeCache } from "./cache.js";

export function requestFidOf(s: SignerInfo): number {
  if (s.requestFid) return s.requestFid;
  const meta = s.onChainEvent?.signerEventBody?.metadata;
  if (!meta) return 0;
  // Onchain keys carry the same struct, ABI-encoded and base64'd in the JSON.
  try {
    const [m] = decodeAbiParameters(GASLESS_SIGNED_KEY_REQUEST_METADATA_ABI, `0x${Buffer.from(meta, "base64").toString("hex")}`);
    return Number(m.requestFid);
  } catch { return 0; } // metadata we can't read: show "unknown app" instead of failing the feed
}

export class Clients {
  private map: Record<string, number>;
  constructor(private node: NodeClient) { this.map = readCache("signers") ?? {}; }
  async appFid(fid: number, signer: Hex): Promise<number> {
    const id = `${fid}:${signer}`;
    if (!(id in this.map)) {
      const s = await this.node.signer(fid, signer);
      this.map[id] = s ? requestFidOf(s) : 0;
    }
    return this.map[id];
  }
  save(): void { writeCache("signers", this.map); }
}
