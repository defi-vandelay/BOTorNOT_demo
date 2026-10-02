# BOT or NOT

A Turing-test game: chat with a stranger for two minutes, then call it. Were they a human, or an AI?

Wooo!

This repo is the **testnet demo**. It is built in milestones (see [`docs/technical-plan.md`](docs/technical-plan.md)):

| Milestone                 | What it adds                                                                  | Status |
| ------------------------- | ----------------------------------------------------------------------------- | ------ |
| M0 Skeleton               | Monorepo, shared game rules, server and web app shells, contracts project, CI | ✅     |
| M1 Playable off-chain     | Matchmaking, chat rounds, a first bot, result screen with fairness check      | ✅     |
| M2 Bot quality and safety | Personas, human-like typing, moderation, stats                                | ✅     |
| M3 On-chain               | Base Sepolia contracts, wallet sign-in, settlement                            |        |
| M4 Hosted                 | Deployed web app and server                                                   |        |

## Layout

```
apps/server         Node.js game server (WebSockets, matchmaking, bots)
apps/web            Next.js web app
packages/shared     Game constants, message protocol, commitment hashing
packages/contracts  Solidity contracts (Foundry tests, solc-js compile and deploy scripts)
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

**Stats:** http://localhost:3000/stats shows rounds played, the human/bot split, how often bots and humans fooled people, the fool rate of each bot persona and the payout pools. The raw numbers are at http://localhost:8787/stats and http://localhost:8787/pool.

**Saved data:** points, payout pools and stats are kept in `apps/server/data/botornot.db` (SQLite, built into Node 22.13+, so nothing to install), so they survive a restart. Delete the file to start fresh. Node prints a one-line "SQLite is an experimental feature" warning at startup; that's expected.

**On-chain (Base Sepolia):** with `GAME_VAULT_ADDRESS` set in `apps/server/.env`, players who sign in with a Base Account (a passkey smart wallet, nothing to install) stake test tokens (tBON) instead of points, and guests play free. One-time setup:

1. In `apps/server/.env`, set `OPERATOR_PRIVATE_KEY` to a fresh testnet-only key with some Base Sepolia ETH, and `PAYMASTER_URL` to your Coinbase Developer Platform paymaster (Base Sepolia).
2. `pnpm deploy:testnet` compiles and deploys `GameToken` (tBON, with a free daily faucet) and `GameVault`, and saves `GAME_VAULT_ADDRESS` to `apps/server/.env`. No Foundry needed.
3. Add the two printed contract addresses to the paymaster's contract allowlist, then `pnpm dev`.

In the lobby, a signed-in player taps **Get 1,000 free tBON and start playing**: one batched, gas-free transaction claims tokens, deposits them and starts a 7-day session that lets the server stake for them. After each round the server settles the call on-chain (the contract recomputes the commitment from the reveal and moves the stake), and when the pool closes it pays out right callers. Results link to the transactions on Basescan. The payout rules are the same as for points, now in `GameVault.sol`.

`.env` files are git-ignored. **Never commit keys**: this repository is public.

## Checks

```bash
pnpm lint
pnpm typecheck
pnpm test             # TypeScript tests
pnpm format:check

pnpm compile:contracts   # recompiles contracts, refreshes packages/shared/src/abi.ts

cd packages/contracts
pnpm deps             # once: downloads forge-std into lib/
forge test
```
