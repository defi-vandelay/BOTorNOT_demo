# BOT or NOT

A Turing-test game: chat with a stranger for two minutes, then call it. Were they a human, or an AI?

This repo is the **testnet demo**. It is built in milestones (see [`docs/technical-plan.md`](docs/technical-plan.md)):

| Milestone                 | What it adds                                                                  | Status |
| ------------------------- | ----------------------------------------------------------------------------- | ------ |
| M0 Skeleton               | Monorepo, shared game rules, server and web app shells, contracts project, CI | ✅     |
| M1 Playable off-chain     | Matchmaking, chat rounds, a first bot, result screen with fairness check      |        |
| M2 Bot quality and safety | Personas, human-like typing, moderation, stats                                |        |
| M3 On-chain               | Base Sepolia contracts, wallet sign-in, settlement                            |        |
| M4 Hosted                 | Deployed web app and server                                                   |        |

## Layout

```
apps/server         Node.js game server (WebSockets, matchmaking, bots)
apps/web            Next.js web app
packages/shared     Game constants, message protocol, commitment hashing
packages/contracts  Solidity contracts (Foundry)
docs/               Technical plan
```

## Running locally

Requirements: Node 22+, pnpm 10 (`corepack enable`), and [Foundry](https://getfoundry.sh) for the contracts.

```bash
pnpm install
cp apps/server/.env.example apps/server/.env      # add ANTHROPIC_API_KEY here
cp apps/web/.env.example apps/web/.env.local
pnpm dev                                         # server on :8787, web on :3000
```

Without an `ANTHROPIC_API_KEY` the server uses a mock bot with canned replies, so everything runs offline.

`.env` files are git-ignored. **Never commit keys**: this repository is public.

## Checks

```bash
pnpm lint
pnpm typecheck
pnpm test             # TypeScript tests
pnpm format:check

cd packages/contracts
pnpm deps             # once: downloads forge-std into lib/
forge test
```
