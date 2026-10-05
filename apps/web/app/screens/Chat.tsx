'use client';

import { useEffect, useRef, useState } from 'react';
import { MAX_MESSAGE_CHARS, TURN_MS } from '@botornot/shared';
import { TYPING_VISIBLE_MS, type GameState } from '@/lib/game';
import { clock, secondsLeft, useNow } from '@/lib/useNow';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';

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
    <section className="flex h-[calc(100dvh-8.5rem)] min-h-[420px] flex-col overflow-hidden rounded-md border border-border bg-card">
      <div className="flex items-center justify-between border-b border-border px-4 py-3">
        <span className="eyebrow">Stranger</span>
        <span className="font-mono text-xs text-muted-foreground tabular-nums">
          <span className="text-foreground">{clock(secondsLeft(state.chatEndsAt, now))}</span> left
        </span>
      </div>

      <div ref={listRef} className="flex min-h-0 flex-1 flex-col gap-2 overflow-y-auto p-4">
        {state.lines.length === 0 && (
          <p className="m-auto text-center text-sm text-muted-foreground">
            {yours ? 'You go first. Say hi.' : 'They go first…'}
          </p>
        )}
        {state.lines.map((line, i) => (
          <p
            key={i}
            className={cn(
              'max-w-[80%] rounded-md px-3.5 py-2 text-[15px] leading-snug break-words',
              line.from === 'you'
                ? 'self-end bg-primary text-primary-foreground'
                : 'self-start border border-border bg-surface-raised',
            )}
          >
            {line.text}
          </p>
        ))}
        {partnerTyping && (
          <p
            className="flex gap-1 self-start rounded-md border border-border bg-surface-raised px-3.5 py-3"
            aria-label="typing"
          >
            {[0, 1, 2].map((i) => (
              <span
                key={i}
                className="typing-dot size-1.5 bg-muted-foreground"
                style={{ animationDelay: `${i * 0.2}s` }}
              />
            ))}
          </p>
        )}
      </div>

      <div className="h-0.5 bg-border">
        <div
          className="h-full bg-brand transition-[width] duration-200 ease-linear"
          style={{ width: yours ? `${(turnLeftMs / TURN_MS) * 100}%` : '0%' }}
        />
      </div>

      <form onSubmit={submit} className="flex items-center gap-2 p-3">
        <div className="relative flex-1">
          <Input
            ref={inputRef}
            value={draft}
            maxLength={MAX_MESSAGE_CHARS}
            disabled={!yours}
            onChange={(e) => {
              setDraft(e.target.value);
              onTyping();
            }}
            placeholder={yours ? `Your turn · ${Math.ceil(turnLeftMs / 1000)}s` : 'Their turn…'}
            className="h-11 pr-12"
          />
          <span className="pointer-events-none absolute top-1/2 right-3 -translate-y-1/2 font-mono text-xs text-muted-foreground tabular-nums">
            {MAX_MESSAGE_CHARS - draft.length}
          </span>
        </div>
        <Button type="submit" disabled={!yours || !draft.trim()} className="h-11">
          Send
        </Button>
      </form>
    </section>
  );
}
