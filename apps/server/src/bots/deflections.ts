/**
 * What a bot says instead of a generated reply when the model declines or returns nothing.
 * Kept varied so a deflection isn't a fingerprint; M2 adds persona-specific variants.
 */
const DEFLECTIONS = [
  'lol no',
  'haha what',
  'um ok moving on',
  'thats a weird thing to ask',
  'nah',
  'idk what to say to that lol',
  'anyway',
  'lol why',
  'hmm',
  'not answering that haha',
];

export function deflection(rng: () => number = Math.random): string {
  return DEFLECTIONS[Math.floor(rng() * DEFLECTIONS.length)]!;
}
