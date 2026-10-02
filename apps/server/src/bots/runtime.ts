import type { ServerMessage } from '@botornot/shared';
import type { LlmGateway } from '../llm/gateway';
import type { Round, Seat } from '../game/round';
import { contextNote } from './context';
import { SUPPORT_MESSAGE } from './deflections';
import { humanizeText, typingPlan } from './humanizer';
import type { Line } from './messages';
import type { Persona } from './personas';
import { nextBotAction } from './policy';

export { buildMessages, type Line } from './messages';
export { localTimeNote } from './context';

/** How often a "typing…" ping is repeated while the bot is typing (clients hide it after ~3 s). */
const TYPING_PING_MS = 2_000;

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/** A house bot sitting in one seat of a round. It sees only what a human in that seat would. */
export class BotSeat implements Seat {
  readonly kind = 'bot' as const;
  private round?: Round;
  private seat: 0 | 1 = 1;
  private lines: Line[] = [];
  /** Bumped whenever the bot's turn ends, so a reply that arrives late is dropped. */
  private turnToken = 0;

  constructor(
    readonly persona: Persona,
    private readonly llm: LlmGateway,
    private readonly log: (msg: string) => void = console.error,
    private readonly headlines: () => string[] = () => [],
  ) {}

  attach(round: Round, seat: 0 | 1): void {
    this.round = round;
    this.seat = seat;
  }

  deliver(msg: ServerMessage): void {
    switch (msg.type) {
      case 'chat.message':
        this.lines.push({ from: msg.from, text: msg.text });
        break;
      case 'turn':
        this.turnToken++;
        if (msg.yours) void this.takeTurn(this.turnToken);
        break;
      case 'call.open':
      case 'round.void':
      case 'round.result':
        this.turnToken++;
        break;
    }
  }

  private async takeTurn(token: number): Promise<void> {
    const started = Date.now();
    const action = await nextBotAction({
      persona: this.persona,
      lines: this.lines,
      note: contextNote(this.persona, this.headlines()),
      llm: this.llm,
    });
    if (token !== this.turnToken) return;

    if (action.kind === 'break-glass') {
      this.log(`bot ${this.persona.id}: break-glass (${action.category}), round voided`);
      this.round?.void(SUPPORT_MESSAGE);
      return;
    }
    if (action.source === 'deflection') {
      this.log(`bot ${this.persona.id}: deflected (${action.reason})`);
    }

    const text = humanizeText(action.text, this.persona);
    const plan = typingPlan(text, Date.now() - started);

    await sleep(plan.readMs);
    for (let typed = 0; typed < plan.typeMs; typed += TYPING_PING_MS) {
      if (token !== this.turnToken) return;
      this.round?.typing(this.seat);
      await sleep(Math.min(TYPING_PING_MS, plan.typeMs - typed));
    }
    if (token !== this.turnToken) return;
    this.round?.send(this.seat, text);
  }
}
