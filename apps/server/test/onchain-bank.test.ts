import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Chain } from '../src/chain/chain';
import { OnchainBank } from '../src/game/onchain-bank';
import { Store } from '../src/store';

const TOKEN = 10n ** 18n;
const GENESIS = 1_700_000_000;
const EPOCH_SECONDS = 600;
const at = (epoch: number) => (GENESIS + epoch * EPOCH_SECONDS) * 1000;
const A = '0x00000000000000000000000000000000000000aa';
const B = '0x00000000000000000000000000000000000000bb';

/** Enough of Chain for the pool figures and an epoch payout. */
function fakeChain() {
  const state = {
    blockTime: 0,
    epochs: new Map<number, { rightCalls: number; wrongCalls: number; profitPerRight: bigint }>(),
    dailyPool: 0n,
    fees: 0n,
    deception: new Map<string, bigint>(),
  };
  const chain = {
    vault: '0x000000000000000000000000000000000000000v',
    token: '0x000000000000000000000000000000000000000t',
    epochLength: EPOCH_SECONDS,
    epochAt: (ms: number) => Math.floor((ms / 1000 - GENESIS) / EPOCH_SECONDS),
    epochEndsAt: (epoch: number) => at(epoch + 1),
    blockTime: async () => state.blockTime,
    dailyPool: async () => state.dailyPool,
    fees: async () => state.fees,
    epoch: async (epoch: number) => ({
      rightCalls: 0,
      wrongCalls: 0,
      profitPerRight: 0n,
      ...state.epochs.get(epoch),
      closed: false,
    }),
    playerEpoch: async (_epoch: number, player: string) => ({
      right: 0,
      wrong: 0,
      deception: state.deception.get(player) ?? 0n,
    }),
    closeAndClaim: async () => '0xpaid',
    balanceOf: async () => 0n,
    sessionExpiry: async () => 0,
  };
  return { chain: chain as unknown as Chain, state };
}

function setup() {
  const store = new Store(join(mkdtempSync(join(tmpdir(), 'botornot-')), 'test.db'));
  const { chain, state } = fakeChain();
  const bank = new OnchainBank({ chain, store, log: () => {} });
  return { bank, store, state };
}

describe('OnchainBank pool report', () => {
  afterEach(() => vi.useRealTimers());

  it('reports the same fields as the points ledger, in tBON', async () => {
    const { bank, state } = setup();
    state.epochs.set(7, { rightCalls: 2, wrongCalls: 1, profitPerRight: 0n });
    state.dailyPool = 125n * TOKEN;
    state.fees = 10n * TOKEN;
    vi.useFakeTimers({ now: at(7) + 60_000 });

    await bank.tick(Date.now());

    expect(JSON.parse(JSON.stringify(bank))).toMatchObject({
      onchain: true,
      epoch: 7,
      epochEndsAt: at(8),
      pendingCalls: 3,
      dailyPool: 125,
      feesCollected: 10,
    });
  });

  it('shows no calls for a new epoch until the chain is read again', async () => {
    const { bank, state } = setup();
    state.epochs.set(7, { rightCalls: 2, wrongCalls: 1, profitPerRight: 0n });
    vi.useFakeTimers({ now: at(7) });
    await bank.tick(Date.now());

    vi.setSystemTime(at(8));
    expect(bank.toJSON()).toMatchObject({ epoch: 8, pendingCalls: 0 });
  });

  it('keeps the last epoch it paid out', async () => {
    const { bank, store, state } = setup();
    store.addChainClaim(7, A);
    store.addChainClaim(7, B);
    state.epochs.set(7, { rightCalls: 3, wrongCalls: 1, profitPerRight: 22n * TOKEN });
    state.deception.set(B, 25n * TOKEN);
    state.blockTime = at(8);

    await bank.tick(at(8));

    expect(bank.toJSON().lastSettlement).toEqual({
      epoch: 7,
      rightCalls: 3,
      wrongCalls: 1,
      profitPerRight: 22,
      deceptionPaid: 25,
    });
    expect(store.chainClaims().size).toBe(0);
  });
});
