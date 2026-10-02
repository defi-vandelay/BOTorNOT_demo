import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { STARTING_POINTS } from '@botornot/shared';
import { Ledger } from '../src/game/ledger';
import { Stats } from '../src/game/stats';
import { Store } from '../src/store';

const dbFile = () => join(mkdtempSync(join(tmpdir(), 'botornot-')), 'test.db');

describe('persistence across a restart', () => {
  it('keeps balances, pending calls, pools and the epoch number', () => {
    const path = dbFile();
    let store = new Store(path);
    let ledger = new Ledger({ epochMs: 60_000, store });
    ledger.stake('0xAA');
    ledger.stake('0xBB');
    ledger.record({ player: '0xaa', partnerType: 'BOT', correct: true });
    ledger.record({ player: '0xbb', partnerType: 'BOT', correct: false });
    store.close();

    // Restart before the epoch closes: stakes and pending calls are still there.
    store = new Store(path);
    ledger = new Ledger({ epochMs: 60_000, store });
    expect(ledger.balance('0xaa')).toBe(STARTING_POINTS - 100);
    expect(ledger.pendingCalls).toBe(2);
    ledger.closeEpoch();
    expect(ledger.balance('0xaa')).toBe(STARTING_POINTS + 70);
    store.close();

    // Restart after: the settlement, the daily pool and the next epoch number survive.
    store = new Store(path);
    ledger = new Ledger({ epochMs: 60_000, store });
    expect(ledger.balance('0xAA')).toBe(STARTING_POINTS + 70);
    expect(ledger.balance('0xbb')).toBe(STARTING_POINTS - 100);
    expect(ledger.pendingCalls).toBe(0);
    expect(ledger.epoch).toBe(2);
    expect(ledger.dailyPool).toBe(25);
    expect(ledger.lastSettlement?.epoch).toBe(1);
    store.close();
  });

  it('rebuilds round stats', () => {
    const path = dbFile();
    let store = new Store(path);
    const stats = new Stats(store);
    stats.fallback();
    stats.record(
      {
        roundId: `0x${'01'.repeat(32)}`,
        phase: 'done',
        kind: 'BOT',
        judges: [
          { seat: 0, call: 'NOT', correct: false, answer: 'BOT', partnerId: '0x01', salt: '0x02' },
        ],
        transcript: [],
        transcriptHash: `0x${'02'.repeat(32)}`,
      },
      'persona-001',
    );
    store.close();

    store = new Store(path);
    const json = new Stats(store).toJSON();
    expect(json).toMatchObject({ rounds: 1, botRounds: 1, fallbacks: 1, botFoolRate: 1 });
    expect(json.personas['persona-001']).toMatchObject({ name: 'Jess', judged: 1, fooled: 1 });
    store.close();
  });
});
