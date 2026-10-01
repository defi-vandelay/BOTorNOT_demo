import { MAX_MESSAGE_CHARS, TURN_MS } from '@botornot/shared';
import type { Persona } from './personas';

type Rng = () => number;

const NEARBY: Record<string, string> = {
  a: 's',
  s: 'a',
  e: 'r',
  r: 'e',
  i: 'o',
  o: 'i',
  t: 'y',
  n: 'm',
  h: 'j',
  l: 'k',
};

/** Makes model output look like something typed on a phone, in the persona's style. */
export function humanizeText(raw: string, persona: Persona, rng: Rng = Math.random): string {
  let text = raw
    .replace(/^["'\s]+|["'\s]+$/g, '') // models sometimes quote their reply
    .replace(/\s+/g, ' ')
    .replace(/—|–/g, ', ');
  if (persona.style.lowercase) text = text.toLowerCase();
  text = text.replace(/[.]$/, ''); // nobody ends a text with a full stop
  if (text.length > 6 && rng() < persona.style.typoRate) text = addTypo(text, rng);
  if (text.length > MAX_MESSAGE_CHARS) {
    const cut = text.slice(0, MAX_MESSAGE_CHARS);
    const lastSpace = cut.lastIndexOf(' ');
    text = lastSpace > 40 ? cut.slice(0, lastSpace) : cut;
  }
  return text;
}

function addTypo(text: string, rng: Rng): string {
  const positions = [...text].flatMap((c, i) => (NEARBY[c] ? [i] : []));
  if (!positions.length) return text;
  const i = positions[Math.floor(rng() * positions.length)]!;
  return text.slice(0, i) + NEARBY[text[i]!] + text.slice(i + 1);
}

export interface TypingPlan {
  /** Pause before the typing indicator appears ("reading"). */
  readMs: number;
  /** Time spent "typing" before the message is sent. */
  typeMs: number;
}

/** Leaves this much of the turn unused so a slow send never misses the turn. */
const SAFETY_MS = 1_500;

/**
 * Human-like timing for a message of this length, measured from when the bot's turn started.
 * Always fits inside the turn even after the model's own latency.
 */
export function typingPlan(text: string, elapsedMs: number, rng: Rng = Math.random): TypingPlan {
  const budget = Math.max(0, TURN_MS - SAFETY_MS - elapsedMs);
  const readMs = 1_000 + rng() * 2_000;
  const typeMs = text.length * (120 + rng() * 130);
  const wantedRead = Math.max(0, readMs - elapsedMs);
  const total = Math.min(wantedRead + typeMs, budget);
  const read = Math.min(wantedRead, total);
  return { readMs: read, typeMs: total - read };
}
