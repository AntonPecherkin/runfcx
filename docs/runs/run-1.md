# Run 1: Vultr, host mode (in progress)

Started 2026-10-19 04:03 UTC. Server `vx1-g-4c-16g` (4 dedicated vCPU, 16 GB), New York, Ubuntu 24.04.
Boot disk: 1000 GB bootable block storage (resize to 1600 GB requested from support).
Installed with `fcx provision --host` (state written by hand: host check needs 1400 GB) and `fcx node`.

## What broke and what we fixed
- Keep mode on a fresh install: upstream `snapchain.sh` can't pick an auto-upgrade day before the node
  has a peer ID and exits before starting the node. Fixed in `node-setup.sh` (3b7c67d).
- The install script then waited out its whole timeout. Fixed: stops when the installer exits.
- Vultr's Ubuntu image has `ufw` on, which blocks gossip on 3382/udp. Fixed: opened when ufw is active.
- New Vultr accounts can't create a 1.5 TB volume until support raises the block storage limit.

## Disk ran out (08:28 UTC)
Shard 1 finished; shard 2 had 2208 of 2648 chunks when the 1000 GB disk filled. The node panicked
(`No space left on device`, main.rs:422) and Docker kept restarting it until we stopped it.

Measured on disk at that moment:

| what | size |
|---|---|
| shard 1 chunks (2672) | 222 GB |
| shard 1 `.tar` | 261 GB |
| shard 1 unpacked (`.rocks/shard-1`) | 261 GB |
| shard 2 chunks so far (2208) | 180 GB |
| total | 938 GB |

Staging is deleted only after every shard is unpacked, so one large shard costs about 744 GB
(chunks + tar + unpacked). Two large shards plus shard 0 put the peak near 1.6 TB.
The 1.5 TB figure in the README is too small; 2 TB works.

## Finishing the restore by hand (09:21–10:35 UTC)
Shard 1 was already unpacked, so its 222 GB of chunks and 261 GB `.tar` were leftovers. We deleted them
(443 GB free), downloaded the rest of shard 2, and streamed every chunk straight into `tar -x`
(`gunzip -c chunk_* | tar -x -C .rocks`). No `.tar` file is written, so a shard needs only its chunks
plus its unpacked size. Shard 0's snapshot had been replaced overnight (the old one returned 404,
snapchain#1044), so it came from the new `latest.json`.

| step | time |
|---|---|
| shard 2: last 441 chunks | 16 min |
| shard 2: stream-unpack, 259 GB | 38 min |
| shard 0: 371 chunks | 15 min |
| shard 0: stream-unpack, 37 GB | 5 min |

Result: shard 0 37 GB, shard 1 261 GB, shard 2 259 GB, 557 GB total on a 1000 GB disk.
The node started at 10:37 and began catching up: 19,230 / 84,353 / 103,100 blocks behind on shards 0 / 1 / 2.

```fcx-term status-syncing
$ fcx status
Phase:  syncing
Behind: 103161 blocks
Disk:   571 GB used, 327 GB free
RAM:    1 GB used
```

## Numbers so far
Prices are Vultr list prices for the recommended setup (2 TB NVMe block storage at $0.10/GB-month ≈ $0.27/h). This run used a 1000 GB disk. Times are filled in when each phase ends.

```fcx-numbers
provider=vultr plan=vx1-g-4c-16g server_usd_h=0.12 disk_usd_h=0.27 hourly_usd=0.39 shard1_chunks_gb=222 shard1_tar_gb=261 shard1_unpacked_gb=261 peak_disk_est_gb=1600 steady_disk_gb=557 stream_unpack_shard2_min=38
```

## Terminal

```fcx-term status-downloading
$ fcx status
Phase:  downloading
Shard:  1  chunk 1156/2672  ETA 0h56m
Disk:   108 GB used, 790 GB free
RAM:    0 GB used
```
