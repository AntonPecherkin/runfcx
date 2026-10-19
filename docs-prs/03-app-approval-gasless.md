# 03 · Approve gasless app keys from the Farcaster app (farcasterxyz/protocol)

**Status: draft. Needs the user's OK before opening.**

Target: a new discussion in `farcasterxyz/protocol` (or a comment on the FIP-272 discussion if one exists).

Title: `Let the Farcaster app approve gasless KEY_ADD requests`

> Gasless app keys (FIP-272, live since engine V16) need two EIP-712 signatures from the custody address:
> `SignedKeyRequest` and `KeyAdd`. Most people's custody key lives inside the Farcaster app, and the app's
> signer-request flow (`POST /v2/signed-key-requests`, `farcaster://signed-key-request?token=`) still adds keys
> onchain through the Key Gateway.
>
> So a client that wants a gasless key today has to ask for the recovery phrase, or for the custody key in a
> browser wallet. Both are worse for users than a deep link they approve in the app.
>
> Proposal: a deep link that carries the `KeyAdd` fields (key, scopes, ttl, nonce, deadline) and the requesting
> app's `SignedKeyRequest`; the app shows what the key may do and returns both signatures (or submits the
> `KEY_ADD` itself). No transaction, no gas, no seed phrases.
>
> Context: we hit this building fcx, an open-source client that adds its key gasless through the user's own node.
