# Run 2: the client against mainnet

2026-10-20, laptop → SSH tunnel → the run-1 read node on Vultr (synced, 0–1 blocks behind).
Account: @aap (FID 381353), custody key imported into MetaMask for the login only, then removed.

## Login
`fcx login --wallet`: two EIP-712 signatures in MetaMask ("Farcaster KeyAdd" domain), gasless `KEY_ADD`
submitted through our own node, confirmed via `/v1/signer`.

```fcx-term whoami
$ fcx whoami
@aap (FID 381353), app key 0x1d071c05…, added 2026-10-20
```

What we learned:
- The first try used a wallet address that is only *verified* on the account. Only the custody
  address can approve a key. fcx said so: "is not the custody address of any FID".
- `onChainIdRegistryEventByAddress` takes ~22 s on mainnet (it scans every shard). The 10 s read
  timeout cut it off; fixed with a 60 s timeout for that call (079f40c).

## Reads

```fcx-term feed
$ fcx feed --limit 3
@greg · 1m · via @greg · 0x8ae98f90
  oh so we're time traveling now?

@aap · 1m · via @aap · 0x26d5d85b
  Posted from my own Farcaster node. No API keys, no hub provider: a read node on a rented server and a gasless app key. Building it here: antonpecherkin.github.io/fcx-cli

@velveteen · 12m · via @warpcast · reply · 0x66d3c8f4
  I knew painting dinosaurs in space was the right move!!
```

```fcx-term clients
$ fcx clients
  87  @warpcast (fid 9152)
   9  @fireflyapp (fid 16823)
   3  @cassie (fid 1325)
   1  @greg (fid 347)
```

- Feed over 210 follows: 32 s cold, 17–20 s warm (signer and name caches).
- `--only-client 9152` / `--exclude-client 9152` split the feed as expected.
- `castsByFid` returns `CAST_REMOVE` messages too; `fcx clients` crashed on one. Fixed (feed skips them).

## Writes (each confirmed on the node, first try)

| command | tries | time |
|---|---|---|
| `fcx cast "…"` | 1 | 8 s |
| `fcx like` + `fcx unlike` | 1 + 1 | 16 s |
| `fcx follow 1` + `fcx unfollow 1` | 1 + 1 | 17 s |

The cast shows `via @aap`: an fcx key names the user's own FID as the requesting app.

```fcx-numbers
provider=vultr feed_cold_s=32 feed_warm_s=20 cast_s=8 cast_tries=1 login_lookup_s=22
```
