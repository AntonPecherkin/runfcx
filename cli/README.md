# runfcx

Your own Farcaster read node and client. No API keys.

Hand one line to your agent (Claude Code, Codex):

    Set up my Farcaster node with https://antonpecherkin.github.io/runfcx/agent.md

Or type three commands:

    npx runfcx provision --host root@YOUR_IP --data-dir /mnt/fcx
    npx runfcx node
    npx runfcx login --wallet

The server: a Vultr box (4 CPU, 16 GB, 1000 GB disk). New accounts get $300 credit through our
referral link: https://www.vultr.com/?ref=9929634-9J · Setup, 10 minutes:
https://antonpecherkin.github.io/runfcx/server.html#vultr

Then `runfcx feed`, `runfcx cast "gm"`, `runfcx like <hash>`, `runfcx follow @name`, `runfcx clients`.

Tutorial: https://antonpecherkin.github.io/runfcx/ · Source: https://github.com/AntonPecherkin/runfcx · MIT

Made by [@aap](https://farcaster.xyz/aap) on Farcaster.
