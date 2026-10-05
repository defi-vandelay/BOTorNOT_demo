import { describe, expect, it } from 'vitest';
import { initialState, reduce, type GameState } from '../lib/game';
import { serverHttpUrl } from '../lib/serverHttp';

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

  it('remembers that the server wants an invite', () => {
    const state = play(
      { type: 'connected', connected: true },
      { type: 'server', now: 0, msg: { type: 'invite.required' } },
      { type: 'connected', connected: false },
    );
    expect(state.inviteRequired).toBe(true);
    expect(state.loginOffered).toBe(false);
  });

  it('tracks a beta sign-in until the server lets the player in', () => {
    const welcome = {
      type: 'welcome',
      playerId: 'p1',
      operator: `0x${'aa'.repeat(20)}`,
      chainId: 84532,
      verifyingContract: `0x${'00'.repeat(20)}`,
      mode: 'points',
    } as const;
    const refused = play(
      { type: 'server', now: 0, msg: { type: 'invite.required', login: true } },
      { type: 'logging-in' },
      { type: 'server', now: 1, msg: { type: 'invite.required', login: true, failed: true } },
    );
    expect([refused.inviteRequired, refused.loginOffered, refused.login]).toEqual([
      true,
      true,
      'failed',
    ]);
    const pending = reduce(refused, { type: 'logging-in' });
    expect(pending.login).toBe('pending');
    const inside = reduce(pending, { type: 'server', now: 2, msg: welcome });
    expect([inside.inviteRequired, inside.login]).toEqual([undefined, undefined]);
  });

  it('keeps the connection details when going back to the lobby', () => {
    const welcome = {
      type: 'welcome',
      playerId: 'p1',
      operator: `0x${'aa'.repeat(20)}`,
      chainId: 84532,
      verifyingContract: `0x${'00'.repeat(20)}`,
      mode: 'points',
    } as const;
    const state = play(
      { type: 'connected', connected: true },
      { type: 'server', now: 0, msg: welcome },
      { type: 'server', now: 1, msg: { type: 'round.void', reason: 'left' } },
      { type: 'back-to-lobby' },
    );
    expect(state).toMatchObject({ screen: 'lobby', connected: true, welcome });
  });

  it('keeps the points balance and the last settlement across rounds', () => {
    const settled = {
      type: 'epoch.settled' as const,
      epoch: 3,
      rightCalls: 4,
      wrongCalls: 2,
      profitPerRight: 35,
      you: { right: 1, wrong: 0, deception: 25, net: 60 },
      dailyPool: 50,
    };
    const state = play(
      { type: 'server', now: 0, msg: { type: 'balance', points: 900 } },
      { type: 'server', now: 1, msg: settled },
      { type: 'back-to-lobby' },
    );
    expect(state.points).toBe(900);
    expect(state.settlement).toEqual(settled);
    expect(reduce(state, { type: 'dismiss-settlement' }).settlement).toBeUndefined();
  });

  it('goes back to the lobby when turned away for lack of points', () => {
    const state = play(
      { type: 'queued' },
      { type: 'server', now: 0, msg: { type: 'error', message: 'not enough points' } },
    );
    expect(state.screen).toBe('lobby');
    expect(state.error).toBe('not enough points');
  });
});

describe('serverHttpUrl', () => {
  it('turns the WebSocket URL into the HTTP base', () => {
    expect(serverHttpUrl('/stats', 'ws://localhost:8787/ws')).toBe('http://localhost:8787/stats');
    expect(serverHttpUrl('/pool', 'wss://game.example/ws')).toBe('https://game.example/pool');
  });

  it('shows the settle transaction for this round only', () => {
    const roundId = `0x${'11'.repeat(32)}` as const;
    const txHash = `0x${'22'.repeat(32)}` as const;
    const base = play({ type: 'connected', connected: true });
    const inRound = { ...base, roundId };
    const other = reduce(inRound, {
      type: 'server',
      now: 0,
      msg: { type: 'round.settled', roundId: `0x${'33'.repeat(32)}`, txHash },
    });
    expect(other.settleTx).toBeUndefined();
    const mine = reduce(inRound, {
      type: 'server',
      now: 0,
      msg: { type: 'round.settled', roundId, txHash },
    });
    expect(mine.settleTx).toBe(txHash);
  });

  it('forgets the last player when the identity changes', () => {
    const state = play(
      { type: 'connected', connected: true },
      { type: 'server', now: 0, msg: { type: 'balance', points: 500, sessionEndsAt: 9 } },
      { type: 'identity' },
    );
    expect(state.points).toBeUndefined();
    expect(state.connected).toBe(true);
  });
});
