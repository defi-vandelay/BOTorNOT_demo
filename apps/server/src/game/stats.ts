import type { RoundOutcome } from './round';

export interface PersonaStats {
  rounds: number;
  judged: number;
  fooled: number;
}

/** In-memory round statistics for /stats. Persisted to a database from M2. */
export class Stats {
  rounds = 0;
  humanRounds = 0;
  botRounds = 0;
  /** Matches where the coin said human but nobody was free, so a bot filled in. */
  fallbacks = 0;
  voids = 0;
  calls = { botCorrect: 0, botWrong: 0, humanCorrect: 0, humanWrong: 0, noCall: 0 };
  personas: Record<string, PersonaStats> = {};

  record(outcome: RoundOutcome, personaId?: string): void {
    if (outcome.phase === 'void') {
      this.voids++;
      return;
    }
    this.rounds++;
    if (outcome.kind === 'BOT') this.botRounds++;
    else this.humanRounds++;
    const persona = personaId
      ? (this.personas[personaId] ??= { rounds: 0, judged: 0, fooled: 0 })
      : null;
    if (persona) persona.rounds++;
    for (const judge of outcome.judges) {
      if (judge.correct === null) {
        this.calls.noCall++;
        continue;
      }
      const key =
        `${outcome.kind === 'BOT' ? 'bot' : 'human'}${judge.correct ? 'Correct' : 'Wrong'}` as const;
      this.calls[key]++;
      if (persona) {
        persona.judged++;
        if (!judge.correct) persona.fooled++;
      }
    }
  }

  toJSON() {
    const botJudged = this.calls.botCorrect + this.calls.botWrong;
    return {
      rounds: this.rounds,
      humanRounds: this.humanRounds,
      botRounds: this.botRounds,
      fallbacks: this.fallbacks,
      voids: this.voids,
      calls: this.calls,
      /** Share of calls on bot rounds where the judge said NOT (fooled). */
      botFoolRate: botJudged ? this.calls.botWrong / botJudged : null,
      personas: this.personas,
    };
  }
}
