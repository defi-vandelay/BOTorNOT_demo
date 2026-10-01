import type { ServerMessage } from '@botornot/shared';
import type { ChatTurn, LlmGateway } from '../llm/gateway';
import type { Round, Seat } from '../game/round';
import { deflection } from './deflections';
import { humanizeText, typingPlan } from './humanizer';
import { systemPrompt, type Persona } from './personas';

export interface Line {
  from: 'you' | 'partner';
  text: string;
}

/** How often a "typing…" ping is repeated while the bot is typing (clients hide it after ~3 s). */
const TYPING_PING_MS = 2_000;

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/** Local time for the persona, so "what time is it there?" isn't a giveaway. */
export function localTimeNote(persona: Persona, now = new Date()): string {
  const when = now.toLocaleString('en-GB', {
    timeZone: persona.timezone,
    weekday: 'long',
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
  });
  return `(it's ${when} where you are)`;
}

/**
 * Turns the chat so far into Messages API turns: the partner is "user", the bot is "assistant".
 * Consecutive lines from one side are merged, and the list always starts and ends with a user turn.
 */
export function buildMessages(lines: Line[], note: string): ChatTurn[] {
  const turns: ChatTurn[] = [];
  for (const line of lines) {
    const role = line.from === 'you' ? 'assistant' : 'user';
    const last = turns.at(-1);
    if (last?.role === role) last.content += `\n${line.text}`;
    else turns.push({ role, content: line.text });
  }
  if (turns[0]?.role !== 'user') {
    const opener = turns.length ? '(chat started, you went first)' : '(chat started, you go first)';
    turns.unshift({ role: 'user', content: opener });
  }
  if (turns.at(-1)?.role !== 'user')
    turns.push({ role: 'user', content: "(they haven't replied)" });
  turns[0]!.content = `${note}\n${turns[0]!.content}`;
  return turns;
}

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
    let reply: string | null = null;
    try {
      reply = await this.llm.reply({
        system: systemPrompt(this.persona),
        messages: buildMessages(this.lines, localTimeNote(this.persona)),
        maxTokens: 1024,
      });
    } catch (err) {
      this.log(`bot ${this.persona.id}: LLM error: ${(err as Error).message}`);
    }
    if (token !== this.turnToken) return;

    const text = humanizeText(reply ?? deflection(), this.persona);
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
