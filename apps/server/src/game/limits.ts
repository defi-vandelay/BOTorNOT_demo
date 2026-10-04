import type { Store } from '../store';

export interface Caps {
  /** Rounds one player can start per day, counted by address and by IP (0 = no limit). */
  roundsPerPlayer: number;
  /** Bot rounds across all players per day; each one costs model calls (0 = no limit). */
  botRounds: number;
  /** Signed top-ups and withdrawals per wallet per day; the operator pays their gas (0 = no limit). */
  walletActions: number;
}

interface Who {
  address: string;
  ip: string;
}

const DAY_MS = 86_400_000;
const HOUR_MS = 3_600_000;

/**
 * Daily caps for a hosted game, so a shared link can't run up the model bill or drain the
 * operator's gas. Counts are kept in SQLite, so a redeploy doesn't reset them, and roll over at
 * midnight UTC. When the game-wide cap is hit, nobody can queue: refusing only bot rounds would
 * tell players that every partner left is human.
 */
export class DailyLimits {
  private today = '';

  constructor(
    private readonly store: Store,
    private readonly caps: Caps,
    private readonly now: () => number = Date.now,
  ) {}

  /** Why this player can't start another round today, or null if they can. */
  whyNotPlay(p: Who): string | null {
    const day = this.day();
    const { roundsPerPlayer, botRounds } = this.caps;
    if (botRounds && this.store.usage(day, 'bot-rounds') >= botRounds) {
      return `The game has reached today's round limit. It reopens ${this.resets()}.`;
    }
    const played = Math.max(
      this.store.usage(day, `player:${p.address.toLowerCase()}`),
      this.store.usage(day, `ip:${p.ip}`),
    );
    if (roundsPerPlayer && played >= roundsPerPlayer) {
      return `That's your ${roundsPerPlayer} rounds for today. More ${this.resets()}.`;
    }
    return null;
  }

  /** Counts a round that has started, against each human in it and the bot total. */
  roundStarted(players: Who[], bot: boolean): void {
    const day = this.day();
    if (bot) this.store.addUsage(day, 'bot-rounds');
    for (const p of players) {
      this.store.addUsage(day, `player:${p.address.toLowerCase()}`);
      this.store.addUsage(day, `ip:${p.ip}`);
    }
  }

  /** Counts a signed wallet action, or says why the wallet has used up today's. */
  useWalletAction(address: string): string | null {
    const day = this.day();
    const key = `wallet:${address.toLowerCase()}`;
    const { walletActions } = this.caps;
    if (walletActions && this.store.usage(day, key) >= walletActions) {
      return `That's your ${walletActions} wallet actions for today. More ${this.resets()}.`;
    }
    this.store.addUsage(day, key);
    return null;
  }

  /** Today in UTC (YYYY-MM-DD); older counts are dropped when the day changes. */
  private day(): string {
    const day = new Date(this.now()).toISOString().slice(0, 10);
    if (day !== this.today) {
      this.today = day;
      this.store.pruneUsage(day);
    }
    return day;
  }

  private resets(): string {
    const hours = Math.ceil((DAY_MS - (this.now() % DAY_MS)) / HOUR_MS);
    return hours <= 1 ? 'within the hour' : `in ${hours} hours`;
  }
}
