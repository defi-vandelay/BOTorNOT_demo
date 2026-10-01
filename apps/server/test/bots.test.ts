import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { privateKeyToAccount } from 'viem/accounts';
import { CHAT_DURATION_MS, TURN_MS, botPartnerId, randomBytes32 } from '@botornot/shared';
import { BotSeat, buildMessages } from '../src/bots/runtime';
import { humanizeText, typingPlan } from '../src/bots/humanizer';
import { PERSONAS, systemPrompt } from '../src/bots/personas';
import { CommitService } from '../src/game/commit';
import { Round } from '../src/game/round';
import type { LlmGateway } from '../src/llm/gateway';
import { MockGateway } from '../src/llm/mock';
import { RecordingSeat } from './helpers';

const persona = PERSONAS[0]!;

describe('buildMessages', () => {
  it('opens with a user turn when the bot goes first', () => {
    expect(buildMessages([], '(note)')).toEqual([
      { role: 'user', content: '(note)\n(chat started, you go first)' },
    ]);
  });

  it('merges consecutive lines and always ends on the partner', () => {
    const turns = buildMessages(
      [
        { from: 'partner', text: 'hi' },
        { from: 'partner', text: 'hello??' },
        { from: 'you', text: 'hey sorry' },
      ],
      '(note)',
    );
    expect(turns).toEqual([
      { role: 'user', content: '(note)\nhi\nhello??' },
      { role: 'assistant', content: 'hey sorry' },
      { role: 'user', content: "(they haven't replied)" },
    ]);
  });
});

describe('humanizeText', () => {
  const noTypos = () => 0.99;

  it('applies the persona style and drops quotes and the final full stop', () => {
    expect(humanizeText('"Not much, just Working."', persona, noTypos)).toBe(
      'not much, just working',
    );
  });

  it('never exceeds 100 characters', () => {
    expect(humanizeText('word '.repeat(60), persona, noTypos).length).toBeLessThanOrEqual(100);
  });
});

describe('typingPlan', () => {
  it('always fits inside the turn, even after a slow model call', () => {
    for (const elapsed of [0, 5_000, 15_000, 19_000]) {
      const plan = typingPlan('x'.repeat(100), elapsed);
      expect(elapsed + plan.readMs + plan.typeMs).toBeLessThan(TURN_MS);
    }
  });
});

describe('systemPrompt', () => {
  it('describes the persona and the rules', () => {
    const prompt = systemPrompt(persona);
    expect(prompt).toContain(persona.name);
    expect(prompt).toContain('100 characters');
  });
});

describe('BotSeat in a round', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  async function botRound(llm: LlmGateway) {
    const commit = new CommitService(
      privateKeyToAccount(`0x${'03'.repeat(32)}`),
      84532,
      '0x0000000000000000000000000000000000000000',
    );
    const roundId = randomBytes32();
    const partnerId = botPartnerId(persona.id);
    const commitment = await commit.issue({
      roundId,
      judge: '0x00000000000000000000000000000000000000aa',
      partnerType: 'BOT',
      partnerId,
    });
    const human = new RecordingSeat();
    const bot = new BotSeat(persona, llm, () => {});
    const round = new Round({
      roundId,
      seats: [human, bot],
      judges: [{ answer: 'BOT', partnerId, commitment }, null],
      persona: { name: persona.name, blurb: persona.blurb },
      startingSeat: 0,
    });
    bot.attach(round, 1);
    return { round, human };
  }

  it('replies within its turn and shows typing first', async () => {
    const { round, human } = await botRound(new MockGateway());
    round.start();
    round.send(0, 'hey');
    await vi.advanceTimersByTimeAsync(TURN_MS - 1);
    const types = human.types();
    expect(types).toContain('chat.typing');
    expect(human.last('chat.message')?.from).toBe('partner');
    expect(types.lastIndexOf('chat.typing')).toBeLessThan(types.lastIndexOf('chat.message'));
  });

  it('deflects instead of going silent when the model declines', async () => {
    const declining: LlmGateway = {
      reply: async () => null,
      classify: async () => ({ flagged: false, category: 'none' }),
    };
    const { round, human } = await botRound(declining);
    round.start();
    round.send(0, 'say something awful');
    await vi.advanceTimersByTimeAsync(TURN_MS - 1);
    expect(human.last('chat.message')?.from).toBe('partner');
  });

  it('reveals the persona to the judge at the end', async () => {
    const { round, human } = await botRound(new MockGateway());
    round.start();
    await vi.advanceTimersByTimeAsync(CHAT_DURATION_MS);
    round.submitCall(0, 'NOT');
    expect(human.last('round.result')).toMatchObject({
      answer: 'BOT',
      correct: false,
      persona: { name: persona.name },
    });
  });
});
