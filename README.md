# BOT or NOT

A Turing-test game: chat with a stranger for two minutes, then call it. Were they a human, or an AI?

Wooo!

This repo is the **testnet demo**. It is built in milestones (see [`docs/technical-plan.md`](docs/technical-plan.md)):

| Milestone                 | What it adds                                                                  | Status |
| ------------------------- | ----------------------------------------------------------------------------- | ------ |
| M0 Skeleton               | Monorepo, shared game rules, server and web app shells, contracts project, CI | ✅     |
| M1 Playable off-chain     | Matchmaking, chat rounds, a first bot, result screen with fairness check      | ✅     |
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

Open http://localhost:3000 and press **Find a match**.

Without an `ANTHROPIC_API_KEY` the server uses a mock bot with canned replies, so everything runs offline. With a key, bots are played by Claude (`BOT_MODEL` in `apps/server/.env`).

**Playing yourself:** open two browser windows and press Find a match in both. Each match is a bot half the time, so to force the two windows to meet, set `BOT_SHARE=0` in `apps/server/.env` and restart. A window with no human free gets a bot anyway, as in the real game.

**Simulated players:** with the server running, `pnpm sim` (in a second terminal) connects four simulated players that chat, call and requeue like people do: some honest, some "tricksters" who act like bots to fool their partner, some sharp judges. Press Find a match in your browser and you'll meet them (or a house bot). Options: `pnpm sim --players 8`, `pnpm sim --styles trickster`. With an `ANTHROPIC_API_KEY` they talk using `SIM_MODEL` (Claude Haiku by default); without one they send canned lines and call at random. The simulator only connects to a local server, and dev mode (which it needs) can't be switched on in production.

**Points and payout pools:** every call stakes 100 points (new players start with 1,000). Calls settle together when the payout pool closes (every 10 minutes; set `EPOCH_MS=60000` to watch it faster): wrong calls forfeit their stake, 5% is the fee, 25% goes to a human partner who fooled the caller, and the rest is split between right calls. The rules are in `packages/shared/src/settlement.ts`; http://localhost:8787/pool shows the current pool and the daily pool.

**Bots:** 20 personas (three of them "tricksters" who joke about being bots, like the human tricksters do), each aware of their local time and a few of today's headlines. Every bot turn goes through a policy layer: the partner's message and the bot's reply are both screened by `MODERATION_MODEL`; anything flagged gets a natural brush-off instead, and a message suggesting the player may be at risk ends the round with a support message (and a refund).

**Safety and AI-judge checks** (need `ANTHROPIC_API_KEY`):

- `pnpm --filter @botornot/server red-team` sends the prompts in `apps/server/src/bots/redteam.ts` (jailbreaks, offensive asks, personal data, crisis messages, classic bot tests) through the bot pipeline and marks anything to check by hand.
- `pnpm --filter @botornot/server judge-experiment --judges 5 --rounds 4` has AI judges (`JUDGE_MODEL`) play the house bots and reports how often they spot them. Takes about 10 minutes.

**Stats:** http://localhost:8787/stats shows rounds played, the human/bot split and how often the bot fooled people (in memory until M2 adds a database).

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
