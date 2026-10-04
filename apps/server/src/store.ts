import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import type { EpochCall, EpochSettlement } from '@botornot/shared';

const SCHEMA = `
CREATE TABLE IF NOT EXISTS players (
  address TEXT PRIMARY KEY,
  points INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS rounds (
  id TEXT PRIMARY KEY,
  kind TEXT NOT NULL,
  persona_id TEXT,
  phase TEXT NOT NULL,
  fallback INTEGER NOT NULL DEFAULT 0,
  judges TEXT NOT NULL,
  transcript_hash TEXT NOT NULL,
  ended_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS pending_calls (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  call TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS epochs (
  epoch INTEGER PRIMARY KEY,
  closed_at INTEGER NOT NULL,
  settlement TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS chain_claims (
  epoch INTEGER NOT NULL,
  player TEXT NOT NULL,
  PRIMARY KEY (epoch, player)
);
CREATE TABLE IF NOT EXISTS meta (
  key TEXT PRIMARY KEY,
  value INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS usage (
  day TEXT NOT NULL,
  key TEXT NOT NULL,
  count INTEGER NOT NULL,
  PRIMARY KEY (day, key)
);
`;

export interface StoredRound {
  id: string;
  kind: 'HUMAN' | 'BOT';
  personaId: string | null;
  phase: 'done' | 'void';
  fallback: boolean;
  judges: { correct: boolean | null }[];
  transcriptHash: string;
  endedAt: number;
}

export type Meta = 'epoch' | 'dailyPool' | 'feesCollected' | 'fallbacks';

/**
 * SQLite persistence (Node's built-in node:sqlite, no native build step), so points, payout pools
 * and stats survive a server restart. Use ":memory:" for tests.
 */
export class Store {
  private readonly db: DatabaseSync;

  constructor(path: string) {
    if (path !== ':memory:') mkdirSync(dirname(path), { recursive: true });
    this.db = new DatabaseSync(path);
    this.db.exec('PRAGMA journal_mode = WAL;');
    this.db.exec(SCHEMA);
  }

  close(): void {
    this.db.close();
  }

  // ---------- points ----------

  points(address: string): number | undefined {
    const row = this.db.prepare('SELECT points FROM players WHERE address = ?').get(address) as
      { points: number } | undefined;
    return row?.points;
  }

  setPoints(address: string, points: number): void {
    this.db
      .prepare(
        `INSERT INTO players (address, points, updated_at) VALUES (?, ?, ?)
         ON CONFLICT(address) DO UPDATE SET points = excluded.points, updated_at = excluded.updated_at`,
      )
      .run(address, points, Date.now());
  }

  // ---------- payout pools ----------

  addPendingCall(call: EpochCall): void {
    this.db.prepare('INSERT INTO pending_calls (call) VALUES (?)').run(JSON.stringify(call));
  }

  pendingCalls(): EpochCall[] {
    return (
      this.db.prepare('SELECT call FROM pending_calls ORDER BY id').all() as { call: string }[]
    ).map((r) => JSON.parse(r.call) as EpochCall);
  }

  /** Records a closed epoch and its effects in one transaction. */
  closeEpoch(epoch: number, settlement: EpochSettlement, balances: Map<string, number>): void {
    this.transaction(() => {
      this.db
        .prepare('INSERT OR REPLACE INTO epochs (epoch, closed_at, settlement) VALUES (?, ?, ?)')
        .run(epoch, Date.now(), JSON.stringify(settlement));
      this.db.exec('DELETE FROM pending_calls');
      for (const player of Object.keys(settlement.players)) {
        this.setPoints(player, balances.get(player)!);
      }
    });
  }

  lastEpoch(): { epoch: number; settlement: EpochSettlement } | undefined {
    const row = this.db
      .prepare('SELECT epoch, settlement FROM epochs ORDER BY epoch DESC LIMIT 1')
      .get() as { epoch: number; settlement: string } | undefined;
    return row && { epoch: row.epoch, settlement: JSON.parse(row.settlement) as EpochSettlement };
  }

  meta(key: Meta): number | undefined {
    const row = this.db.prepare('SELECT value FROM meta WHERE key = ?').get(key) as
      { value: number } | undefined;
    return row?.value;
  }

  setMeta(key: Meta, value: number): void {
    this.db
      .prepare(
        'INSERT INTO meta (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value',
      )
      .run(key, value);
  }

  // ---------- on-chain payout pools ----------

  /** A player had a staked call settled in this on-chain epoch: pay them out when it closes. */
  addChainClaim(epoch: number, player: string): void {
    this.db
      .prepare('INSERT OR IGNORE INTO chain_claims (epoch, player) VALUES (?, ?)')
      .run(epoch, player);
  }

  chainClaims(): Map<number, string[]> {
    const rows = this.db.prepare('SELECT epoch, player FROM chain_claims ORDER BY epoch').all() as {
      epoch: number;
      player: string;
    }[];
    const byEpoch = new Map<number, string[]>();
    for (const r of rows) byEpoch.set(r.epoch, [...(byEpoch.get(r.epoch) ?? []), r.player]);
    return byEpoch;
  }

  removeChainClaims(epoch: number): void {
    this.db.prepare('DELETE FROM chain_claims WHERE epoch = ?').run(epoch);
  }

  // ---------- daily limits ----------

  usage(day: string, key: string): number {
    const row = this.db
      .prepare('SELECT count FROM usage WHERE day = ? AND key = ?')
      .get(day, key) as { count: number } | undefined;
    return row?.count ?? 0;
  }

  addUsage(day: string, key: string): void {
    this.db
      .prepare(
        `INSERT INTO usage (day, key, count) VALUES (?, ?, 1)
         ON CONFLICT(day, key) DO UPDATE SET count = count + 1`,
      )
      .run(day, key);
  }

  /** Drops counts from before this day. */
  pruneUsage(day: string): void {
    this.db.prepare('DELETE FROM usage WHERE day < ?').run(day);
  }

  // ---------- rounds ----------

  addRound(r: StoredRound): void {
    this.db
      .prepare(
        `INSERT OR REPLACE INTO rounds (id, kind, persona_id, phase, fallback, judges, transcript_hash, ended_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        r.id,
        r.kind,
        r.personaId,
        r.phase,
        r.fallback ? 1 : 0,
        JSON.stringify(r.judges),
        r.transcriptHash,
        r.endedAt,
      );
  }

  rounds(): StoredRound[] {
    const rows = this.db.prepare('SELECT * FROM rounds ORDER BY ended_at').all() as {
      id: string;
      kind: 'HUMAN' | 'BOT';
      persona_id: string | null;
      phase: 'done' | 'void';
      fallback: number;
      judges: string;
      transcript_hash: string;
      ended_at: number;
    }[];
    return rows.map((r) => ({
      id: r.id,
      kind: r.kind,
      personaId: r.persona_id,
      phase: r.phase,
      fallback: r.fallback === 1,
      judges: JSON.parse(r.judges) as StoredRound['judges'],
      transcriptHash: r.transcript_hash,
      endedAt: r.ended_at,
    }));
  }

  private transaction(fn: () => void): void {
    this.db.exec('BEGIN');
    try {
      fn();
      this.db.exec('COMMIT');
    } catch (err) {
      this.db.exec('ROLLBACK');
      throw err;
    }
  }
}
