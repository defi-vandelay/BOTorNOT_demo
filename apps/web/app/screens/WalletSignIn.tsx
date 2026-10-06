'use client';

import { useState } from 'react';
import {
  embeddedEnabled,
  finishEmail,
  startEmail,
  startSocial,
  type SocialProvider,
} from '@/lib/embedded';
import { signInWithBaseAccount, signInWithEmbedded, type WalletSignIn } from '@/lib/wallet';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';

const SOCIAL: { provider: SocialProvider; label: string }[] = [
  { provider: 'google', label: 'Google' },
  { provider: 'apple', label: 'Apple' },
  { provider: 'x', label: 'X' },
];

type Busy = 'email' | 'code' | SocialProvider | 'base';

/**
 * The guest's way in to playing for test tokens: an email code or Google, Apple or X (a wallet is
 * made for them), or a Base Account they already have.
 */
export function WalletSignInOptions({
  resuming,
  onSignIn,
}: {
  /** An email or social sign-in being picked up as the page loads, or why that failed. */
  resuming: 'working' | { error: string } | null;
  onSignIn: (how: () => Promise<WalletSignIn>) => Promise<void>;
}) {
  const [email, setEmail] = useState('');
  const [flow, setFlow] = useState<{ id: string; email: string } | null>(null);
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState<Busy | null>(null);
  const [error, setError] = useState<string | null>(null);

  const run = async (what: Busy, fn: () => Promise<void>) => {
    setBusy(what);
    setError(null);
    try {
      await fn();
    } catch (err) {
      setError(friendly(err));
    } finally {
      setBusy(null);
    }
  };

  const working = !!busy || resuming === 'working';
  const shownError = error ?? (resuming && resuming !== 'working' ? resuming.error : null);

  const baseAccount = (
    <Button
      variant={embeddedEnabled ? 'link' : 'outline'}
      onClick={() => void run('base', () => onSignIn(signInWithBaseAccount))}
      disabled={working}
      className={embeddedEnabled ? 'mt-4 min-h-0 px-0 py-0 text-xs' : 'mt-4 w-full'}
    >
      {busy === 'base'
        ? 'Waiting for your wallet…'
        : embeddedEnabled
          ? 'Have a Base Account? Use it instead'
          : 'Sign in with Base Account'}
    </Button>
  );

  if (!embeddedEnabled) {
    return (
      <>
        <p className="mt-1 leading-relaxed text-muted-foreground">
          Sign in with a Base Account to stake free test tokens (tBON) on your calls. It uses a
          passkey, so there's nothing to install, and the game pays your gas.
        </p>
        {baseAccount}
        {shownError && <p className="mt-2 text-destructive">{shownError}</p>}
      </>
    );
  }

  if (resuming === 'working') {
    return <p className="mt-3 font-mono text-xs text-muted-foreground">Signing you in…</p>;
  }

  return (
    <>
      <p className="mt-1 leading-relaxed text-muted-foreground">
        Sign in to stake free test tokens (tBON) on your calls. We set up a wallet for you, and the
        game pays your gas.
      </p>

      {flow ? (
        <form
          className="mt-4 flex flex-col gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            void run('code', () =>
              onSignIn(async () => signInWithEmbedded(await finishEmail(flow.id, code))),
            );
          }}
        >
          <label htmlFor="signin-code" className="text-muted-foreground">
            Enter the 6-digit code sent to <span className="text-foreground">{flow.email}</span>.
          </label>
          <Input
            id="signin-code"
            value={code}
            onChange={(e) => setCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
            inputMode="numeric"
            autoComplete="one-time-code"
            placeholder="123456"
            className="font-mono tracking-[0.3em]"
            autoFocus
            disabled={working}
          />
          <Button type="submit" variant="outline" disabled={working || code.length !== 6}>
            {busy === 'code' ? 'Signing you in…' : 'Sign in'}
          </Button>
          <Button
            type="button"
            variant="link"
            onClick={() => {
              setFlow(null);
              setCode('');
              setError(null);
            }}
            disabled={working}
            className="min-h-0 self-start px-0 py-0 text-xs"
          >
            Use a different email
          </Button>
        </form>
      ) : (
        <>
          <form
            className="mt-4 flex flex-col gap-2 sm:flex-row"
            onSubmit={(e) => {
              e.preventDefault();
              void run('email', async () => {
                const id = await startEmail(email);
                setFlow({ id, email: email.trim() });
              });
            }}
          >
            <label htmlFor="signin-email" className="sr-only">
              Email address
            </label>
            <Input
              id="signin-email"
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              autoComplete="email"
              placeholder="you@example.com"
              required
              disabled={working}
            />
            <Button
              type="submit"
              variant="outline"
              disabled={working || !email.includes('@')}
              className="min-h-10 shrink-0"
            >
              {busy === 'email' ? 'Sending code…' : 'Email me a code'}
            </Button>
          </form>
          <p className="eyebrow mt-4">Or continue with</p>
          <div className="mt-2 grid grid-cols-3 gap-2">
            {SOCIAL.map(({ provider, label }) => (
              <Button
                key={provider}
                variant="outline"
                onClick={() => void run(provider, () => startSocial(provider))}
                disabled={working}
                className="min-h-10"
              >
                {busy === provider ? '…' : label}
              </Button>
            ))}
          </div>
          <p className="mt-3 font-mono text-[11px] text-muted-foreground">
            Use the same way in each time to keep the same wallet.
          </p>
        </>
      )}

      {shownError && <p className="mt-2 text-destructive">{shownError}</p>}
      {!flow && baseAccount}
    </>
  );
}

function friendly(err: unknown): string {
  const message = err instanceof Error ? err.message : String(err);
  if (/rejected|denied|cancel/i.test(message)) return 'Sign-in was cancelled.';
  if (/otp|code/i.test(message) && /invalid|expired|incorrect/i.test(message)) {
    return "That code didn't work. Check it, or go back and send a new one.";
  }
  return `Couldn't sign in: ${message.split('\n')[0]!.slice(0, 160)}`;
}
