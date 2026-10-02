import type { Persona } from './personas';

/** Local time for the persona, so "what time is it there?" isn't a giveaway. */
export function localTimeNote(persona: Persona, now = new Date()): string {
  const when = now.toLocaleString('en-GB', {
    timeZone: persona.timezone,
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
  });
  return `it's ${when} where you are`;
}

const MAX_HEADLINES = 5;
const MAX_HEADLINE_CHARS = 140;
const REFRESH_MS = 60 * 60_000;

/** Pulls item titles out of an RSS document, cleaned up and capped. */
export function parseRssTitles(xml: string): string[] {
  const titles: string[] = [];
  for (const item of xml.matchAll(/<item[\s>][\s\S]*?<\/item>/g)) {
    const title = /<title>([\s\S]*?)<\/title>/.exec(item[0])?.[1];
    if (!title) continue;
    const clean = title
      .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
      .replace(/<[^>]*>/g, '')
      .replace(/&amp;/g, '&')
      .replace(/&quot;/g, '"')
      .replace(/&#39;|&apos;/g, "'")
      .replace(/&lt;|&gt;/g, '')
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, MAX_HEADLINE_CHARS);
    if (clean) titles.push(clean);
    if (titles.length === MAX_HEADLINES) break;
  }
  return titles;
}

/**
 * Today's headlines, so a bot can react to "did you see the news?" like someone who glanced at
 * their phone this morning. Refreshed hourly; on any failure the bots just have no headlines.
 */
export class Headlines {
  private titles: string[] = [];
  private fetchedAt = 0;
  private inflight?: Promise<void>;

  constructor(
    private readonly url: string | null,
    private readonly log: (msg: string) => void = () => {},
  ) {}

  /** Current headlines; triggers a background refresh when stale and never waits for it. */
  current(now = Date.now()): string[] {
    if (this.url && !this.inflight && now - this.fetchedAt > REFRESH_MS) {
      this.inflight = this.refresh(now).finally(() => (this.inflight = undefined));
    }
    return this.titles;
  }

  private async refresh(now: number): Promise<void> {
    this.fetchedAt = now;
    try {
      const res = await fetch(this.url!, { signal: AbortSignal.timeout(5_000) });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      this.titles = parseRssTitles(await res.text());
    } catch (err) {
      this.log(`headlines: ${(err as Error).message}`);
    }
  }
}

/** The volatile context for one bot turn; goes in the messages, not the cached system prompt. */
export function contextNote(persona: Persona, headlines: string[], now = new Date()): string {
  const parts = [localTimeNote(persona, now)];
  if (headlines.length) {
    parts.push(
      `headlines you might have half-noticed today (only bring up if it comes up): ${headlines.join('; ')}`,
    );
  }
  return `(${parts.join('. ')})`;
}
