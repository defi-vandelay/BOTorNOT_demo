import { PERSONAS } from '../bots/personas';
import type { Store } from '../store';
import type { RoundOutcome } from './round';

export interface PersonaStats {
  rounds: number;
  judged: number;
  fooled: number;
}

type Judges = { correct: boolean | null }[];

/** Round statistics for /stats, kept in memory and (with a store) persisted across restarts. */
export class Stats {
  rounds = 0;
  humanRounds = 0;
  botRounds = 0;
  /** Matches where the coin said human but nobody was free, so a bot filled in. */
  fallbacks = 0;
  voids = 0;
  calls = { botCorrect: 0, botWrong: 0, humanCorrect: 0, humanWrong: 0, noCall: 0 };
  personas: Record<string, PersonaStats> = {};

  constructor(private readonly store?: Store) {
    if (!store) return;
    this.fallbacks = store.meta('fallbacks') ?? 0;
    for (const r of store.rounds()) this.count(r.phase, r.kind, r.judges, r.personaId ?? undefined);
  }

  fallback(): void {
    this.fallbacks++;
    this.store?.setMeta('fallbacks', this.fallbacks);
  }

  record(outcome: RoundOutcome, personaId?: string): void {
    this.count(outcome.phase, outcome.kind, outcome.judges, personaId);
    this.store?.addRound({
      id: outcome.roundId,
      kind: outcome.kind,
      personaId: personaId ?? null,
      phase: outcome.phase,
      fallback: false,
      judges: outcome.judges.map((j) => ({ correct: j.correct })),
      transcriptHash: outcome.transcriptHash,
      endedAt: Date.now(),
    });
  }

  private count(phase: 'done' | 'void', kind: 'HUMAN' | 'BOT', judges: Judges, personaId?: string) {
    if (phase === 'void') {
      this.voids++;
      return;
    }
    this.rounds++;
    if (kind === 'BOT') this.botRounds++;
    else this.humanRounds++;
    const persona = personaId
      ? (this.personas[personaId] ??= { rounds: 0, judged: 0, fooled: 0 })
      : null;
    if (persona) persona.rounds++;
    for (const judge of judges) {
      if (judge.correct === null) {
        this.calls.noCall++;
        continue;
      }
      const key =
        `${kind === 'BOT' ? 'bot' : 'human'}${judge.correct ? 'Correct' : 'Wrong'}` as const;
      this.calls[key]++;
      if (persona) {
        persona.judged++;
        if (!judge.correct) persona.fooled++;
      }
    }
  }

  toJSON() {
    const botJudged = this.calls.botCorrect + this.calls.botWrong;
    const humanJudged = this.calls.humanCorrect + this.calls.humanWrong;
    return {
      rounds: this.rounds,
      humanRounds: this.humanRounds,
      botRounds: this.botRounds,
      fallbacks: this.fallbacks,
      voids: this.voids,
      calls: this.calls,
      /** Share of calls on bot rounds where the judge said NOT (fooled). */
      botFoolRate: botJudged ? this.calls.botWrong / botJudged : null,
      /** Share of calls on human rounds where the judge said BOT (fooled by a human). */
      humanFoolRate: humanJudged ? this.calls.humanWrong / humanJudged : null,
      personas: Object.fromEntries(
        Object.entries(this.personas).map(([id, s]) => {
          const p = PERSONAS.find((x) => x.id === id);
          return [id, { ...s, name: p?.name ?? id, trickster: p?.mode === 'trickster' }];
        }),
      ),
    };
  }
}
