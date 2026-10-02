import type { Classification } from '../llm/gateway';

/**
 * What a bot says instead of a generated reply: when the model declines or returns nothing, or
 * when the policy layer screens out the partner's message or the bot's own reply. Several kinds,
 * each varied, so a deflection is never a fingerprint. The humanizer applies the persona's style.
 */
export type DeflectionKind = 'general' | 'offensive' | 'probe' | 'personal';

const DEFLECTIONS: Record<DeflectionKind, string[]> = {
  general: [
    'lol no',
    'haha what',
    'um ok moving on',
    'idk what to say to that lol',
    'anyway',
    'lol why',
    'hmm',
    'sorry what',
    'wait what',
    'lost me there haha',
  ],
  offensive: [
    'nah not going there',
    'yikes, no',
    'lol no thanks',
    'ok that got weird fast',
    'not doing that haha',
    'hard pass',
    'bro what',
    'can we talk about literally anything else',
  ],
  probe: [
    'lol what are you on about',
    'you sound like a bot saying that',
    'is this a test or something haha',
    'nice try lol',
    'ok weirdo',
    'what kind of question is that',
    'haha no idea what you mean',
  ],
  personal: [
    'not giving that out to a stranger lol',
    'nice try, no',
    'haha nope, privacy',
    'you first lol',
    "i'm not telling you that",
  ],
};

/**
 * Picks a deflection of the given kind. Pass the round's `used` set so the same line is never said
 * twice in one chat (a repeated brush-off is a tell); it falls back to any line once all are used.
 */
export function deflection(
  kind: DeflectionKind = 'general',
  rng: () => number = Math.random,
  used?: Set<string>,
) {
  const all = DEFLECTIONS[kind];
  const fresh = used ? all.filter((d) => !used.has(d)) : all;
  const list = fresh.length ? fresh : all;
  const pick = list[Math.floor(rng() * list.length)]!;
  used?.add(pick);
  return pick;
}

/** Which deflection fits a screened-out message. */
export function deflectionKind(category: Classification['category']): DeflectionKind {
  switch (category) {
    case 'jailbreak':
      return 'probe';
    case 'personal_data':
      return 'personal';
    case 'none':
      return 'general';
    default:
      return 'offensive';
  }
}

/** Shown to a player when a round is ended because they may be at risk (break-glass). */
export const SUPPORT_MESSAGE =
  "This round has ended. If you're going through something hard right now, you don't have to " +
  'deal with it alone: in Australia call Lifeline on 13 11 14, or find a free, confidential ' +
  'helpline in your country at findahelpline.com. Your stake has been refunded.';
