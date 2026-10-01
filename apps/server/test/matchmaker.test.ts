import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { privateKeyToAccount } from 'viem/accounts';
import { QUEUE_WAIT_MAX_MS, QUEUE_WAIT_MIN_MS } from '@botornot/shared';
import { CommitService } from '../src/game/commit';
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
  const mm = new Matchmaker({
    commit,
    llm: new MockGateway(),
    stats,
    botShare,
    allowSameIp,
    log: () => {},
  });
  return { mm, stats };
}

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

describe('Matchmaker', () => {
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
});
