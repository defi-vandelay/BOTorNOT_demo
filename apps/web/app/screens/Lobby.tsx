import { CHAT_DURATION_MS, MAX_MESSAGE_CHARS, TURN_MS } from '@botornot/shared';

export function Lobby({ ready, onFind }: { ready: boolean; onFind: () => void }) {
  return (
    <section className="flex flex-1 flex-col gap-8">
      <div>
        <h2 className="text-4xl font-black leading-tight tracking-tight sm:text-5xl">
          Human or AI?
          <br />
          <span className="text-[var(--accent)]">You decide.</span>
        </h2>
        <p className="mt-4 text-[var(--muted)]">
          Chat with a stranger for {CHAT_DURATION_MS / 60_000} minutes. Some are people. Some are
          bots doing their best to pass as people. Then make the call.
        </p>
      </div>

      <ol className="space-y-3 rounded-2xl border border-[var(--border)] bg-[var(--card)] p-5 text-sm">
        {[
          `Take turns: one message each, up to ${MAX_MESSAGE_CHARS} characters.`,
          `You get ${TURN_MS / 1000} seconds per message.`,
          'When the chat ends, call it: BOT or NOT.',
          'The answer was locked in before you said hello. Check it yourself at the end.',
        ].map((step, i) => (
          <li key={i} className="flex gap-3">
            <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-[var(--bubble-them)] text-xs font-bold">
              {i + 1}
            </span>
            <span className="pt-0.5">{step}</span>
          </li>
        ))}
      </ol>

      <button
        onClick={onFind}
        disabled={!ready}
        className="rounded-2xl bg-[var(--accent)] px-6 py-4 text-lg font-bold text-[var(--accent-fg)] transition hover:opacity-90 disabled:opacity-40"
      >
        Find a match
      </button>
      <p className="-mt-4 text-center text-xs text-[var(--muted)]">Testnet demo. No real money.</p>
    </section>
  );
}
