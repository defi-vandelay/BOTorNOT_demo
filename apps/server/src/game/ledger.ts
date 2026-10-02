import {
  DEFAULT_RULES,
  STARTING_POINTS,
  settleEpoch,
  type EpochCall,
  type EpochSettlement,
  type SettlementRules,
} from '@botornot/shared';
import type { Store } from '../store';

export interface LedgerDeps {
  epochMs: number;
  rules?: SettlementRules;
  /** Dev mode: a player who runs out of points is topped back up, so testing never stalls. */
  refillWhenBroke?: boolean;
  /** Persists balances and pools across restarts; without one everything lives in memory. */
  store?: Store;
  /** Called after each epoch closes, with the epoch number and its settlement. */
  onSettled?: (epoch: number, settlement: EpochSettlement) => void;
}

/**
 * Off-chain points ledger and payout pools (plan doc 06 v2) until the contracts take over in M3.
 * Stakes are taken when a round starts, refunded on a void or a no-call, and otherwise settled
 * together when the epoch closes.
 */
export class Ledger {
  readonly rules: SettlementRules;
  private balances = new Map<string, number>();
  private calls: EpochCall[] = [];
  private timer?: NodeJS.Timeout;
  epoch = 1;
  epochEndsAt = 0;
  dailyPool = 0;
  feesCollected = 0;
  lastSettlement?: { epoch: number; settlement: EpochSettlement };

  constructor(private readonly deps: LedgerDeps) {
    this.rules = deps.rules ?? DEFAULT_RULES;
    const store = deps.store;
    if (store) {
      this.calls = store.pendingCalls();
      this.epoch = store.meta('epoch') ?? 1;
      this.dailyPool = store.meta('dailyPool') ?? 0;
      this.feesCollected = store.meta('feesCollected') ?? 0;
      this.lastSettlement = store.lastEpoch();
    }
  }

  start(now = Date.now()): void {
    this.epochEndsAt = now + this.deps.epochMs;
    this.timer = setInterval(() => this.closeEpoch(), this.deps.epochMs);
  }

  stop(): void {
    clearInterval(this.timer);
  }

  balance(player: string): number {
    const key = player.toLowerCase();
    const points = this.get(key);
    if (points < this.rules.stake && this.deps.refillWhenBroke) {
      this.set(key, STARTING_POINTS);
      return STARTING_POINTS;
    }
    return points;
  }

  canStake(player: string): boolean {
    return this.balance(player) >= this.rules.stake;
  }

  /** Takes one stake; returns false if the player can't cover it. */
  stake(player: string): boolean {
    if (!this.canStake(player)) return false;
    this.add(player, -this.rules.stake);
    return true;
  }

  refund(player: string): void {
    this.add(player, this.rules.stake);
  }

  /** A staked call made this epoch; it settles when the epoch closes. */
  record(call: EpochCall): void {
    const stored = { ...call, player: call.player.toLowerCase() };
    this.calls.push(stored);
    this.deps.store?.addPendingCall(stored);
  }

  get pendingCalls(): number {
    return this.calls.length;
  }

  closeEpoch(now = Date.now()): EpochSettlement {
    const settlement = settleEpoch(this.calls, this.rules);
    for (const [player, s] of Object.entries(settlement.players)) {
      this.balances.set(player, this.get(player) + s.credited);
    }
    this.dailyPool += settlement.toDailyPool;
    this.feesCollected += settlement.fee;
    const epoch = this.epoch;
    const store = this.deps.store;
    if (store && settlement.rightCalls + settlement.wrongCalls > 0) {
      store.closeEpoch(epoch, settlement, this.balances);
    }
    store?.setMeta('epoch', epoch + 1);
    store?.setMeta('dailyPool', this.dailyPool);
    store?.setMeta('feesCollected', this.feesCollected);
    if (settlement.rightCalls + settlement.wrongCalls > 0)
      this.lastSettlement = { epoch, settlement };
    this.calls = [];
    this.epoch++;
    this.epochEndsAt = now + this.deps.epochMs;
    this.deps.onSettled?.(epoch, settlement);
    return settlement;
  }

  private get(key: string): number {
    let points = this.balances.get(key);
    if (points === undefined) {
      points = this.deps.store?.points(key) ?? STARTING_POINTS;
      this.balances.set(key, points);
    }
    return points;
  }

  private set(key: string, points: number): void {
    this.balances.set(key, points);
    this.deps.store?.setPoints(key, points);
  }

  private add(player: string, points: number): void {
    const key = player.toLowerCase();
    this.set(key, this.get(key) + points);
  }

  toJSON() {
    return {
      epoch: this.epoch,
      epochEndsAt: this.epochEndsAt,
      pendingCalls: this.calls.length,
      dailyPool: this.dailyPool,
      feesCollected: this.feesCollected,
      rules: this.rules,
      lastSettlement: this.lastSettlement && {
        epoch: this.lastSettlement.epoch,
        ...this.lastSettlement.settlement,
        players: Object.keys(this.lastSettlement.settlement.players).length,
      },
    };
  }
}
