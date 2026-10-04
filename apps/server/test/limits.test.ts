import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { DailyLimits, type Caps } from '../src/game/limits';
import { Store } from '../src/store';

const caps: Caps = { roundsPerPlayer: 2, botRounds: 3, walletActions: 2 };
const alice = { address: '0xAA', ip: '1.1.1.1' };
const bob = { address: '0xBB', ip: '2.2.2.2' };

function limits(overrides: Partial<Caps> = {}, store = new Store(':memory:')) {
  const clock = { now: Date.UTC(2026, 9, 4, 17, 30) };
  return {
    clock,
    store,
    limits: new DailyLimits(store, { ...caps, ...overrides }, () => clock.now),
  };
}

describe('DailyLimits', () => {
  it('stops a player after their rounds for the day and says when more open up', () => {
    const { limits: l } = limits();
    l.roundStarted([alice], true);
    expect(l.whyNotPlay(alice)).toBeNull();
    l.roundStarted([alice, bob], false);
    expect(l.whyNotPlay(alice)).toBe("That's your 2 rounds for today. More in 7 hours.");
    expect(l.whyNotPlay(bob)).toBeNull();
  });

  it('counts by IP too, so a new guest tab or address does not reset the count', () => {
    const { limits: l } = limits();
    l.roundStarted([alice], false);
    l.roundStarted([alice], false);
    expect(l.whyNotPlay({ address: '0xCC', ip: alice.ip })).toMatch(/your 2 rounds/);
    expect(l.whyNotPlay({ address: '0xaa', ip: '9.9.9.9' })).toMatch(/your 2 rounds/);
  });

  it('closes the queue for everyone once the bot rounds for the day are used', () => {
    const { limits: l } = limits({ roundsPerPlayer: 0 });
    for (let i = 0; i < 3; i++) l.roundStarted([alice], true);
    l.roundStarted([alice, bob], false);
    expect(l.whyNotPlay(bob)).toBe(
      "The game has reached today's round limit. It reopens in 7 hours.",
    );
  });

  it('starts afresh at midnight UTC', () => {
    const { limits: l, clock } = limits();
    l.roundStarted([alice], true);
    l.roundStarted([alice], true);
    clock.now = Date.UTC(2026, 9, 4, 23, 30);
    expect(l.whyNotPlay(alice)).toMatch(/within the hour/);
    clock.now = Date.UTC(2026, 9, 5, 0, 1);
    expect(l.whyNotPlay(alice)).toBeNull();
  });

  it('caps signed wallet actions per wallet', () => {
    const { limits: l } = limits();
    expect(l.useWalletAction('0xAA')).toBeNull();
    expect(l.useWalletAction('0xaa')).toBeNull();
    expect(l.useWalletAction('0xAA')).toBe(
      "That's your 2 wallet actions for today. More in 7 hours.",
    );
    expect(l.useWalletAction('0xBB')).toBeNull();
  });

  it('treats 0 as no limit', () => {
    const { limits: l } = limits({ roundsPerPlayer: 0, botRounds: 0, walletActions: 0 });
    for (let i = 0; i < 10; i++) {
      l.roundStarted([alice], true);
      expect(l.useWalletAction(alice.address)).toBeNull();
    }
    expect(l.whyNotPlay(alice)).toBeNull();
  });

  it('keeps counts across a restart', () => {
    const path = join(mkdtempSync(join(tmpdir(), 'botornot-')), 'test.db');
    const first = limits({}, new Store(path));
    first.limits.roundStarted([alice], true);
    first.limits.roundStarted([alice], true);
    first.store.close();
    const second = limits({}, new Store(path));
    expect(second.limits.whyNotPlay(alice)).toMatch(/your 2 rounds/);
    second.store.close();
  });
});
