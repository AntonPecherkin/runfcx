# 02 · Hello world with a gasless key and your own node (farcasterxyz/docs)

**Status: draft. Needs the user's OK before opening.**

Target: `farcasterxyz/docs`, `src/app/(docs)/developers/guides/basics/hello-world/page.mdx`
(and the copy in `docs/developers/guides/basics/hello-world.md`).

Today the guide:
- registers the app key onchain through the Key Gateway (needs ETH on OP Mainnet), and
- writes through `hoyt.farcaster.xyz:3383`, which is password protected, or a paid provider.

Proposed change: add a section "Without onchain transactions" that
1. adds the app key with a gasless `KEY_ADD` (`makeKeyAddBody` + `makeKeyAdd`, `@farcaster/core` ≥ 0.20),
   signed by the custody address over EIP-712 (no ETH needed);
2. submits it and a first cast to your own read node over HTTP (`POST /v1/submitMessage`), which relays to validators;
3. confirms both landed (`GET /v1/signer`, `GET /v1/castById`) and resubmits if not.
It links to snapchain's `guides/writing-messages#gasless-signers` for the rules (scopes, TTL, nonces).

The code is ~60 lines, taken from fcx's `login.ts`, `messages.ts` and `writer.ts` (MIT), tested on mainnet in run 2.

PR title: `docs(hello-world): add a gasless key path through your own node`
