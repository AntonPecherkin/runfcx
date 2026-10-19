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

## Numbers so far
Prices are Vultr list prices for the recommended setup (2 TB NVMe block storage at $0.10/GB-month ≈ $0.27/h). This run used a 1000 GB disk. Times are filled in when each phase ends.

```fcx-numbers
provider=vultr plan=vx1-g-4c-16g server_usd_h=0.12 disk_usd_h=0.27 hourly_usd=0.39 shard1_chunks_gb=222 shard1_tar_gb=261 shard1_unpacked_gb=261 peak_disk_est_gb=1600
```

## Terminal

```fcx-term status-downloading
$ fcx status
Phase:  downloading
Shard:  1  chunk 1156/2672  ETA 0h56m
Disk:   108 GB used, 790 GB free
RAM:    0 GB used
```
