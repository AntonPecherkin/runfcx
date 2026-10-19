// A read node answers "accepted" once the message is valid and gossiped. That does not mean
// a validator put it in a block. So we watch for it, and send the same bytes again if it never shows up.
import { Message } from "@farcaster/core";
import { NodeError, type NodeClient, type Hex } from "./node-client.js";
import { hashOf, type Write } from "./messages.js";

export type WriteOpts = { tries?: number; waitMs?: number; pollMs?: number; sleep?: (ms: number) => Promise<void> };

const isDuplicate = (e: NodeError) => /duplicate|already (been )?merged|already exists/i.test(e.message);

export async function submitAndConfirm(node: NodeClient, w: Write,
  o: WriteOpts = {}): Promise<{ hash: Hex; tries: number }> {
  const tries = o.tries ?? 3, waitMs = o.waitMs ?? 15_000, pollMs = o.pollMs ?? 3_000;
  const sleep = o.sleep ?? ((ms) => new Promise<void>((r) => setTimeout(r, ms)));
  const bytes = Message.encode(w.message).finish();
  // @snippet submit-confirm
  for (let t = 1; t <= tries; t++) {
    try { await node.submit(bytes); }
    catch (e) {
      if (!(e instanceof NodeError) || e.status >= 500) throw e;
      // On a resubmit, a refusal can just mean the first copy landed meanwhile.
      if (!isDuplicate(e)) {
        if (t > 1 && await w.landed(node)) return { hash: hashOf(w.message), tries: t };
        throw new Error(`Your node rejected the ${w.what}: ${e.message}`);
      }
    }
    for (let waited = 0; waited <= waitMs; waited += pollMs) {
      if (await w.landed(node)) return { hash: hashOf(w.message), tries: t };
      await sleep(pollMs);
    }
  }
  // @end
  throw new Error(`Sent the ${w.what} ${tries} times. Your node never showed it. Is it synced? Run: fcx status`);
}
