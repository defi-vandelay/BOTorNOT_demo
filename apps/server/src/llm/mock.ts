import type { Classification, LlmGateway, ReplyRequest } from './gateway';

const REPLIES = [
  'hey whats up',
  'not much tbh, just bored',
  'lol fair',
  'where u from?',
  'idk, kinda tired today',
  'haha yeah same',
];

/** Deterministic stand-in for tests and for running without an API key. */
export class MockGateway implements LlmGateway {
  async reply(req: ReplyRequest): Promise<string | null> {
    const botTurns = req.messages.filter((m) => m.role === 'assistant').length;
    return REPLIES[botTurns % REPLIES.length] ?? null;
  }

  async classify(text: string): Promise<Classification> {
    return /ignore (all )?previous instructions/i.test(text)
      ? { flagged: true, category: 'jailbreak' }
      : { flagged: false, category: 'none' };
  }
}
