import { describe, expect, it } from 'vitest';
import { settleEpoch, type EpochCall, type EpochSettlement } from '../src/settlement';

const rules = { stake: 100, feeBps: 500, deceptionBps: 2_500 };

/** Every point staked ends up credited to a player, in the fee or in the daily pool. */
function expectConserved(calls: EpochCall[], s: EpochSettlement) {
  const credited = Object.values(s.players).reduce((sum, p) => sum + p.credited, 0);
  expect(credited + s.fee + s.toDailyPool).toBe(calls.length * rules.stake);
}

const bot = (player: string, correct: boolean): EpochCall => ({
  player,
  partnerType: 'BOT',
  correct,
});

/** Both calls of one human-vs-human round. */
function humanRound(a: string, aRight: boolean | null, b: string, bRight: boolean | null) {
  const calls: EpochCall[] = [];
  if (aRight !== null)
    calls.push({
      player: a,
      partnerType: 'HUMAN',
      correct: aRight,
      partner: { player: b, correct: bRight },
    });
  if (bRight !== null)
    calls.push({
      player: b,
      partnerType: 'HUMAN',
      correct: bRight,
      partner: { player: a, correct: aRight },
    });
  return calls;
}

describe('settleEpoch', () => {
  it('pays every right call the same, whether the partner was a human or a bot', () => {
    const calls = [
      bot('alice', true),
      bot('bob', false),
      ...humanRound('carol', true, 'dave', true),
      bot('erin', false),
    ];
    const s = settleEpoch(calls, rules);
    // Two forfeits of 100: 5 fee + 25 to the daily pool (bots don't earn) + 70 for right callers.
    expect(s.fee).toBe(10);
    expect(s.profitPerRight).toBe(Math.floor(140 / 3));
    expect(s.players.alice!.net).toBe(s.profitPerRight);
    expect(s.players.carol!.net).toBe(s.profitPerRight);
    expect(s.players.dave!.net).toBe(s.profitPerRight);
    expect(s.players.bob!.net).toBe(-100);
    expectConserved(calls, s);
  });

  it('pays the deception share to a human who fooled their partner and called right', () => {
    const calls = [...humanRound('alice', true, 'bob', false), bot('carol', true)];
    const s = settleEpoch(calls, rules);
    expect(s.players.alice!.deception).toBe(25);
    expect(s.deceptionPaid).toBe(25);
    // 70 for two right callers.
    expect(s.profitPerRight).toBe(35);
    expect(s.players.alice!.net).toBe(35 + 25);
    expect(s.players.carol!.net).toBe(35);
    expect(s.players.bob!.net).toBe(-100);
    expectConserved(calls, s);
  });

  it('sends the deception share to the daily pool when a bot did the fooling', () => {
    const calls = [bot('alice', false), bot('bob', true)];
    const s = settleEpoch(calls, rules);
    expect(s.deceptionPaid).toBe(0);
    expect(s.toDailyPool).toBe(25);
    expect(s.players.bob!.net).toBe(70);
    expectConserved(calls, s);
  });

  it('sends both forfeits to the daily pool when two humans fool each other', () => {
    const calls = [...humanRound('alice', false, 'bob', false), bot('carol', true)];
    const s = settleEpoch(calls, rules);
    expect(s.toDailyPool).toBe(190);
    expect(s.fee).toBe(10);
    expect(s.deceptionPaid).toBe(0);
    expect(s.profitPerRight).toBe(0);
    expect(s.players.carol!.net).toBe(0);
    expectConserved(calls, s);
  });

  it('pays no deception share when the fooled partner made no call', () => {
    // Alice was wrong; Bob never called, so he has no claim on her deception share.
    const calls = humanRound('alice', false, 'bob', null);
    const s = settleEpoch(calls, rules);
    expect(s.deceptionPaid).toBe(0);
    expect(s.toDailyPool).toBe(25 + 70);
    expectConserved(calls, s);
  });

  it('refunds everyone when nobody is wrong', () => {
    const calls = [bot('alice', true), ...humanRound('bob', true, 'carol', true)];
    const s = settleEpoch(calls, rules);
    expect(s.profitPerRight).toBe(0);
    for (const p of Object.values(s.players)) expect(p.net).toBe(0);
    expectConserved(calls, s);
  });

  it('sends right callers’ share to the daily pool when nobody is right', () => {
    const calls = [bot('alice', false), bot('bob', false)];
    const s = settleEpoch(calls, rules);
    expect(s.fee).toBe(10);
    expect(s.toDailyPool).toBe(190);
    expectConserved(calls, s);
  });

  it('puts rounding dust in the daily pool', () => {
    const calls = [bot('a', false), bot('b', true), bot('c', true), bot('d', true)];
    const s = settleEpoch(calls, rules);
    expect(s.profitPerRight).toBe(23);
    expect(s.toDailyPool).toBe(25 + 1);
    expectConserved(calls, s);
  });

  it('settles an empty epoch to nothing', () => {
    const s = settleEpoch([], rules);
    expect(s).toMatchObject({ rightCalls: 0, wrongCalls: 0, fee: 0, toDailyPool: 0 });
  });
});
