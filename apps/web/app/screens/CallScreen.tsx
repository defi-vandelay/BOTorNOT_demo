'use client';

import type { Call } from '@botornot/shared';
import type { GameState } from '@/lib/game';
import { secondsLeft, useNow } from '@/lib/useNow';

export function CallScreen({ state, onCall }: { state: GameState; onCall: (call: Call) => void }) {
  const now = useNow();
  const left = secondsLeft(state.callEndsAt, now);

  return (
    <section className="flex flex-1 flex-col items-center justify-center gap-8 text-center">
      <div>
        <p className="text-sm uppercase tracking-widest text-[var(--muted)]">Time&apos;s up</p>
        <h2 className="mt-2 text-3xl font-black">Was that a bot?</h2>
        <p className="mt-2 font-mono text-[var(--muted)] tabular-nums">{left}s to decide</p>
      </div>

      {state.myCall ? (
        <p className="text-lg">
          You said <strong>{state.myCall}</strong>. Revealing…
        </p>
      ) : (
        <div className="grid w-full grid-cols-2 gap-4">
          <button
            onClick={() => onCall('BOT')}
            className="rounded-2xl border-2 border-[var(--bot)] py-10 text-3xl font-black text-[var(--bot)] transition hover:bg-[var(--bot)] hover:text-white"
          >
            BOT
          </button>
          <button
            onClick={() => onCall('NOT')}
            className="rounded-2xl border-2 border-[var(--human)] py-10 text-3xl font-black text-[var(--human)] transition hover:bg-[var(--human)] hover:text-white"
          >
            NOT
          </button>
        </div>
      )}

      {state.lines.length > 0 && (
        <details className="w-full text-left text-sm">
          <summary className="cursor-pointer text-[var(--muted)]">Look back at the chat</summary>
          <ul className="mt-2 space-y-1">
            {state.lines.map((l, i) => (
              <li key={i}>
                <span className="text-[var(--muted)]">{l.from === 'you' ? 'You' : 'Them'}:</span>{' '}
                {l.text}
              </li>
            ))}
          </ul>
        </details>
      )}
    </section>
  );
}
