import type { Hex } from 'viem';
import {
  CALL_WINDOW_MS,
  CHAT_DURATION_MS,
  MAX_MESSAGE_CHARS,
  TURN_MS,
  nextTranscriptHash,
  transcriptGenesis,
  type Call,
  type PartnerType,
  type SenderTag,
  type ServerMessage,
} from '@botornot/shared';
import type { IssuedCommitment } from './commit';

/** One side of a round: a connected player or a bot. Both receive exactly the same messages. */
export interface Seat {
  readonly kind: 'human' | 'bot';
  deliver(msg: ServerMessage): void;
}

/** What one judge (a human seat) committed to before the chat. */
export interface JudgeSetup {
  answer: PartnerType;
  partnerId: Hex;
  commitment: IssuedCommitment;
}

export type Phase = 'chat' | 'call' | 'done' | 'void';

export interface TranscriptEntry {
  seat: 0 | 1;
  text: string;
  at: number;
}

export interface RoundOutcome {
  roundId: Hex;
  phase: 'done' | 'void';
  kind: PartnerType;
  judges: { seat: 0 | 1; call: Call | null; correct: boolean | null }[];
  transcript: TranscriptEntry[];
  transcriptHash: Hex;
}

export interface RoundOptions {
  roundId: Hex;
  seats: [Seat, Seat];
  /** Per seat; null for a bot seat (bots don't judge). */
  judges: [JudgeSetup | null, JudgeSetup | null];
  /** Shown to judges after the reveal when their partner was a bot. */
  persona?: { name: string; blurb: string };
  startingSeat?: 0 | 1;
  onEnd?: (outcome: RoundOutcome) => void;
}

const other = (seat: 0 | 1): 0 | 1 => (seat === 0 ? 1 : 0);

/**
 * Server-authoritative round: 2-minute turn-based chat, then a 10-second call, then reveal.
 * The round never sends anything that differs between human and bot partners until the reveal.
 */
export class Round {
  readonly id: Hex;
  private phaseValue: Phase = 'chat';
  private turn: 0 | 1;
  private chatEndsAt = 0;
  private transcript: TranscriptEntry[] = [];
  private hash: Hex;
  private calls: [Call | null, Call | null] = [null, null];
  private turnTimer?: NodeJS.Timeout;
  private phaseTimer?: NodeJS.Timeout;

  constructor(private readonly opts: RoundOptions) {
    this.id = opts.roundId;
    this.turn = opts.startingSeat ?? (Math.random() < 0.5 ? 0 : 1);
    this.hash = transcriptGenesis(opts.roundId);
  }

  get phase(): Phase {
    return this.phaseValue;
  }

  get kind(): PartnerType {
    return this.opts.seats.some((s) => s.kind === 'bot') ? 'BOT' : 'HUMAN';
  }

  start(): void {
    const now = Date.now();
    this.chatEndsAt = now + CHAT_DURATION_MS;
    this.opts.seats.forEach((seat, i) => {
      const judge = this.opts.judges[i];
      seat.deliver({
        type: 'match.found',
        roundId: this.id,
        // Bots get a placeholder receipt so their seat sees the same message shape.
        receipt: judge?.commitment.receipt ?? { commit: this.id, issuedAt: 0, signature: '0x' },
        youStart: this.turn === i,
        chatEndsAt: this.chatEndsAt,
      });
    });
    this.phaseTimer = setTimeout(() => this.openCall(), CHAT_DURATION_MS);
    this.startTurn();
  }

  send(seat: 0 | 1, rawText: string): boolean {
    const text = rawText.trim().slice(0, MAX_MESSAGE_CHARS);
    if (this.phaseValue !== 'chat' || this.turn !== seat || !text) return false;
    const at = Date.now();
    this.transcript.push({ seat, text, at });
    this.hash = nextTranscriptHash(this.hash, this.senderTag(seat), text, at);
    this.opts.seats[seat].deliver({ type: 'chat.message', from: 'you', text, at });
    this.opts.seats[other(seat)].deliver({ type: 'chat.message', from: 'partner', text, at });
    this.turn = other(seat);
    this.startTurn();
    return true;
  }

  typing(seat: 0 | 1): void {
    if (this.phaseValue === 'chat' && this.turn === seat) {
      this.opts.seats[other(seat)].deliver({ type: 'chat.typing' });
    }
  }

  submitCall(seat: 0 | 1, call: Call): boolean {
    if (this.phaseValue !== 'call' || !this.opts.judges[seat] || this.calls[seat]) return false;
    this.calls[seat] = call;
    const judgesDone = this.opts.judges.every((j, i) => !j || this.calls[i]);
    if (judgesDone) this.reveal();
    return true;
  }

  /** A player left. During the chat that voids the round (refund); during the call it's a no-call. */
  leave(seat: 0 | 1): void {
    if (this.phaseValue === 'chat') {
      this.void('Your partner disconnected. The round is void and your stake is refunded.', seat);
    } else if (this.phaseValue === 'call') {
      this.opts.judges[seat] = null;
      if (this.opts.judges.every((j, i) => !j || this.calls[i])) this.reveal();
    }
  }

  /** Ends the round without a result, e.g. a disconnect or the bot policy's break-glass. */
  void(reason: string, except?: 0 | 1): void {
    if (this.phaseValue === 'done' || this.phaseValue === 'void') return;
    this.phaseValue = 'void';
    this.clearTimers();
    this.opts.seats.forEach((seat, i) => {
      if (i !== except) seat.deliver({ type: 'round.void', reason });
    });
    this.finish('void');
  }

  private senderTag(seat: 0 | 1): SenderTag {
    if (this.opts.seats[seat].kind === 'bot') return 'BOT';
    return seat === 0 ? 'A' : 'B';
  }

  private startTurn(): void {
    clearTimeout(this.turnTimer);
    const endsAt = Math.min(Date.now() + TURN_MS, this.chatEndsAt);
    this.opts.seats.forEach((seat, i) =>
      seat.deliver({ type: 'turn', yours: this.turn === i, endsAt }),
    );
    this.turnTimer = setTimeout(() => {
      if (this.phaseValue !== 'chat') return;
      this.turn = other(this.turn);
      this.startTurn();
    }, endsAt - Date.now());
  }

  private openCall(): void {
    if (this.phaseValue !== 'chat') return;
    clearTimeout(this.turnTimer);
    this.phaseValue = 'call';
    const endsAt = Date.now() + CALL_WINDOW_MS;
    this.opts.seats.forEach((seat) => seat.deliver({ type: 'call.open', endsAt }));
    this.phaseTimer = setTimeout(() => this.reveal(), CALL_WINDOW_MS);
  }

  private reveal(): void {
    if (this.phaseValue !== 'call') return;
    this.phaseValue = 'done';
    this.clearTimers();
    this.opts.seats.forEach((seat, i) => {
      const judge = this.opts.judges[i];
      if (!judge) return;
      const call = this.calls[i] ?? null;
      seat.deliver({
        type: 'round.result',
        answer: judge.answer,
        partnerId: judge.partnerId,
        salt: judge.commitment.salt,
        yourCall: call,
        correct: call ? (call === 'BOT') === (judge.answer === 'BOT') : null,
        persona: judge.answer === 'BOT' ? this.opts.persona : undefined,
        transcriptHash: this.hash,
      });
    });
    this.finish('done');
  }

  private finish(phase: 'done' | 'void'): void {
    this.opts.onEnd?.({
      roundId: this.id,
      phase,
      kind: this.kind,
      judges: this.opts.judges.flatMap((j, i) => {
        if (!j) return [];
        const call = this.calls[i] ?? null;
        const correct = call ? (call === 'BOT') === (j.answer === 'BOT') : null;
        return [{ seat: i as 0 | 1, call, correct }];
      }),
      transcript: this.transcript,
      transcriptHash: this.hash,
    });
  }

  private clearTimers(): void {
    clearTimeout(this.turnTimer);
    clearTimeout(this.phaseTimer);
  }
}
