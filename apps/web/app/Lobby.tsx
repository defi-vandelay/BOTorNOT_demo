'use client';

import { CHAT_DURATION_MS, MAX_MESSAGE_CHARS, TURN_MS } from '@botornot/shared';
import { useGameSocket } from '@/lib/useGameSocket';

const STATUS_TEXT = {
  connecting: 'Connecting to the game server…',
  connected: 'Connected',
  offline: 'Game server offline. Start it with `pnpm dev`.',
} as const;

export function Lobby() {
  const { status, playerId } = useGameSocket();

  return (
    <main className="mx-auto flex max-w-xl flex-col gap-8 px-4 py-16">
      <header>
        <h1 className="text-4xl font-bold tracking-tight">BOT or NOT</h1>
        <p className="mt-2 text-[var(--muted)]">
          Chat with a stranger for {CHAT_DURATION_MS / 60_000} minutes, then call it. Were they a
          human, or an AI?
        </p>
      </header>

      <ol className="list-decimal space-y-1 pl-5 text-sm text-[var(--muted)]">
        <li>Take turns: one message each, up to {MAX_MESSAGE_CHARS} characters.</li>
        <li>You have {TURN_MS / 1000} seconds per message.</li>
        <li>When time is up, choose BOT or NOT.</li>
      </ol>

      <button
        disabled
        className="rounded-lg bg-[var(--accent)] px-6 py-3 font-semibold text-white opacity-50"
        title="Matchmaking arrives in the next milestone"
      >
        Find a match
      </button>

      <p className="text-sm" aria-live="polite">
        <span
          className={`mr-2 inline-block h-2 w-2 rounded-full ${
            status === 'connected'
              ? 'bg-green-500'
              : status === 'offline'
                ? 'bg-red-500'
                : 'bg-yellow-500'
          }`}
        />
        {STATUS_TEXT[status]}
        {playerId && <span className="text-[var(--muted)]"> as {playerId}</span>}
      </p>
    </main>
  );
}
