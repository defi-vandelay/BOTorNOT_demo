'use client';

import { useState, type FormEvent } from 'react';
import type { GameState } from '@/lib/game';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Panel } from '@/components/Panel';

/** A private server: the beta sign-in form when it takes one, else a pointer to the invite link. */
export function InviteOnly({
  loginOffered,
  login,
  onLogIn,
}: {
  loginOffered?: boolean;
  login?: GameState['login'];
  onLogIn: (username: string, password: string) => Promise<void>;
}) {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);

  if (!loginOffered) {
    return (
      <section className="flex flex-1 flex-col items-center justify-center gap-3 text-center">
        <p className="eyebrow">Private beta</p>
        <h2 className="text-2xl font-semibold tracking-tight">BOT or NOT is invite-only for now</h2>
        <p className="max-w-sm text-muted-foreground">
          Open the invite link you were sent. If you don&apos;t have one, ask whoever told you about
          the game.
        </p>
      </section>
    );
  }

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    try {
      await onLogIn(username, password);
    } catch {
      // Hashing the login needs a secure page (https or localhost).
      setError('Signing in doesn’t work on this page. Open the game’s https address.');
    }
  };
  const message = error ?? (login === 'failed' ? 'That username or password isn’t right.' : null);

  return (
    <section className="flex flex-1 flex-col items-center justify-center gap-8">
      <div className="flex flex-col items-center gap-3 text-center">
        <p className="eyebrow">Private beta</p>
        <h2 className="text-2xl font-semibold tracking-tight">Sign in to play</h2>
        <p className="max-w-sm text-muted-foreground">
          Use the username and password you were given, or open your invite link.
        </p>
      </div>
      <Panel crosshairs className="w-full max-w-sm p-5">
        <form onSubmit={submit} className="flex flex-col gap-4">
          <label className="flex flex-col gap-2">
            <span className="eyebrow">Username</span>
            <Input
              name="username"
              autoComplete="username"
              autoCapitalize="none"
              autoCorrect="off"
              spellCheck={false}
              required
              value={username}
              onChange={(e) => setUsername(e.target.value)}
            />
          </label>
          <label className="flex flex-col gap-2">
            <span className="eyebrow">Password</span>
            <Input
              name="password"
              type="password"
              autoComplete="current-password"
              required
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
          </label>
          {message && (
            <p className="text-sm text-destructive" role="alert">
              {message}
            </p>
          )}
          <Button type="submit" variant="brand" disabled={login === 'pending'}>
            {login === 'pending' ? 'Signing in…' : 'Sign in'}
          </Button>
        </form>
      </Panel>
    </section>
  );
}
