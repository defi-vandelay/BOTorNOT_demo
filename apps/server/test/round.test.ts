import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { privateKeyToAccount } from 'viem/accounts';
import {
  CALL_WINDOW_MS,
  CHAT_DURATION_MS,
  TURN_MS,
  computeCommitment,
  humanPartnerId,
  randomBytes32,
} from '@botornot/shared';
import { CommitService } from '../src/game/commit';
import { Round, type RoundOutcome } from '../src/game/round';
import { RecordingSeat } from './helpers';

const A = '0x00000000000000000000000000000000000000aa';
const B = '0x00000000000000000000000000000000000000bb';
const commit = new CommitService(
  privateKeyToAccount(`0x${'01'.repeat(32)}`),
  84532,
  '0x0000000000000000000000000000000000000000',
);

async function humanRound(onEnd?: (o: RoundOutcome) => void) {
  const roundId = randomBytes32();
  const seats = [new RecordingSeat(), new RecordingSeat()] as const;
  const ca = await commit.issue({
    roundId,
    judge: A,
    partnerType: 'HUMAN',
    partnerId: humanPartnerId(B),
  });
  const cb = await commit.issue({
    roundId,
    judge: B,
    partnerType: 'HUMAN',
    partnerId: humanPartnerId(A),
  });
  const round = new Round({
    roundId,
    seats: [seats[0], seats[1]],
    judges: [
      { answer: 'HUMAN', partnerId: humanPartnerId(B), commitment: ca },
      { answer: 'HUMAN', partnerId: humanPartnerId(A), commitment: cb },
    ],
    startingSeat: 0,
    onEnd,
  });
  return { round, seats, roundId };
}

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

describe('Round', () => {
  it('sends each judge their receipt and whose turn it is', async () => {
    const { round, seats } = await humanRound();
    round.start();
    expect(seats[0].last('match.found')).toMatchObject({ youStart: true });
    expect(seats[1].last('match.found')).toMatchObject({ youStart: false });
    expect(seats[0].last('turn')?.yours).toBe(true);
    expect(seats[1].last('turn')?.yours).toBe(false);
  });

  it('enforces turns and relays messages', async () => {
    const { round, seats } = await humanRound();
    round.start();
    expect(round.send(1, 'not my turn')).toBe(false);
    expect(round.send(0, 'hi there')).toBe(true);
    expect(seats[0].last('chat.message')).toMatchObject({ from: 'you', text: 'hi there' });
    expect(seats[1].last('chat.message')).toMatchObject({ from: 'partner', text: 'hi there' });
    expect(seats[1].last('turn')?.yours).toBe(true);
  });

  it('caps messages at 100 characters', async () => {
    const { round, seats } = await humanRound();
    round.start();
    round.send(0, 'x'.repeat(150));
    expect(seats[1].last('chat.message')?.text).toHaveLength(100);
  });

  it('passes the turn when time runs out', async () => {
    const { round, seats } = await humanRound();
    round.start();
    vi.advanceTimersByTime(TURN_MS);
    expect(seats[1].last('turn')?.yours).toBe(true);
    expect(round.send(1, 'ok my go')).toBe(true);
  });

  it('opens the call after two minutes and reveals once both have called', async () => {
    let outcome: RoundOutcome | undefined;
    const { round, seats } = await humanRound((o) => (outcome = o));
    round.start();
    round.send(0, 'hello');
    vi.advanceTimersByTime(CHAT_DURATION_MS);
    expect(round.phase).toBe('call');
    expect(round.send(1, 'too late')).toBe(false);

    round.submitCall(0, 'NOT');
    expect(seats[0].last('round.result')).toBeUndefined();
    round.submitCall(1, 'BOT');

    const r0 = seats[0].last('round.result')!;
    const r1 = seats[1].last('round.result')!;
    expect(r0).toMatchObject({ answer: 'HUMAN', yourCall: 'NOT', correct: true });
    expect(r1).toMatchObject({ answer: 'HUMAN', yourCall: 'BOT', correct: false });
    expect(r0.transcriptHash).toBe(r1.transcriptHash);
    expect(outcome?.phase).toBe('done');
    expect(outcome?.transcript).toHaveLength(1);
  });

  it('reveals values that reproduce the commitment sent before the chat', async () => {
    const { round, seats, roundId } = await humanRound();
    round.start();
    vi.advanceTimersByTime(CHAT_DURATION_MS + CALL_WINDOW_MS);
    const receipt = seats[0].last('match.found')!.receipt;
    const result = seats[0].last('round.result')!;
    expect(result.yourCall).toBeNull();
    expect(result.correct).toBeNull();
    expect(
      computeCommitment({
        roundId,
        judge: A,
        partnerType: result.answer,
        partnerId: result.partnerId,
        salt: result.salt,
      }),
    ).toBe(receipt.commit);
  });

  it('voids the round for the other player when someone leaves mid-chat', async () => {
    let outcome: RoundOutcome | undefined;
    const { round, seats } = await humanRound((o) => (outcome = o));
    round.start();
    round.leave(0);
    expect(seats[1].last('round.void')).toBeDefined();
    expect(seats[0].last('round.void')).toBeUndefined();
    expect(outcome?.phase).toBe('void');
    vi.advanceTimersByTime(CHAT_DURATION_MS + CALL_WINDOW_MS);
    expect(seats[1].last('round.result')).toBeUndefined();
  });
});
