import {
  DEFAULT_RULES,
  STARTING_POINTS,
  settleEpoch,
  type EpochCall,
  type EpochSettlement,
  type SettlementRules,
} from '@botornot/shared';

export interface LedgerDeps {
  epochMs: number;
  rules?: SettlementRules;
  /** Dev mode: a player who runs out of points is topped back up, so testing never stalls. */
  refillWhenBroke?: boolean;
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
    let points = this.balances.get(key) ?? STARTING_POINTS;
    if (points < this.rules.stake && this.deps.refillWhenBroke) points = STARTING_POINTS;
    this.balances.set(key, points);
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
    this.calls.push({ ...call, player: call.player.toLowerCase() });
  }

  get pendingCalls(): number {
    return this.calls.length;
  }

  closeEpoch(now = Date.now()): EpochSettlement {
    const settlement = settleEpoch(this.calls, this.rules);
    for (const [player, s] of Object.entries(settlement.players)) this.add(player, s.credited);
    this.dailyPool += settlement.toDailyPool;
    this.feesCollected += settlement.fee;
    const epoch = this.epoch;
    this.lastSettlement = { epoch, settlement };
    this.calls = [];
    this.epoch++;
    this.epochEndsAt = now + this.deps.epochMs;
    this.deps.onSettled?.(epoch, settlement);
    return settlement;
  }

  private add(player: string, points: number): void {
    const key = player.toLowerCase();
    this.balances.set(key, (this.balances.get(key) ?? STARTING_POINTS) + points);
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
