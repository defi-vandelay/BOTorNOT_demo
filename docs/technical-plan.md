# BOT or NOT: Technical Plan (demo)

_Follows the decisions in plan step 4 (`plan/04-recommendation.md` in the project files). This is the build reference for milestones M0 to M4. Anything not covered here follows the simplest option that keeps the [fairness rules](#6-commit-reveal) intact._

---

## 1. Repository layout

```
botornot_demo/
├─ apps/
│  ├─ server/              Node.js + TypeScript game server (one process)
│  │  └─ src/
│  │     ├─ index.ts        boot: config, db, http + ws
│  │     ├─ config.ts       env parsing (zod)
│  │     ├─ http.ts         /health, /stats (JSON)
│  │     ├─ ws/gateway.ts   connections, message parsing, routing
│  │     ├─ game/
│  │     │  ├─ matchmaker.ts   queue, human/bot decision, randomised waits
│  │     │  ├─ round.ts        round state machine and timers
│  │     │  └─ commit.ts       salts, commitments, signed receipts
│  │     ├─ bots/
│  │     │  ├─ personas.ts     persona type, loader, picker
│  │     │  ├─ context.ts      time/date/headlines for the persona
│  │     │  ├─ humanizer.ts    typing delay, casing, typos
│  │     │  ├─ policy.ts       moderation routing, deflections, break-glass
│  │     │  └─ runtime.ts      plays the bot's turns in a round
│  │     ├─ llm/
│  │     │  ├─ gateway.ts      LlmGateway interface + factory
│  │     │  ├─ anthropic.ts    Claude provider
│  │     │  └─ mock.ts         deterministic provider for tests / no key
│  │     ├─ db/                Drizzle schema + SQLite client
│  │     └─ chain/             (M3) viem clients, settlement worker
│  ├─ web/                 Next.js app (lobby, play, result, stats)
├─ packages/
│  ├─ shared/              constants, WebSocket protocol (zod), commitment + transcript hashing
│  └─ contracts/           Foundry project: GameVault, MockUSDC, tests, deploy script
├─ docs/                   this plan and later design notes
└─ .github/workflows/ci.yml
```

Tooling: pnpm workspaces, TypeScript (strict), ESLint (flat config) + Prettier, Vitest, Foundry. Node 22.

## 2. Game constants (`packages/shared/src/constants.ts`)

| Constant            | Value              | Notes                                              |
| ------------------- | ------------------ | -------------------------------------------------- |
| `CHAT_DURATION_MS`  | 120 000            | whole chat                                         |
| `TURN_MS`           | 20 000             | per message; timeout passes the turn               |
| `MAX_MESSAGE_CHARS` | 100                | enforced client and server side                    |
| `CALL_WINDOW_MS`    | 10 000             | to choose BOT or NOT                               |
| `BOT_TARGET_SHARE`  | 0.5                | operator ratio                                     |
| `QUEUE_WAIT_MS`     | 3 000 to 12 000    | random wait, same distribution for humans and bots |
| `STAKE`             | 1 USDC (1e6 units) | one tier                                           |
| `RAKE_BPS`          | 500                | 5%                                                 |
| `EPOCH_MS`          | 600 000            | 10-minute payout pools                             |

## 3. Round lifecycle

```
QUEUED ─match─▶ MATCHED ─receipt sent─▶ CHAT ─2 min─▶ CALL ─10 s─▶ REVEAL ─▶ SETTLED
                                         │                                   ▲
                                         └── human disconnect ──▶ VOID (refund) ┘
```

- **Who starts** is random. A turn ends when the player sends a message or after `TURN_MS` (the turn passes).
- **Bots** take a turn like a player: read delay → typing indicator → message, all inside `TURN_MS`.
- **Human disconnect** during CHAT voids the round for both sides (refund). A bot never disconnects except through the policy layer's "leave" deflection, which also voids and refunds.
- **No call** in the window = refund (demo rule).

## 4. WebSocket protocol (`packages/shared/src/protocol.ts`)

JSON messages, validated with zod on both ends. The server never sends anything that differs between human and bot rounds until REVEAL.

**Client → server**

| type          | fields                                               | when                     |
| ------------- | ---------------------------------------------------- | ------------------------ |
| `hello`       | `address` (guest key or wallet), `sessionAuth?` (M3) | on connect               |
| `queue.join`  | none                                                 | lobby                    |
| `queue.leave` | none                                                 | lobby                    |
| `chat.typing` | none                                                 | while typing (throttled) |
| `chat.send`   | `text` (1 to 100 chars)                              | on your turn             |
| `call.submit` | `call`: `BOT` or `NOT`                               | CALL phase               |

**Server → client**

| type            | fields                                                                                                                         |
| --------------- | ------------------------------------------------------------------------------------------------------------------------------ |
| `welcome`       | `playerId`                                                                                                                     |
| `queue.waiting` | none                                                                                                                           |
| `match.found`   | `roundId`, `receipt` (`commit`, `issuedAt`, `signature`), `youStart`, `chatEndsAt`                                             |
| `turn`          | `yours`, `endsAt`                                                                                                              |
| `chat.typing`   | none (partner is typing)                                                                                                       |
| `chat.message`  | `from` (`you` or `partner`), `text`, `at`                                                                                      |
| `call.open`     | `endsAt`                                                                                                                       |
| `round.result`  | `answer` (`HUMAN` or `BOT`), `partnerId`, `salt`, `yourCall`, `correct`, `persona?` (name, blurb), `transcriptHash`, `txHash?` |
| `round.void`    | `reason`                                                                                                                       |
| `error`         | `message`                                                                                                                      |

## 5. Data model (SQLite via Drizzle; Postgres in the beta)

| Table          | Key columns                                                                                                                |
| -------------- | -------------------------------------------------------------------------------------------------------------------------- |
| `players`      | `id`, `address`, `created_at`                                                                                              |
| `rounds`       | `id` (bytes32 hex), `kind` (`HUMAN`/`BOT`), `persona_id?`, `status`, `started_at`, `ended_at`, `transcript_hash`           |
| `round_judges` | `round_id`, `player_id`, `address`, `partner_id`, `salt`, `commit`, `call?`, `correct?`, `stake`, `epoch_id`, `settle_tx?` |
| `messages`     | `round_id`, `seq`, `sender` (`A`/`B`/`BOT`), `text`, `at`, `chain_hash`                                                    |
| `personas`     | `id`, `json`, `active`, `rounds`, `fooled`                                                                                 |

Salts live in `round_judges` until reveal. That is acceptable on testnet; production moves them to a KMS and deletes them after settlement.

## 6. Commit-reveal

**Commitment** (computed in `packages/shared/src/commitment.ts`, mirrored in Solidity):

```
commit = keccak256(abi.encode(bytes32 roundId, address judge, uint8 partnerType, bytes32 partnerId, bytes32 salt))
partnerType: 0 = HUMAN, 1 = BOT
partnerId:   other judge's address (left-padded) for HUMAN, keccak256(personaId) for BOT
salt:        32 random bytes per judge per round
```

**Receipt** (sent in `match.found`, before the first message): EIP-712 typed data signed by the operator key.

```
domain  = { name: "BOTorNOT", version: "1", chainId, verifyingContract: GameVault }
Commitment(bytes32 roundId, address judge, bytes32 commit, uint256 stake, uint64 issuedAt)
```

**Reveal**: `round.result` carries `partnerType`, `partnerId`, `salt`; the web app recomputes the hash in the browser and shows ✓ or ✗ ("Verify" button). The settle transaction (M3) stores the same values on-chain.

**Transcript hash chain**: `h0 = keccak256(roundId)`, `h(n) = keccak256(abi.encode(h(n-1), senderTag, keccak256(text), at))`. The final hash is in `round.result` and in the settle transaction.

**What is deliberately not on-chain before the chat**: nothing. This avoids the commitment-count leak (risk doc §2.4).

## 7. Bots

**Persona** (JSON): `id, name, age, location, timezone, job, personality, interests[], writingStyle { lowercase, typoRate, emojiRate, slang[] }, backstory`. Twenty hand-written to start; a generator script later.

**Prompt** (system prompt, stable so it caches): who you are (persona), the game situation (a 2-minute text chat with a stranger, short casual messages, never more than 100 characters), rules (never say or hint you are an AI, don't be helpful like an assistant, it's fine to be bored, vague or a bit rude, ask questions back), and the deflection rule (if asked for something offensive, illegal or weird, brush it off like a person would; never comply). Volatile context (local time, a couple of headlines) and the transcript go in `messages`.

**Turn pipeline** (`runtime.ts`):

1. Input check: the partner's last message goes through `policy.classify()`; flagged → deflection (no generation).
2. Generate: `llm.reply()` with persona prompt + transcript. A refusal or empty output → deflection.
3. Output check: `policy.classify()` on the reply; flagged → deflection.
4. Humanize: trim to 100 chars, apply casing/typos/slang per persona.
5. Timing: read delay 1 to 3 s, typing indicator, typing time ~ length × 120 to 250 ms, all capped below `TURN_MS − 1.5 s`.

**Break-glass**: if the classifier flags self-harm or crisis, the round is voided and the player sees a support message. No in-character reply is sent.

**LLM gateway** (`llm/gateway.ts`): `reply({system, messages, maxTokens}) → string | null` and `classify(text) → {flagged, category}`. Providers: `anthropic` (default model `claude-opus-5-5` at low effort, server-side refusal fallback enabled; set `BOT_MODEL=claude-haiku-4-5` for a cheaper, faster option) and `mock` (canned replies, used in tests and when no API key is set).

## 8. Contracts (`packages/contracts`, M3)

One contract for the demo, **`GameVault`**:

| Function                                              | Who                          | What                                                                                                                                                                                                                                                                           |
| ----------------------------------------------------- | ---------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `deposit(amount)`                                     | player                       | pulls USDC into the player's balance                                                                                                                                                                                                                                           |
| `withdraw(amount)`                                    | player                       | returns unlocked balance                                                                                                                                                                                                                                                       |
| `settleRound(Result r, SessionAuth a, bytes authSig)` | operator                     | checks the player's session authorisation (ERC-1271 for smart wallets), recomputes the commitment from the reveal, moves the stake into the epoch pool, records the call and whether it was right, emits `RoundSettled(roundId, judge, commit, transcriptHash, call, correct)` |
| `closeEpoch(epochId)`                                 | anyone, after the epoch ends | pays winners pro rata from the pool minus rake; refunds everyone if all were right or all wrong                                                                                                                                                                                |
| `setOperator`, `setTreasury`, `pause`                 | owner                        | admin                                                                                                                                                                                                                                                                          |

`SessionAuth(address player, address operator, uint256 maxStake, uint256 maxTotal, uint64 expiry, uint256 nonce)` is the one signature a player gives at login. M0 ships `GameVault` with deposit and withdraw only, plus `MockUSDC` and tests.

## 9. Web app (`apps/web`)

| Route    | Content                                                                                                                                        |
| -------- | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| `/`      | Lobby: how to play, "Find a match", connection status, (M3) wallet + balance                                                                   |
| `/play`  | Waiting → chat (turn timer, 100-char input, typing indicator) → call (BOT / NOT, 10 s) → result (answer, persona card if bot, verify, tx link) |
| `/stats` | Rounds, human/bot split, fool rate per persona, fallbacks                                                                                      |

Guest identity until M3: a random key generated in the browser and kept in localStorage; its address is the judge address in commitments.

## 10. Configuration

| Variable                                                                     | App         | Milestone |
| ---------------------------------------------------------------------------- | ----------- | --------- |
| `PORT`, `WEB_ORIGIN`, `DATABASE_PATH`                                        | server      | M0        |
| `LLM_PROVIDER` (`anthropic`/`mock`), `ANTHROPIC_API_KEY`, `BOT_MODEL`        | server      | M1        |
| `OPERATOR_PRIVATE_KEY` (testnet only; a dev key is generated if unset)       | server      | M1        |
| `CHAIN_ID`, `RPC_URL`, `GAME_VAULT_ADDRESS`, `USDC_ADDRESS`, `PAYMASTER_URL` | server, web | M3        |
| `NEXT_PUBLIC_SERVER_WS_URL`, `NEXT_PUBLIC_CDP_API_KEY`                       | web         | M1 / M3   |

## 11. Testing

- **shared**: commitment and hash-chain vectors (TypeScript and Solidity must agree; the same vector is checked in a Foundry test).
- **server**: matchmaker, round timers (fake timers), policy routing, humanizer bounds, protocol round trip with the mock LLM.
- **contracts**: Foundry unit and fuzz tests.
- **web**: typecheck and build in CI; Playwright smoke test from M1.
- **LLM-judge experiment** (M2): `pnpm --filter server judge-experiment` plays an AI judge against the house bots and prints accuracy.

## 12. Milestone task lists

**M0 Skeleton**: workspace, configs, CI; shared constants, protocol and commitment with tests; server boot with `/health` and `hello → welcome`; LLM gateway with mock and Anthropic providers; web lobby page that connects to the server; contracts project with MockUSDC and GameVault deposit/withdraw.

**M1 Playable off-chain**: matchmaker, round engine, chat relay, basic bot (one persona, no moderation yet), play page, result with verify button, dev mode for two windows.

**M2 Bot quality and safety**: 20 personas, context feed, humanizer, policy layer, deflections, break-glass, stats page, LLM-judge experiment, red-team prompt list.

**M3 On-chain**: GameVault settlement and epochs, deploy script to Base Sepolia, OnchainKit wallet, session authorisation, deposits, settlement worker, tx links.

**M4 Deploy**: Vercel (web), Fly.io or Railway (server + volume), monitoring, invite testers.
