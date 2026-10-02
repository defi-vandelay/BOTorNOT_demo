import { z } from 'zod';
import { MAX_MESSAGE_CHARS } from './constants';

type Hex = `0x${string}`;
const hexOf = (pattern: RegExp) =>
  z.custom<Hex>((v) => typeof v === 'string' && pattern.test(v), { message: 'invalid hex' });
const hex = hexOf(/^0x[0-9a-fA-F]*$/);
const address = hexOf(/^0x[0-9a-fA-F]{40}$/);
const bytes32 = hexOf(/^0x[0-9a-fA-F]{64}$/);

// ---------- client -> server ----------

export const clientMessage = z.discriminatedUnion('type', [
  z.object({
    type: z.literal('hello'),
    address,
    /** Wallet players (on-chain mode): a signature over signInMessage(), proving the address. */
    auth: z.object({ issuedAt: z.number().int(), signature: hex }).optional(),
  }),
  /** A wallet player deposited, withdrew or started a session: re-read their on-chain state. */
  z.object({ type: z.literal('wallet.refresh') }),
  z.object({ type: z.literal('queue.join') }),
  z.object({ type: z.literal('queue.leave') }),
  z.object({ type: z.literal('chat.typing') }),
  z.object({
    type: z.literal('chat.send'),
    text: z.string().trim().min(1).max(MAX_MESSAGE_CHARS),
  }),
  z.object({ type: z.literal('call.submit'), call: z.enum(['BOT', 'NOT']) }),
]);
export type ClientMessage = z.infer<typeof clientMessage>;

// ---------- server -> client ----------

export const commitmentReceipt = z.object({
  commit: bytes32,
  issuedAt: z.number().int(),
  signature: hex,
});
export type CommitmentReceipt = z.infer<typeof commitmentReceipt>;

export const serverMessage = z.discriminatedUnion('type', [
  z.object({
    type: z.literal('welcome'),
    playerId: z.string(),
    /** Operator address that signs commitment receipts, and the EIP-712 domain it signs under. */
    operator: address,
    chainId: z.number().int(),
    verifyingContract: address,
    /**
     * What this player plays for: off-chain points (no chain configured), test tokens (signed in
     * with a wallet), or nothing (a guest while the chain is on: free play).
     */
    mode: z.enum(['points', 'tokens', 'free']),
    /** Set when the game runs on-chain. */
    onchain: z
      .object({
        vault: address,
        token: address,
        explorer: z.string(),
        /** Where the wallet asks for gas sponsorship (the Coinbase paymaster), if any. */
        paymasterUrl: z.string().optional(),
      })
      .optional(),
  }),
  z.object({ type: z.literal('queue.waiting') }),
  z.object({
    type: z.literal('match.found'),
    roundId: bytes32,
    receipt: commitmentReceipt,
    youStart: z.boolean(),
    chatEndsAt: z.number().int(),
  }),
  z.object({ type: z.literal('turn'), yours: z.boolean(), endsAt: z.number().int() }),
  z.object({ type: z.literal('chat.typing') }),
  z.object({
    type: z.literal('chat.message'),
    from: z.enum(['you', 'partner']),
    text: z.string(),
    at: z.number().int(),
  }),
  z.object({ type: z.literal('call.open'), endsAt: z.number().int() }),
  z.object({
    type: z.literal('round.result'),
    answer: z.enum(['HUMAN', 'BOT']),
    partnerId: bytes32,
    salt: bytes32,
    yourCall: z.enum(['BOT', 'NOT']).nullable(),
    correct: z.boolean().nullable(),
    persona: z.object({ name: z.string(), blurb: z.string() }).optional(),
    transcriptHash: bytes32,
    txHash: hex.optional(),
    /** When the payout pool holding this call closes; absent when nothing was staked (no call). */
    settlesAt: z.number().int().optional(),
  }),
  /** What the player can stake: points, or whole test tokens in the vault (tokens mode). */
  z.object({
    type: z.literal('balance'),
    points: z.number().int(),
    /** Tokens mode: when the player's staking session ends (unix ms; 0 = none). */
    sessionEndsAt: z.number().int().optional(),
  }),
  /** A payout pool this player had calls in has closed. */
  z.object({
    type: z.literal('epoch.settled'),
    epoch: z.number().int(),
    rightCalls: z.number().int(),
    wrongCalls: z.number().int(),
    /** Points, or whole tokens rounded to 2 decimals on-chain. */
    profitPerRight: z.number(),
    you: z.object({
      right: z.number().int(),
      wrong: z.number().int(),
      deception: z.number(),
      net: z.number(),
    }),
    dailyPool: z.number(),
    /** On-chain: the transaction that paid this pool out. */
    txHash: hex.optional(),
  }),
  /** On-chain: the transaction that settled this player's call. */
  z.object({ type: z.literal('round.settled'), roundId: bytes32, txHash: hex }),
  z.object({ type: z.literal('round.void'), reason: z.string() }),
  z.object({ type: z.literal('error'), message: z.string() }),
]);
export type ServerMessage = z.infer<typeof serverMessage>;

/** Parse a raw WebSocket frame; returns null for anything malformed. */
export function parseClientMessage(raw: string): ClientMessage | null {
  try {
    const result = clientMessage.safeParse(JSON.parse(raw));
    return result.success ? result.data : null;
  } catch {
    return null;
  }
}

export function parseServerMessage(raw: string): ServerMessage | null {
  try {
    const result = serverMessage.safeParse(JSON.parse(raw));
    return result.success ? result.data : null;
  } catch {
    return null;
  }
}
