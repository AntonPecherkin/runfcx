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

## Numbers so far
Prices are Vultr list prices for this plan. Times are filled in when each phase ends.

```fcx-numbers
provider=vultr plan=vx1-g-4c-16g server_usd_h=0.12 disk_usd_h=0.22 hourly_usd=0.34
```

## Terminal

```fcx-term status-downloading
$ fcx status
Phase:  downloading
Shard:  1  chunk 1156/2672  ETA 0h56m
Disk:   108 GB used, 790 GB free
RAM:    0 GB used
```
