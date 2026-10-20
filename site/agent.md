# Run your own Farcaster node with fcx

You are helping a person run their own Farcaster read node and client with `fcx`.
The node runs on a rented server. The client runs on this machine. No API keys.

## Rules

1. **Never ask for, read, print or repeat a seed phrase or a server token.** If the person pastes one, tell them to delete it from the chat and to treat that account as exposed.
2. **The person runs `fcx login` themselves.** It needs a human at the keyboard and refuses to run for you.
3. **Never post, like, recast or follow without the person's OK in this conversation**, for that exact action and text.
4. **State the cost and the auto-delete time before you rent anything**, and wait for a yes.
5. **Before you stop**, say when the server deletes itself, or run `fcx destroy --yes` if the person asks.

## 1. Check the machine

```bash
node --version      # needs v20 or newer
ssh -V              # any OpenSSH
```

Ask which server the person wants:

- **Hetzner** (scripted, deletes itself). Check the token file exists. Only check that it exists: never open it.
  ```bash
  test -f ~/.config/fcx/hcloud-token && echo "token present"
  ```
  If it is missing, send the person to https://antonpecherkin.github.io/fcx-cli/server.html#hetzner and wait.
- **Vultr or their own box.** They set up the server by hand: https://antonpecherkin.github.io/fcx-cli/server.html#vultr. Ask them for the IP.

## 2. Confirm the cost

Tell the person, in one message:

> This rents a 4-CPU, 16 GB server with a 1000 GB disk. It costs about $0.26 an hour on our test run, and the sync takes a few hours. With Hetzner it deletes itself after 8 hours. OK to start?

Wait for a yes.

## 3. Rent the server

```bash
npx runfcx provision --ttl 8h                                  # Hetzner
npx runfcx provision --host root@<IP> --data-dir /mnt/fcx     # Vultr or own box
```

## 4. Start the node

```bash
npx runfcx node --no-wait
```

Then check every 5 minutes:

```bash
npx runfcx status --json
```

After each check, tell the person one line: phase, progress and ETA. For example: `downloading · shard 1 · 1240/2672 · ETA 53m`.

### Reading status

| phase | what it means | what you do |
|---|---|---|
| `installing` | Docker and the node are being installed | wait |
| `starting` | the node process is starting | wait |
| `downloading` | snapshot chunks are downloading; `chunk`/`chunks` and `eta` show progress | wait, report progress |
| `unzipping` | the snapshot is being unzipped | wait; disk use peaks here |
| `unpacking` | the snapshot is being unpacked into the database; `shard` says which | wait |
| `restore_failed` | fcx's snapshot restore stopped; `detail` says why (often: not enough disk) | show the person `detail`; after a fix, `npx runfcx node` resumes where it stopped |
| `running` | the node runs but its API doesn't answer yet | wait |
| `syncing` | catching up block by block; `max_block_delay` falls toward 0 | wait |
| `ready` | synced, within 10 blocks | go to step 5 |
| `disk_full` | under 5 GB free | stop; tell the person the disk is too small (see Errors) |
| `shard_from_genesis` | a shard skipped its snapshot and syncs from block 1 | stop; send the person to https://github.com/farcasterxyz/snapchain/issues/1044 |
| `stopped` | the node isn't running | run `npx runfcx node` again |
| `error` | the status check failed on the server; see `detail` | run `npx runfcx node` again; if it repeats, show the person `detail` |

If `ssh` is `blocked`, the person's IP probably changed. Run `npx runfcx allow-ip` (Hetzner only), or ask them to update their firewall.

## 5. Hand over the login

Send exactly this, then wait:

> Your node is ready. Please run this in your own terminal:
> `npx runfcx login --wallet`
> It opens a page for your browser wallet and asks for two signatures. No gas. Tell me when it says "Logged in".

If they have no browser wallet holding the account's custody key, they can run `npx runfcx login` and type the recovery phrase themselves, in their own terminal. Remind them to use a test account.

## 6. Check it worked

```bash
npx runfcx whoami --json
```

## 7. Show it off

Ask before each write. Show the exact text first.

```bash
npx runfcx feed --limit 5
npx runfcx clients
npx runfcx cast "<text the person approved>"
npx runfcx like <hash from the feed>
npx runfcx follow @<name>
```

## 8. Finish

Tell the person when the server deletes itself (`npx runfcx status`). If they want it gone now and say so: `npx runfcx destroy --yes`.

## Errors

| message (start) | cause | fix |
|---|---|---|
| No server yet. Run: fcx provision | no run on this machine | step 3 |
| No Hetzner token. | token file missing | person creates it: server.html#hetzner |
| Run '<name>' exists. Use it, or delete it first: fcx destroy | a run is already set up | use it, or `fcx destroy` with the person's OK |
| This Hetzner project already has fcx resources. Delete them in the console, or use another project. | leftovers from an earlier run | person deletes them in the Hetzner console |
| Bad --name '<x>'. Use a-z, 0-9 and '-'. | invalid name | fix the flag |
| Bad --host '<x>'. Use user@hostname. | invalid host | fix the flag |
| Bad --data-dir '<x>'. Use an absolute path | invalid path | fix the flag |
| bad TTL '<x>'. Use 90m, 8h, 2d or 0. | invalid TTL | fix the flag |
| This server does not meet the requirements above. | under 4 CPU, 15 GB RAM or 800 GB free disk (fcx's streamed restore peaks near 780 GB: 557 GB final plus one shard's chunks) | person picks a bigger server or disk |
| Server did not accept SSH in time. | server still booting, or firewall blocks SSH | wait 2 min and retry; check the firewall allows the person's IP |
| Could not install auto-destroy on the server. Delete it now: fcx destroy | token push failed | `fcx destroy` with the person's OK |
| Could not reach the server. Run: fcx allow-ip | SSH blocked | `fcx allow-ip` |
| ssh-keygen failed: | no OpenSSH | person installs OpenSSH |
| scp failed: | SSH problem | check `fcx status`; retry |
| Node install failed. See the lines above. | upstream installer failed | show the person the lines; retry `fcx node` once |
| Disk is full. Run: fcx status | disk too small | person grows the disk, then `fcx node` |
| Snapshot restore stopped: | the restore hit a problem it can't fix itself; the rest of the message says which | show the person the message; after a fix, `npx runfcx node` resumes the restore |
| Only trial runs on Hetzner have a TTL. | `extend` on a host run | nothing to extend |
| This run was created with --keep. It has no auto-destroy. Delete it with: fcx destroy | `extend` on a keep run | nothing to extend |
| Only for Hetzner runs. Update your own firewall. | `allow-ip` on a host run | person updates their firewall |
| No firewall found for run '<name>'. | firewall deleted by hand | person checks the Hetzner console |
| Could not stop the node on <host>: | SSH or Docker failed during destroy | retry; person deletes the server by hand |
| Server or volume still there (<ids>). Run fcx destroy again, or check the Hetzner console. | deletion not finished | run `fcx destroy --yes` again |
| Add --yes to confirm. | destroy without a terminal | add `--yes`, only with the person's OK |
| Can't reach your node. Run: fcx status | tunnel or node down | `fcx status`; wait if still syncing |
| Your node is still syncing. Run: fcx status | not synced yet | wait for `ready` |
| Your node did not answer in time. Run: fcx status | node busy or tunnel stalled | retry in a minute |
| Not logged in. Run: fcx login --wallet | no app key on this machine | step 5 |
| <address> is not the custody address of any FID. | wrong seed phrase or wallet | person checks the account |
| This wallet (<address>) is not the custody address of any FID. | wallet doesn't hold the custody key | person switches wallet account, or uses seed mode with a test account |
| FID <n> has no storage. It needs storage rent before it can post. | account has no storage | person rents storage in the Farcaster app |
| You rejected the request in your wallet. Nothing was added. | person clicked Reject | ask them to run login again |
| That is not a valid 12/24-word seed phrase. | typo in the phrase | person retries; never ask to see it |
| Your node doesn't see this app key. Is it synced? Run: fcx status. To delete the local key anyway: fcx logout --forget | node not synced, or key already gone | wait for `ready`; `--forget` only with the person's OK |
| Sent the <action> 3 times. Your node never showed it. Is it synced? Run: fcx status | write never landed | check `fcx status`; retry later |
| Your node rejected the <action>: | invalid message (often: key expired or wrong scope) | show the person the reason; `fcx login` again if the key expired |
| Cast is too long (<n> bytes, max 320). | text over 320 bytes | shorten it with the person |
| Cast prefix '<x>' matches more than one cast. Use more characters. | short hash is ambiguous | use more characters |
| Unknown cast '<x>'. Use <fid>/<hash> or a hash from fcx feed. | hash not in the last feed | run `fcx feed` first, or use fid/hash |
| No user '@<name>' on your node. | name not found | check spelling; use the FID |
| --only-client needs an app FID, e.g. 9152. | flag needs a number | pass a number |
| Usage: | missing argument | see `npx runfcx help` |
