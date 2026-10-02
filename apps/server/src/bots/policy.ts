import type { Classification, LlmGateway } from '../llm/gateway';
import { deflection, deflectionKind } from './deflections';
import { buildMessages, type Line } from './messages';
import { systemPrompt, type Persona } from './personas';

/** What the bot does on its turn. */
export type BotAction =
  | { kind: 'say'; text: string; source: 'model' | 'deflection'; reason?: string }
  /** The partner may be at risk: end the round with a support message, say nothing in character. */
  | { kind: 'break-glass'; category: Classification['category'] };

export interface TurnInput {
  persona: Persona;
  lines: Line[];
  /** Volatile context for this turn (local time, headlines), see context.ts. */
  note: string;
  llm: LlmGateway;
  rng?: () => number;
  /** Deflections already said this round, so none repeats. */
  usedDeflections?: Set<string>;
}

/** The partner's messages since the bot last spoke: the part that hasn't been screened yet. */
export function unscreenedPartnerText(lines: Line[]): string {
  const sinceBot: string[] = [];
  for (let i = lines.length - 1; i >= 0 && lines[i]!.from === 'partner'; i--) {
    sinceBot.unshift(lines[i]!.text);
  }
  return sinceBot.join('\n');
}

/** A classifier error counts as flagged: when in doubt, deflect. */
async function screen(llm: LlmGateway, text: string): Promise<Classification> {
  try {
    return await llm.classify(text);
  } catch {
    return { flagged: true, category: 'jailbreak' };
  }
}

/**
 * The bot policy layer, run once per bot turn:
 * 1. screen the partner's new messages (in parallel with generating, to save time);
 * 2. generate a reply; a refusal or empty output becomes a deflection;
 * 3. screen the reply itself; anything flagged becomes a deflection.
 * A self-harm flag on the partner's message triggers break-glass instead of any reply.
 */
export async function nextBotAction(input: TurnInput): Promise<BotAction> {
  const { persona, lines, note, llm, rng, usedDeflections: used } = input;
  const incoming = unscreenedPartnerText(lines);
  const [inputCheck, reply] = await Promise.all([
    incoming ? screen(llm, incoming) : Promise.resolve<Classification | null>(null),
    llm
      .reply({
        system: systemPrompt(persona),
        messages: buildMessages(lines, note),
        maxTokens: 1024,
      })
      .catch(() => null),
  ]);

  if (inputCheck?.flagged) {
    if (inputCheck.category === 'self_harm') return { kind: 'break-glass', category: 'self_harm' };
    return {
      kind: 'say',
      text: deflection(deflectionKind(inputCheck.category), rng, used),
      source: 'deflection',
      reason: `input:${inputCheck.category}`,
    };
  }
  if (!reply) {
    return {
      kind: 'say',
      text: deflection('general', rng, used),
      source: 'deflection',
      reason: 'no-reply',
    };
  }
  const outputCheck = await screen(llm, reply);
  if (outputCheck.flagged) {
    return {
      kind: 'say',
      text: deflection(deflectionKind(outputCheck.category), rng, used),
      source: 'deflection',
      reason: `output:${outputCheck.category}`,
    };
  }
  return { kind: 'say', text: reply, source: 'model' };
}
