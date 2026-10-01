/** Game rules shared by the web app, the server and (mirrored) the contracts. */

/** Length of the whole chat. */
export const CHAT_DURATION_MS = 120_000;
/** Time to write one message; when it runs out the turn passes to the partner. */
export const TURN_MS = 20_000;
/** Longest message a player or bot can send. */
export const MAX_MESSAGE_CHARS = 100;
/** Time to choose BOT or NOT once the chat ends. */
export const CALL_WINDOW_MS = 10_000;

/** Share of matches the operator aims to fill with a bot. */
export const BOT_TARGET_SHARE = 0.5;
/** Queue waits are drawn from this range for every match, human or bot, so wait time is not a tell. */
export const QUEUE_WAIT_MIN_MS = 3_000;
export const QUEUE_WAIT_MAX_MS = 12_000;

/** Demo stake tier: 1 USDC (6 decimals). */
export const STAKE_UNITS = 1_000_000n;
/** House rake on each payout pool, in basis points. */
export const RAKE_BPS = 500;
/** Length of a payout pool. */
export const EPOCH_MS = 600_000;

export const PARTNER_TYPE = { HUMAN: 0, BOT: 1 } as const;
export type PartnerType = keyof typeof PARTNER_TYPE;

export type Call = 'BOT' | 'NOT';
