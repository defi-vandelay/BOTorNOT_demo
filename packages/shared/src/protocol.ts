import { z } from 'zod';
import { MAX_MESSAGE_CHARS } from './constants';

const hex = z.string().regex(/^0x[0-9a-fA-F]*$/);
const address = z.string().regex(/^0x[0-9a-fA-F]{40}$/);
const bytes32 = z.string().regex(/^0x[0-9a-fA-F]{64}$/);

// ---------- client -> server ----------

export const clientMessage = z.discriminatedUnion('type', [
  z.object({ type: z.literal('hello'), address }),
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
  z.object({ type: z.literal('welcome'), playerId: z.string() }),
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
  }),
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
