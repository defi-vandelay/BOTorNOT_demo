import type { Address } from 'viem';
import {
  QUEUE_WAIT_MAX_MS,
  QUEUE_WAIT_MIN_MS,
  botPartnerId,
  humanPartnerId,
  randomBytes32,
} from '@botornot/shared';
import type { LlmGateway } from '../llm/gateway';
import { BotSeat } from '../bots/runtime';
import { pickPersona } from '../bots/personas';
import type { CommitService } from './commit';
import type { Ledger } from './ledger';
import { Round, type RoundOutcome, type Seat } from './round';
import type { Stats } from './stats';

export interface Player {
  id: string;
  address: Address;
  ip: string;
  seat: Seat;
  connected: boolean;
  /** The round this player is in, if any. */
  current?: { round: Round; seat: 0 | 1 };
}

interface Entry {
  player: Player;
  /** Earliest time this player may be matched; drawn at random so waits don't reveal the answer. */
  readyAt: number;
  wantsBot: boolean;
  partner?: Entry;
}

export interface MatchmakerDeps {
  commit: CommitService;
  llm: LlmGateway;
  stats: Stats;
  /** Points ledger and payout pools; without one, rounds are played for nothing. */
  ledger?: Ledger;
  /** Share of matches that should be bots (operator ratio). */
  botShare: number;
  /** Allow two players from the same IP to match (two windows on one machine). */
  allowSameIp: boolean;
  log?: (msg: string) => void;
  rng?: () => number;
}

const TICK_MS = 250;

export class Matchmaker {
  private queue: Entry[] = [];
  private timer?: NodeJS.Timeout;
  private readonly rng: () => number;
  private readonly log: (msg: string) => void;

  constructor(private readonly deps: MatchmakerDeps) {
    this.rng = deps.rng ?? Math.random;
    this.log = deps.log ?? console.log;
  }

  start(): void {
    this.timer = setInterval(() => void this.tick(), TICK_MS);
  }

  stop(): void {
    clearInterval(this.timer);
  }

  isQueued(player: Player): boolean {
    return this.queue.some((e) => e.player === player);
  }

  join(player: Player): void {
    if (player.current || this.isQueued(player)) return;
    const wait = QUEUE_WAIT_MIN_MS + this.rng() * (QUEUE_WAIT_MAX_MS - QUEUE_WAIT_MIN_MS);
    this.queue.push({
      player,
      readyAt: Date.now() + wait,
      wantsBot: this.rng() < this.deps.botShare,
    });
  }

  leave(player: Player): void {
    const entry = this.queue.find((e) => e.player === player);
    if (!entry) return;
    if (entry.partner) entry.partner.partner = undefined;
    this.queue = this.queue.filter((e) => e !== entry);
  }

  /** Pairs waiting humans and starts every match whose wait is over. */
  async tick(now = Date.now()): Promise<void> {
    for (const a of this.queue) {
      if (a.wantsBot || a.partner) continue;
      const b = this.queue.find(
        (e) => e !== a && !e.wantsBot && !e.partner && this.compatible(a, e),
      );
      if (b) {
        a.partner = b;
        b.partner = a;
      }
    }

    const starts: Promise<void>[] = [];
    for (const entry of [...this.queue]) {
      if (!this.queue.includes(entry) || entry.readyAt > now) continue;
      if (entry.partner) {
        if (entry.partner.readyAt > now) continue;
        this.remove(entry, entry.partner);
        starts.push(this.startHumanRound(entry.player, entry.partner.player));
      } else {
        this.remove(entry);
        if (!entry.wantsBot) this.deps.stats.fallbacks++;
        starts.push(this.startBotRound(entry.player));
      }
    }
    await Promise.all(starts);
  }

  private compatible(a: Entry, b: Entry): boolean {
    if (a.player.address.toLowerCase() === b.player.address.toLowerCase()) return false;
    return this.deps.allowSameIp || a.player.ip !== b.player.ip;
  }

  private remove(...entries: Entry[]): void {
    this.queue = this.queue.filter((e) => !entries.includes(e));
  }

  private async startHumanRound(a: Player, b: Player): Promise<void> {
    const roundId = randomBytes32();
    const [ca, cb] = await Promise.all([
      this.deps.commit.issue({
        roundId,
        judge: a.address,
        partnerType: 'HUMAN',
        partnerId: humanPartnerId(b.address),
      }),
      this.deps.commit.issue({
        roundId,
        judge: b.address,
        partnerType: 'HUMAN',
        partnerId: humanPartnerId(a.address),
      }),
    ]);
    // Someone left while receipts were being signed: put whoever is still here back in the queue.
    if (!a.connected || !b.connected) {
      for (const p of [a, b]) if (p.connected) this.join(p);
      return;
    }
    if (!this.takeStakes(a, b)) return;
    const round = new Round({
      roundId,
      seats: [a.seat, b.seat],
      judges: [
        { answer: 'HUMAN', partnerId: humanPartnerId(b.address), commitment: ca },
        { answer: 'HUMAN', partnerId: humanPartnerId(a.address), commitment: cb },
      ],
      settlesAt: () => this.deps.ledger?.epochEndsAt ?? 0,
      onEnd: (outcome) => {
        a.current = undefined;
        b.current = undefined;
        this.deps.stats.record(outcome);
        this.settle(outcome, [a, b]);
      },
    });
    a.current = { round, seat: 0 };
    b.current = { round, seat: 1 };
    this.log(`round ${roundId.slice(0, 10)}: ${a.id} vs ${b.id}`);
    round.start();
  }

  private async startBotRound(player: Player): Promise<void> {
    const roundId = randomBytes32();
    const persona = pickPersona();
    const partnerId = botPartnerId(persona.id);
    const commitment = await this.deps.commit.issue({
      roundId,
      judge: player.address,
      partnerType: 'BOT',
      partnerId,
    });
    if (!player.connected || !this.takeStakes(player)) return;
    const bot = new BotSeat(persona, this.deps.llm);
    // The human's seat number is random too, so seat order can't hint at anything.
    const humanSeat: 0 | 1 = this.rng() < 0.5 ? 0 : 1;
    const botSeat: 0 | 1 = humanSeat === 0 ? 1 : 0;
    const seats: [Seat, Seat] = humanSeat === 0 ? [player.seat, bot] : [bot, player.seat];
    const judge = { answer: 'BOT' as const, partnerId, commitment };
    const round = new Round({
      roundId,
      seats,
      judges: humanSeat === 0 ? [judge, null] : [null, judge],
      persona: { name: persona.name, blurb: persona.blurb },
      settlesAt: () => this.deps.ledger?.epochEndsAt ?? 0,
      onEnd: (outcome) => {
        player.current = undefined;
        this.deps.stats.record(outcome, persona.id);
        const seats: [Player | null, Player | null] =
          humanSeat === 0 ? [player, null] : [null, player];
        this.settle(outcome, seats);
      },
    });
    bot.attach(round, botSeat);
    player.current = { round, seat: humanSeat };
    this.log(`round ${roundId.slice(0, 10)}: ${player.id} vs bot ${persona.id}`);
    round.start();
  }

  /** Takes every player's stake, or none of them. */
  private takeStakes(...players: Player[]): boolean {
    const ledger = this.deps.ledger;
    if (!ledger) return true;
    const taken: Player[] = [];
    for (const p of players) {
      if (!ledger.stake(p.address)) {
        for (const t of taken) ledger.refund(t.address);
        for (const q of players) {
          if (q === p) q.seat.deliver({ type: 'error', message: 'not enough points' });
          else if (q.connected) this.join(q);
        }
        this.sendBalances(taken);
        return false;
      }
      taken.push(p);
    }
    this.sendBalances(players);
    return true;
  }

  /**
   * Hands a finished round's calls to the payout pool. A void or a no-call is refunded; every
   * other call is recorded with its partner (human rounds), so deception shares can be paid.
   */
  private settle(outcome: RoundOutcome, seats: [Player | null, Player | null]): void {
    const ledger = this.deps.ledger;
    if (!ledger) return;
    const judged = new Map(outcome.judges.map((j) => [j.seat, j]));
    seats.forEach((player, i) => {
      if (!player) return;
      const judge = judged.get(i as 0 | 1);
      if (outcome.phase === 'void' || !judge || judge.correct === null) {
        ledger.refund(player.address);
        return;
      }
      const partner = seats[i === 0 ? 1 : 0];
      ledger.record({
        player: player.address,
        partnerType: outcome.kind,
        correct: judge.correct,
        partner: partner
          ? { player: partner.address, correct: judged.get(i === 0 ? 1 : 0)?.correct ?? null }
          : undefined,
      });
    });
    this.sendBalances(seats.filter((p): p is Player => !!p));
  }

  private sendBalances(players: Player[]): void {
    const ledger = this.deps.ledger;
    if (!ledger) return;
    for (const p of players) {
      if (p.connected) p.seat.deliver({ type: 'balance', points: ledger.balance(p.address) });
    }
  }
}
