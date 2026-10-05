import type { Address, Hex } from 'viem';
import { STAKE_POINTS } from '@botornot/shared';
import type { Chain } from '../chain/chain';
import type { Store } from '../store';
import type { Bank, RoundSettlement } from './bank';

const UNIT = 10n ** 18n;
/** A session must have at least this long left for the server to stake a new round. */
const SESSION_MARGIN_MS = 5 * 60_000;
const TICK_MS = 5_000;
/** How often the pool figures shown on /stats are re-read from the chain. */
const POOL_READ_MS = 15_000;

/** viem errors carry a one-line summary; the full text is pages long. */
export function brief(err: unknown): string {
  const short = (err as { shortMessage?: string }).shortMessage;
  return short ?? (err instanceof Error ? err.message : String(err));
}

/** Whole tokens, rounded to 2 decimals, for display. */
export function tokens(amount: bigint): number {
  return Number(amount / 10n ** 16n) / 100;
}

export interface EpochReport {
  epoch: number;
  rightCalls: number;
  wrongCalls: number;
  profitPerRight: number;
  you: { right: number; wrong: number; deception: number; net: number };
  dailyPool: number;
  txHash: Hex;
}

export interface OnchainBankDeps {
  chain: Chain;
  store: Store;
  log?: (msg: string) => void;
  /** A player's balance or session changed (a settle or payout landed). */
  onBalance?: (player: string) => void;
  /** An epoch a player had calls in has been paid out. */
  onEpochSettled?: (player: string, report: EpochReport) => void;
}

/**
 * Stakes in GameVault (test tokens). Balances and sessions are read from the chain and cached;
 * stakes for rounds still in play are reserved locally so a player can't start more rounds than
 * they can cover. Each finished round is settled on-chain, and each epoch is closed and paid out
 * by a worker once it ends. Epoch maths happen in the contract (plan doc 06 v2).
 */
export class OnchainBank implements Bank {
  private balances = new Map<string, bigint>();
  private sessions = new Map<string, number>();
  private reserved = new Map<string, number>();
  private timer?: NodeJS.Timeout;
  private ticking = false;
  private readonly log: (msg: string) => void;
  /** Staked calls settled so far in the current epoch, as last read from the chain. */
  private current = { epoch: -1, calls: 0 };
  private poolReadAt = 0;
  epochEndsAt = 0;
  dailyPool = 0n;
  fees = 0n;
  lastSettlement?: {
    epoch: number;
    rightCalls: number;
    wrongCalls: number;
    profitPerRight: number;
    deceptionPaid: number;
  };

  constructor(private readonly deps: OnchainBankDeps) {
    this.log = deps.log ?? console.log;
  }

  start(): void {
    this.timer = setInterval(() => void this.tick(), TICK_MS);
    void this.tick();
  }

  stop(): void {
    clearInterval(this.timer);
  }

  /** Re-reads a player's vault balance and session from the chain. */
  async refresh(player: string): Promise<void> {
    const key = player.toLowerCase();
    const [balance, session] = await Promise.all([
      this.deps.chain.balanceOf(player as Address),
      this.deps.chain.sessionExpiry(player as Address),
    ]);
    this.balances.set(key, balance);
    this.sessions.set(key, session);
  }

  /** Why this player can't stake right now, or null if they can. */
  whyNot(player: string): string | null {
    const key = player.toLowerCase();
    if ((this.sessions.get(key) ?? 0) < Date.now() + SESSION_MARGIN_MS) {
      return 'start a session to play for tokens';
    }
    if (this.balance(player) < STAKE_POINTS) return 'not enough tBON in the game: top up first';
    return null;
  }

  balance(player: string): number {
    const key = player.toLowerCase();
    const whole = Number((this.balances.get(key) ?? 0n) / UNIT);
    return whole - (this.reserved.get(key) ?? 0) * STAKE_POINTS;
  }

  sessionEndsAt(player: string): number {
    return this.sessions.get(player.toLowerCase()) ?? 0;
  }

  canStake(player: string): boolean {
    return this.whyNot(player) === null;
  }

  stake(player: string): boolean {
    if (!this.canStake(player)) return false;
    this.adjustReserved(player, 1);
    return true;
  }

  refund(player: string): void {
    this.adjustReserved(player, -1);
  }

  record(): void {
    // The contract keeps the pool; nothing to do until the round is settled on-chain.
  }

  settleRound(round: RoundSettlement): void {
    const players = round.judges.map((j) => j.player);
    const release = () => {
      for (const p of players) this.adjustReserved(p, -1);
    };
    this.deps.chain
      .settleRound(round.roundId, round.transcriptHash, round.judges)
      .then(async ({ txHash, calls }) => {
        release();
        for (const c of calls) {
          if (c.staked) this.deps.store.addChainClaim(c.epoch, c.player.toLowerCase());
        }
        this.poolReadAt = 0;
        this.log(`round ${round.roundId.slice(0, 10)} settled on-chain: ${txHash}`);
        for (const p of players) round.onSettled(p, txHash);
        await this.refreshAndNotify(players);
      })
      .catch(async (err: unknown) => {
        release();
        this.log(`round ${round.roundId.slice(0, 10)}: settle failed: ${brief(err)}`);
        await this.refreshAndNotify(players);
      });
  }

  /** Closes and pays out every ended epoch that has settled calls. */
  async tick(now = Date.now()): Promise<void> {
    const chain = this.deps.chain;
    if (!chain.epochLength || this.ticking) return;
    this.ticking = true;
    try {
      this.epochEndsAt = chain.epochEndsAt(chain.epochAt(now));
      await this.readPool(now);
      const claims = this.deps.store.chainClaims();
      if (!claims.size) return;
      // The contract judges "over" by block time, which can trail this server's clock.
      const blockTime = await chain.blockTime();
      for (const [epoch, players] of claims) {
        if (blockTime < chain.epochEndsAt(epoch)) continue;
        const txHash = await chain.closeAndClaim(epoch, players as Address[]);
        this.deps.store.removeChainClaims(epoch);
        this.dailyPool = await chain.dailyPool();
        await this.report(epoch, players, txHash);
        this.poolReadAt = 0;
        await this.refreshAndNotify(players);
      }
    } catch (err) {
      this.log(`epoch payout failed (will retry): ${brief(err)}`);
    } finally {
      this.ticking = false;
    }
  }

  private async report(epoch: number, players: string[], txHash: Hex): Promise<void> {
    const chain = this.deps.chain;
    const e = await chain.epoch(epoch);
    this.log(
      `epoch ${epoch} paid out: ${e.rightCalls} right, ${e.wrongCalls} wrong, ` +
        `+${tokens(e.profitPerRight)} tBON per right call (${txHash})`,
    );
    const stake = BigInt(STAKE_POINTS) * UNIT;
    let deception = 0n;
    for (const player of players) {
      const you = await chain.playerEpoch(epoch, player as Address);
      deception += you.deception;
      const net =
        BigInt(you.right) * (stake + e.profitPerRight) +
        you.deception -
        BigInt(you.right + you.wrong) * stake;
      this.deps.onEpochSettled?.(player, {
        epoch,
        rightCalls: e.rightCalls,
        wrongCalls: e.wrongCalls,
        profitPerRight: tokens(e.profitPerRight),
        you: {
          right: you.right,
          wrong: you.wrong,
          deception: tokens(you.deception),
          net: net < 0n ? -tokens(-net) : tokens(net),
        },
        dailyPool: tokens(this.dailyPool),
        txHash,
      });
    }
    this.lastSettlement = {
      epoch,
      rightCalls: e.rightCalls,
      wrongCalls: e.wrongCalls,
      profitPerRight: tokens(e.profitPerRight),
      deceptionPaid: tokens(deception),
    };
  }

  /** Re-reads the figures /pool reports, at most every POOL_READ_MS or right after a change. */
  private async readPool(now: number): Promise<void> {
    if (now - this.poolReadAt < POOL_READ_MS) return;
    const chain = this.deps.chain;
    // Just after a deploy the server's clock can trail the vault's genesis block.
    const epoch = Math.max(0, chain.epochAt(now));
    this.poolReadAt = now;
    try {
      const [e, dailyPool, fees] = await Promise.all([
        chain.epoch(epoch),
        chain.dailyPool(),
        chain.fees(),
      ]);
      this.current = { epoch, calls: e.rightCalls + e.wrongCalls };
      this.dailyPool = dailyPool;
      this.fees = fees;
    } catch (err) {
      this.log(`could not read the pool from the chain: ${brief(err)}`);
    }
  }

  private async refreshAndNotify(players: string[]): Promise<void> {
    for (const p of players) {
      try {
        await this.refresh(p);
        this.deps.onBalance?.(p);
      } catch (err) {
        this.log(`could not read ${p} from the chain: ${brief(err)}`);
      }
    }
  }

  private adjustReserved(player: string, by: number): void {
    const key = player.toLowerCase();
    this.reserved.set(key, Math.max(0, (this.reserved.get(key) ?? 0) + by));
  }

  /** Same fields as the points Ledger's, in whole tBON, plus the vault's details. */
  toJSON() {
    const chain = this.deps.chain;
    const epoch = chain.epochLength ? Math.max(0, chain.epochAt(Date.now())) : 0;
    return {
      onchain: true,
      vault: chain.vault,
      token: chain.token,
      epoch,
      epochEndsAt: this.epochEndsAt,
      epochSeconds: chain.epochLength,
      pendingCalls: this.current.epoch === epoch ? this.current.calls : 0,
      dailyPool: tokens(this.dailyPool),
      feesCollected: tokens(this.fees),
      lastSettlement: this.lastSettlement,
      pendingEpochs: [...this.deps.store.chainClaims().keys()],
    };
  }
}
