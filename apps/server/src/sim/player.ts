import { createHash } from 'node:crypto';
import WebSocket from 'ws';
import { generatePrivateKey, privateKeyToAccount } from 'viem/accounts';
import {
  MAX_MESSAGE_CHARS,
  betaLoginText,
  parseServerMessage,
  type Call,
  type ClientMessage,
  type ServerMessage,
} from '@botornot/shared';
import type { LlmGateway } from '../llm/gateway';
import { buildMessages, type Line } from '../bots/runtime';
import { typingPlan } from '../bots/humanizer';

/**
 * How a simulated player behaves. "honest" chats like a normal person; "trickster" plays up being
 * a bot so human partners call BOT on them (the deception share); "sharp" chats normally but
 * probes hard before calling.
 */
export type SimStyle = 'honest' | 'trickster' | 'sharp';
export const SIM_STYLES: SimStyle[] = ['honest', 'trickster', 'sharp'];

const PEOPLE = [
  { name: 'Sam', about: '31, nurse in Melbourne, into footy and cooking' },
  { name: 'Priya', about: '27, software tester in Toronto, plays a lot of board games' },
  { name: 'Marco', about: '45, runs a small café in Lisbon, two teenage kids' },
  { name: 'Hannah', about: '19, uni student in Manchester, studying history' },
  { name: 'Leo', about: '36, electrician in Auckland, surfs on weekends' },
  { name: 'Aisha', about: '29, primary teacher in Dublin, learning guitar' },
];

const STYLE_NOTES: Record<SimStyle, string> = {
  honest: 'Just chat naturally and try to work out if they are a bot.',
  trickster:
    'You earn extra if your partner wrongly calls YOU a bot, so play it up: now and then sound ' +
    'stiff, overly formal or suspiciously precise, or joke "as an AI language model". Keep it ' +
    'subtle enough to be believable, and still try to work out if they are a bot.',
  sharp:
    'You are good at this game. Probe for tells: ask about something that happened today, ask ' +
    'for an opinion they would have to commit to, or ask them to spell a word backwards.',
};

function chatPrompt(name: string, about: string, style: SimStyle): string {
  return `You are ${name}, ${about}. You are a real person playing "BOT or NOT" on your phone: a two-minute text chat with a stranger who is either another human or an AI bot. Afterwards you both guess which.

${STYLE_NOTES[style]}

Text like a person on a phone: one short casual message, usually under 12 words, never more than ${MAX_MESSAGE_CHARS} characters, little punctuation. Reply with only your next message.`;
}

const JUDGE_PROMPT = `You just played "BOT or NOT": a two-minute text chat with a stranger who was either a human or an AI bot trying to pass as human. Humans sometimes pretend to be bots to trick you. Read the chat and decide. Answer with exactly one word: BOT if you think your partner was an AI, NOT if you think they were a human.`;

export interface SimOptions {
  url: string;
  index: number;
  style: SimStyle;
  llm: LlmGateway;
  log: (msg: string) => void;
  /** Stop after this many finished rounds (default: play until stopped). */
  maxRounds?: number;
  /** Called with every round result, e.g. to tally accuracy. */
  onResult?: (result: Extract<ServerMessage, { type: 'round.result' }>) => void;
  /** Called once the player has played maxRounds. */
  onDone?: () => void;
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
const between = (min: number, max: number) => min + Math.random() * (max - min);

/** A scripted player that connects like a browser would and plays rounds until stopped. */
export class SimPlayer {
  readonly name: string;
  private readonly about: string;
  private readonly address = privateKeyToAccount(generatePrivateKey()).address;
  private ws?: WebSocket;
  private lines: Line[] = [];
  private turnToken = 0;
  private stopped = false;
  private rounds = 0;
  points?: number;

  constructor(private readonly opts: SimOptions) {
    const person = PEOPLE[opts.index % PEOPLE.length]!;
    this.name = `${person.name}#${opts.index + 1}`;
    this.about = person.about;
  }

  get label(): string {
    return `${this.name} (${this.opts.style})`;
  }

  start(): void {
    const ws = new WebSocket(this.opts.url);
    this.ws = ws;
    ws.on('open', () => {
      this.send({
        type: 'hello',
        address: this.address,
        invite: process.env.INVITE_CODE || undefined,
        login: simLogin(),
      });
      void this.requeue(0);
    });
    ws.on('message', (data) => {
      const msg = parseServerMessage(data.toString());
      if (msg) this.onMessage(msg);
    });
    ws.on('close', () => {
      if (!this.stopped) this.opts.log(`${this.label}: disconnected`);
    });
    ws.on('error', (err) => this.opts.log(`${this.label}: ${err.message}`));
  }

  stop(): void {
    this.stopped = true;
    this.ws?.close();
  }

  private send(msg: ClientMessage): void {
    if (this.ws?.readyState === WebSocket.OPEN) this.ws.send(JSON.stringify(msg));
  }

  private onMessage(msg: ServerMessage): void {
    switch (msg.type) {
      case 'match.found':
        this.lines = [];
        break;
      case 'chat.message':
        this.lines.push({ from: msg.from, text: msg.text });
        break;
      case 'turn':
        this.turnToken++;
        if (msg.yours) void this.takeTurn(this.turnToken);
        break;
      case 'call.open':
        this.turnToken++;
        void this.makeCall();
        break;
      case 'round.result': {
        const verdict = msg.correct === null ? 'no call' : msg.correct ? 'right' : 'fooled';
        this.opts.log(
          `${this.label}: partner was ${msg.answer}, called ${msg.yourCall} (${verdict})`,
        );
        this.opts.onResult?.(msg);
        this.finishRound();
        break;
      }
      case 'round.void':
        this.turnToken++;
        this.finishRound();
        break;
      case 'balance':
        this.points = msg.points;
        break;
      case 'epoch.settled':
        this.opts.log(
          `${this.label}: pool #${msg.epoch} settled ${msg.you.net >= 0 ? '+' : ''}${msg.you.net}` +
            (msg.you.deception ? ` (incl. +${msg.you.deception} for fooling a partner)` : ''),
        );
        break;
      case 'error':
        if (msg.message === 'not enough points') void this.requeue(30_000);
        break;
    }
  }

  private finishRound(): void {
    this.rounds++;
    if (this.opts.maxRounds !== undefined && this.rounds >= this.opts.maxRounds) {
      this.stop();
      this.opts.onDone?.();
      return;
    }
    void this.requeue();
  }

  /** Back in the queue after a short, human-looking pause. */
  private async requeue(pauseMs = between(2_000, 8_000)): Promise<void> {
    await sleep(pauseMs);
    if (!this.stopped) this.send({ type: 'queue.join' });
  }

  private async takeTurn(token: number): Promise<void> {
    const started = Date.now();
    let reply: string | null = null;
    try {
      reply = await this.opts.llm.reply({
        system: chatPrompt(this.name.split('#')[0]!, this.about, this.opts.style),
        messages: buildMessages(this.lines, '(you are in the chat now)'),
        maxTokens: 512,
      });
    } catch (err) {
      this.opts.log(`${this.label}: LLM error: ${(err as Error).message}`);
    }
    if (token !== this.turnToken) return;
    const text = (reply ?? 'sorry was distracted, what was that')
      .trim()
      .slice(0, MAX_MESSAGE_CHARS);
    const plan = typingPlan(text, Date.now() - started);
    await sleep(plan.readMs);
    for (let typed = 0; typed < plan.typeMs; typed += 2_000) {
      if (token !== this.turnToken) return;
      this.send({ type: 'chat.typing' });
      await sleep(Math.min(2_000, plan.typeMs - typed));
    }
    if (token === this.turnToken) this.send({ type: 'chat.send', text });
  }

  private async makeCall(): Promise<void> {
    await sleep(between(1_000, 4_000));
    let call: Call = Math.random() < 0.5 ? 'BOT' : 'NOT';
    try {
      const transcript = this.lines
        .map((l) => `${l.from === 'you' ? 'Me' : 'Them'}: ${l.text}`)
        .join('\n');
      const answer = await this.opts.llm.reply({
        system: JUDGE_PROMPT,
        messages: [{ role: 'user', content: transcript || '(they never said anything)' }],
        maxTokens: 256,
      });
      const word = answer?.trim().toUpperCase();
      if (word === 'BOT' || word === 'NOT') call = word;
    } catch (err) {
      this.opts.log(`${this.label}: LLM error while calling: ${(err as Error).message}`);
    }
    this.send({ type: 'call.submit', call });
  }
}

/** The beta login from .env, for a private server without an invite code. */
function simLogin(): string | undefined {
  const { BETA_USERNAME: username, BETA_PASSWORD: password } = process.env;
  if (!username || !password) return undefined;
  return createHash('sha256').update(betaLoginText(username, password)).digest('hex');
}
