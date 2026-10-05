'use client';

import type { Call } from '@botornot/shared';
import type { GameState } from '@/lib/game';
import { secondsLeft, useNow } from '@/lib/useNow';
import { panelClass } from '@/components/Panel';
import { cn } from '@/lib/utils';

export function CallScreen({ state, onCall }: { state: GameState; onCall: (call: Call) => void }) {
  const now = useNow();
  const left = secondsLeft(state.callEndsAt, now);

  return (
    <section className="flex flex-1 flex-col items-center justify-center gap-10 text-center">
      <div>
        <p className="eyebrow">Time&apos;s up</p>
        <h2 className="mt-3 text-3xl font-semibold tracking-tight sm:text-4xl">Was that a bot?</h2>
        <p className="mt-3 font-mono text-sm text-muted-foreground tabular-nums">
          <span className="text-foreground">{left}s</span> to decide
        </p>
      </div>

      {state.myCall ? (
        <p className="text-lg">
          You said <strong className="font-pixel">{state.myCall}</strong>. Revealing…
        </p>
      ) : (
        <div className="grid w-full grid-cols-2 gap-3">
          {(['BOT', 'NOT'] as const).map((call) => (
            <button
              key={call}
              onClick={() => onCall(call)}
              className="cursor-pointer rounded-md border border-border-strong bg-card py-12 font-pixel text-5xl transition-colors outline-none hover:border-foreground hover:bg-foreground hover:text-background focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
            >
              {call}
            </button>
          ))}
        </div>
      )}

      {state.lines.length > 0 && (
        <details className={cn(panelClass, 'w-full px-4 py-3 text-left text-sm')}>
          <summary className="eyebrow cursor-pointer transition-colors hover:text-foreground">
            Look back at the chat
          </summary>
          <ul className="mt-3 space-y-1.5">
            {state.lines.map((l, i) => (
              <li key={i} className="flex gap-3">
                <span className="w-10 shrink-0 pt-0.5 font-mono text-[11px] text-muted-foreground uppercase">
                  {l.from === 'you' ? 'You' : 'Them'}
                </span>
                <span>{l.text}</span>
              </li>
            ))}
          </ul>
        </details>
      )}
    </section>
  );
}
