import { describe, expect, it } from 'vitest';
import { initialState, reduce, type GameState } from '../lib/game';

const roundId = `0x${'11'.repeat(32)}` as const;

function play(...msgs: Parameters<typeof reduce>[1][]): GameState {
  return msgs.reduce(reduce, initialState);
}

describe('game reducer', () => {
  it('moves from lobby to chat when a match is found', () => {
    const state = play(
      { type: 'queued' },
      {
        type: 'server',
        now: 0,
        msg: {
          type: 'match.found',
          roundId,
          receipt: { commit: roundId, issuedAt: 1, signature: '0x' },
          youStart: true,
          chatEndsAt: 120_000,
        },
      },
    );
    expect(state.screen).toBe('chat');
    expect(state.roundId).toBe(roundId);
  });

  it('clears the typing indicator when the partner sends', () => {
    const state = play(
      { type: 'server', now: 5, msg: { type: 'chat.typing' } },
      { type: 'server', now: 6, msg: { type: 'chat.message', from: 'partner', text: 'yo', at: 6 } },
    );
    expect(state.partnerTypingAt).toBeUndefined();
    expect(state.lines).toEqual([{ from: 'partner', text: 'yo', at: 6 }]);
  });

  it('keeps the connection details when going back to the lobby', () => {
    const welcome = {
      type: 'welcome',
      playerId: 'p1',
      operator: `0x${'aa'.repeat(20)}`,
      chainId: 84532,
      verifyingContract: `0x${'00'.repeat(20)}`,
    } as const;
    const state = play(
      { type: 'connected', connected: true },
      { type: 'server', now: 0, msg: welcome },
      { type: 'server', now: 1, msg: { type: 'round.void', reason: 'left' } },
      { type: 'back-to-lobby' },
    );
    expect(state).toMatchObject({ screen: 'lobby', connected: true, welcome });
  });
});
