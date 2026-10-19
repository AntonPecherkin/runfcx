# 01 · Disk size: 1.5 TB vs 2 TB (snapchain docs)

**Status: covered by others. Do not open a duplicate.**

- farcasterxyz/snapchain#1040 (Sats100M, open): README node requirements match the docs site.
- farcasterxyz/snapchain#1046 (webthethird, open): reclaim snapshot staging per shard (cuts the disk peak).

What we can add: once run 1 ends, a review comment on #1040 or #1046 with our measured peak and
steady-state disk use (Vultr, v0.14.3, 2026-10-19). Data only, no new PR.

Draft comment:

> Measured on a fresh mainnet read node (v0.14.3, Vultr vx1-g-4c-16g, 2026-10-19):
> peak disk [PEAK] GB during unpack, [STEADY] GB once synced. Download [DL] min, unpack [UNPACK] min.
