import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { privateKeyToAccount } from 'viem/accounts';
import {
  CALL_WINDOW_MS,
  CHAT_DURATION_MS,
  QUEUE_WAIT_MAX_MS,
  QUEUE_WAIT_MIN_MS,
  STARTING_POINTS,
} from '@botornot/shared';
import { CommitService } from '../src/game/commit';
import { Ledger } from '../src/game/ledger';
import { Matchmaker, type Player } from '../src/game/matchmaker';
import { Stats } from '../src/game/stats';
import { MockGateway } from '../src/llm/mock';
import { RecordingSeat } from './helpers';

const commit = new CommitService(
  privateKeyToAccount(`0x${'04'.repeat(32)}`),
  84532,
  '0x0000000000000000000000000000000000000000',
);

function player(n: number, ip = `10.0.0.${n}`): Player & { seat: RecordingSeat } {
  return {
    id: `p${n}`,
    address: `0x${n.toString(16).padStart(40, '0')}`,
    ip,
    seat: new RecordingSeat(),
    connected: true,
  };
}

function matchmaker(botShare: number, allowSameIp = false) {
  const stats = new Stats();
  const ledger = new Ledger({ epochMs: 600_000 });
  const started: { ids: string[]; bot: boolean }[] = [];
  const mm = new Matchmaker({
    commit,
    llm: new MockGateway(),
    stats,
    ledger,
    botShare,
    allowSameIp,
    onRoundStart: (players, bot) => started.push({ ids: players.map((p) => p.id), bot }),
    log: () => {},
  });
  return { mm, stats, ledger, started };
}

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

describe('Matchmaker', () => {
  it('reports each round as it starts, for the daily limits', async () => {
    const { mm, started } = matchmaker(1);
    mm.join(player(1));
    await mm.tick(Date.now() + QUEUE_WAIT_MAX_MS);
    const human = matchmaker(0);
    human.mm.join(player(2));
    human.mm.join(player(3));
    await human.mm.tick(Date.now() + QUEUE_WAIT_MAX_MS);
    expect(started).toEqual([{ ids: ['p1'], bot: true }]);
    expect(human.started).toEqual([{ ids: ['p2', 'p3'], bot: false }]);
  });

  it('never matches before the random wait is over', async () => {
    const { mm } = matchmaker(1);
    const p = player(1);
    mm.join(p);
    await mm.tick(Date.now() + QUEUE_WAIT_MIN_MS - 1);
    expect(p.current).toBeUndefined();
    await mm.tick(Date.now() + QUEUE_WAIT_MAX_MS);
    expect(p.current).toBeDefined();
    expect(p.seat.last('match.found')).toBeDefined();
  });

  it('pairs two humans when the coin says human', async () => {
    const { mm } = matchmaker(0);
    const a = player(1);
    const b = player(2);
    mm.join(a);
    mm.join(b);
    await mm.tick(Date.now() + QUEUE_WAIT_MAX_MS);
    expect(a.current?.round).toBe(b.current?.round);
    expect(a.current?.round.kind).toBe('HUMAN');
  });

  it('falls back to a bot when no human is free, and counts it', async () => {
    const { mm, stats } = matchmaker(0);
    const a = player(1);
    mm.join(a);
    await mm.tick(Date.now() + QUEUE_WAIT_MAX_MS);
    expect(a.current?.round.kind).toBe('BOT');
    expect(stats.fallbacks).toBe(1);
  });

  it('does not pair players on the same IP unless allowed', async () => {
    const strict = matchmaker(0);
    const a = player(1, '1.1.1.1');
    const b = player(2, '1.1.1.1');
    strict.mm.join(a);
    strict.mm.join(b);
    await strict.mm.tick(Date.now() + QUEUE_WAIT_MAX_MS);
    expect(a.current?.round).not.toBe(b.current?.round);

    const dev = matchmaker(0, true);
    const c = player(3, '1.1.1.1');
    const d = player(4, '1.1.1.1');
    dev.mm.join(c);
    dev.mm.join(d);
    await dev.mm.tick(Date.now() + QUEUE_WAIT_MAX_MS);
    expect(c.current?.round).toBe(d.current?.round);
  });

  it('drops a player who leaves the queue', async () => {
    const { mm } = matchmaker(1);
    const a = player(1);
    mm.join(a);
    mm.leave(a);
    await mm.tick(Date.now() + QUEUE_WAIT_MAX_MS);
    expect(a.current).toBeUndefined();
  });

  it('takes stakes at the start and settles calls with their partner at epoch close', async () => {
    const { mm, ledger } = matchmaker(0);
    const a = player(1);
    const b = player(2);
    const c = player(3);
    mm.join(a);
    mm.join(b);
    await mm.tick(Date.now() + QUEUE_WAIT_MAX_MS);
    mm.join(c); // no human left for c: a bot round
    await mm.tick(Date.now() + 2 * QUEUE_WAIT_MAX_MS);
    const stake = ledger.rules.stake;
    expect(ledger.balance(a.address)).toBe(STARTING_POINTS - stake);
    expect(a.seat.last('balance')?.points).toBe(STARTING_POINTS - stake);

    vi.advanceTimersByTime(CHAT_DURATION_MS);
    a.current!.round.submitCall(a.current!.seat, 'NOT'); // right, and fooled b
    b.current!.round.submitCall(b.current!.seat, 'BOT'); // wrong
    c.current!.round.submitCall(c.current!.seat, 'BOT'); // right
    expect(a.seat.last('round.result')?.settlesAt).toBe(ledger.epochEndsAt);
    expect(ledger.pendingCalls).toBe(3);

    const s = ledger.closeEpoch();
    // b's forfeit: 5 fee, 25 to a for the deception, 70 split between a and c.
    expect(s.players[a.address.toLowerCase()]).toMatchObject({ deception: 25, net: 35 + 25 });
    expect(ledger.balance(a.address)).toBe(STARTING_POINTS + 60);
    expect(ledger.balance(b.address)).toBe(STARTING_POINTS - stake);
    expect(ledger.balance(c.address)).toBe(STARTING_POINTS + 35);
  });

  it('refunds a no-call', async () => {
    const { mm, ledger } = matchmaker(1);
    const a = player(1);
    mm.join(a);
    await mm.tick(Date.now() + QUEUE_WAIT_MAX_MS);
    vi.advanceTimersByTime(CHAT_DURATION_MS + CALL_WINDOW_MS);
    expect(a.current).toBeUndefined();
    expect(ledger.balance(a.address)).toBe(STARTING_POINTS);
    expect(ledger.pendingCalls).toBe(0);
  });

  it('refunds both players when a human round is void', async () => {
    const { mm, ledger } = matchmaker(0);
    const a = player(1);
    const b = player(2);
    mm.join(a);
    mm.join(b);
    await mm.tick(Date.now() + QUEUE_WAIT_MAX_MS);
    a.current!.round.leave(a.current!.seat);
    expect(ledger.balance(a.address)).toBe(STARTING_POINTS);
    expect(ledger.balance(b.address)).toBe(STARTING_POINTS);
  });

  it('turns away a player who cannot cover the stake', async () => {
    const { mm, ledger } = matchmaker(1);
    const a = player(1);
    while (ledger.stake(a.address));
    mm.join(a);
    await mm.tick(Date.now() + QUEUE_WAIT_MAX_MS);
    expect(a.current).toBeUndefined();
    expect(a.seat.last('error')?.message).toBe('not enough points');
  });
});
