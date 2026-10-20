# runfcx

Your own Farcaster read node and client. No API keys.

Hand one line to your agent (Claude Code, Codex):

    Set up my Farcaster node with https://antonpecherkin.github.io/fcx-cli/agent.md

Or type three commands:

    npx runfcx provision --host root@YOUR_IP --data-dir /mnt/fcx
    npx runfcx node
    npx runfcx login --wallet

The server: a Vultr box (4 CPU, 16 GB, 1000 GB disk). New accounts get $300 credit through our
referral link: https://www.vultr.com/?ref=9929634-9J · Setup, 10 minutes:
https://antonpecherkin.github.io/fcx-cli/server.html#vultr

Then `fcx feed`, `fcx cast "gm"`, `fcx like <hash>`, `fcx follow @name`, `fcx clients`.

Tutorial: https://antonpecherkin.github.io/fcx-cli/ · Source: https://github.com/AntonPecherkin/fcx-cli · MIT
