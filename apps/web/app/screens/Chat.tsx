'use client';

import { useEffect, useRef, useState } from 'react';
import { MAX_MESSAGE_CHARS, TURN_MS } from '@botornot/shared';
import { TYPING_VISIBLE_MS, type GameState } from '@/lib/game';
import { clock, secondsLeft, useNow } from '@/lib/useNow';

export function Chat({
  state,
  onSay,
  onTyping,
}: {
  state: GameState;
  onSay: (text: string) => void;
  onTyping: () => void;
}) {
  const now = useNow();
  const [draft, setDraft] = useState('');
  const listRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const yours = state.turn?.yours ?? false;
  const turnLeftMs = Math.max(0, (state.turn?.endsAt ?? now) - now);
  const partnerTyping =
    !yours &&
    state.partnerTypingAt !== undefined &&
    now - state.partnerTypingAt < TYPING_VISIBLE_MS;

  useEffect(() => {
    listRef.current?.scrollTo({ top: listRef.current.scrollHeight, behavior: 'smooth' });
  }, [state.lines.length, partnerTyping]);

  useEffect(() => {
    if (yours) inputRef.current?.focus();
  }, [yours]);

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    const text = draft.trim();
    if (!yours || !text) return;
    onSay(text);
    setDraft('');
  };

  return (
    <section className="flex h-[calc(100dvh-7rem)] min-h-[420px] flex-col overflow-hidden rounded-2xl border border-[var(--border)] bg-[var(--card)]">
      <div className="flex items-center justify-between border-b border-[var(--border)] px-4 py-3 text-sm">
        <span className="font-semibold">Stranger</span>
        <span className="font-mono tabular-nums text-[var(--muted)]">
          {clock(secondsLeft(state.chatEndsAt, now))} left
        </span>
      </div>

      <div ref={listRef} className="flex min-h-0 flex-1 flex-col gap-2 overflow-y-auto p-4">
        {state.lines.length === 0 && (
          <p className="m-auto text-center text-sm text-[var(--muted)]">
            {yours ? 'You go first. Say hi.' : 'They go first…'}
          </p>
        )}
        {state.lines.map((line, i) => (
          <p
            key={i}
            className={`max-w-[80%] rounded-2xl px-4 py-2 break-words ${
              line.from === 'you'
                ? 'self-end rounded-br-md bg-[var(--bubble-you)] text-[var(--bubble-you-fg)]'
                : 'self-start rounded-bl-md bg-[var(--bubble-them)]'
            }`}
          >
            {line.text}
          </p>
        ))}
        {partnerTyping && (
          <p
            className="flex gap-1 self-start rounded-2xl rounded-bl-md bg-[var(--bubble-them)] px-4 py-3"
            aria-label="typing"
          >
            {[0, 1, 2].map((i) => (
              <span
                key={i}
                className="typing-dot h-2 w-2 rounded-full bg-[var(--muted)]"
                style={{ animationDelay: `${i * 0.2}s` }}
              />
            ))}
          </p>
        )}
      </div>

      <div className="h-1 bg-[var(--bubble-them)]">
        <div
          className="h-full bg-[var(--accent)] transition-[width] duration-200 ease-linear"
          style={{ width: yours ? `${(turnLeftMs / TURN_MS) * 100}%` : '0%' }}
        />
      </div>

      <form onSubmit={submit} className="flex items-center gap-2 p-3">
        <div className="relative flex-1">
          <input
            ref={inputRef}
            value={draft}
            maxLength={MAX_MESSAGE_CHARS}
            disabled={!yours}
            onChange={(e) => {
              setDraft(e.target.value);
              onTyping();
            }}
            placeholder={yours ? `Your turn · ${Math.ceil(turnLeftMs / 1000)}s` : 'Their turn…'}
            className="w-full rounded-xl border border-[var(--border)] bg-[var(--bg)] px-4 py-3 pr-14 outline-none focus:border-[var(--accent)] disabled:opacity-60"
          />
          <span className="pointer-events-none absolute top-1/2 right-3 -translate-y-1/2 text-xs tabular-nums text-[var(--muted)]">
            {MAX_MESSAGE_CHARS - draft.length}
          </span>
        </div>
        <button
          type="submit"
          disabled={!yours || !draft.trim()}
          className="rounded-xl bg-[var(--accent)] px-4 py-3 font-semibold text-[var(--accent-fg)] disabled:opacity-40"
        >
          Send
        </button>
      </form>
    </section>
  );
}
