'use client';

import { useCallback, useEffect, useState } from 'react';
import type { Address } from 'viem';
import { STAKE_POINTS } from '@botornot/shared';
import type { GameState } from '@/lib/game';
import {
  SESSION_DAYS,
  readBalances,
  sendCalls,
  topUpCalls,
  wholeTokens,
  withdrawCalls,
  type WalletBalances,
} from '@/lib/wallet';

const short = (a: string) => `${a.slice(0, 6)}…${a.slice(-4)}`;

/**
 * On-chain mode only. Guests can sign in with a Base Account to play for test tokens; signed-in
 * players see their balance and session and can top up or withdraw (gas is sponsored).
 */
export function WalletPanel({
  state,
  address,
  onSignIn,
  onSignOut,
  onChanged,
}: {
  state: GameState;
  address: Address | null;
  onSignIn: () => Promise<void>;
  onSignOut: () => void;
  onChanged: () => void;
}) {
  const welcome = state.welcome;
  const onchain = welcome?.onchain;
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [balances, setBalances] = useState<WalletBalances | null>(null);

  const tokensMode = welcome?.mode === 'tokens';
  const reload = useCallback(() => {
    if (!onchain || !address || !tokensMode) return;
    readBalances(onchain.token, address).then(setBalances, () => setBalances(null));
  }, [onchain, address, tokensMode]);
  useEffect(reload, [reload]);

  if (!welcome || !onchain) return null;

  const run = async (label: string, fn: () => Promise<void>) => {
    setBusy(label);
    setError(null);
    try {
      await fn();
      onChanged();
      reload();
    } catch (err) {
      setError(friendly(err));
    } finally {
      setBusy(null);
    }
  };

  if (!tokensMode || !address) {
    return (
      <div className="rounded-2xl border border-[var(--border)] bg-[var(--card)] p-5 text-sm">
        <p className="font-semibold">You're playing free as a guest.</p>
        <p className="mt-1 text-[var(--muted)]">
          Sign in with a Base Account to stake free test tokens (tBON) on your calls. It uses a
          passkey, so there's nothing to install, and the game pays your gas.
        </p>
        <button
          onClick={() => void run('signing in', onSignIn)}
          disabled={!!busy}
          className="mt-4 w-full rounded-xl border border-[var(--border)] px-4 py-3 font-semibold hover:bg-[var(--bubble-them)] disabled:opacity-40"
        >
          {busy ? 'Waiting for your wallet…' : 'Sign in with Base Account'}
        </button>
        {error && <p className="mt-2 text-[var(--bot)]">{error}</p>}
      </div>
    );
  }

  const inGame = state.points ?? 0;
  const inWallet = balances ? wholeTokens(balances.wallet) : 0;
  const faucetReady = !!balances && balances.faucetReadyAt <= Date.now();
  const sessionEndsAt = state.sessionEndsAt ?? 0;
  // The server wants at least a few minutes left on a session before it stakes a new round.
  const sessionOk = sessionEndsAt > Date.now() + 10 * 60_000;
  const needsTokens = inGame < STAKE_POINTS;
  const canTopUp = (faucetReady && needsTokens) || inWallet > 0 || !sessionOk;
  const topUp = () =>
    run('topping up', () =>
      sendCalls(
        address,
        topUpCalls(onchain, {
          claimFaucet: faucetReady && needsTokens,
          walletTokens: balances?.wallet ?? 0n,
          startSession: !sessionOk,
        }),
        onchain.paymasterUrl,
      ),
    );
  const topUpLabel =
    faucetReady && needsTokens
      ? 'Get 1,000 free tBON and start playing'
      : inWallet > 0
        ? `Deposit ${inWallet.toLocaleString()} tBON${sessionOk ? '' : ' and start a session'}`
        : `Start a ${SESSION_DAYS}-day session`;

  return (
    <div className="rounded-2xl border border-[var(--border)] bg-[var(--card)] p-5 text-sm">
      <div className="flex items-center justify-between">
        <p className="font-semibold">
          <a
            href={`${onchain.explorer}/address/${address}`}
            target="_blank"
            rel="noreferrer"
            className="underline"
          >
            {short(address)}
          </a>
        </p>
        <button onClick={onSignOut} className="text-xs text-[var(--muted)] underline">
          Sign out
        </button>
      </div>
      <dl className="mt-3 grid grid-cols-2 gap-2">
        <div>
          <dt className="text-xs text-[var(--muted)]">In the game</dt>
          <dd className="text-lg font-bold">{inGame.toLocaleString()} tBON</dd>
        </div>
        <div>
          <dt className="text-xs text-[var(--muted)]">Session</dt>
          <dd className="text-lg font-bold">
            {sessionOk ? `until ${new Date(sessionEndsAt).toLocaleDateString()}` : 'not started'}
          </dd>
        </div>
      </dl>
      {inWallet > 0 && (
        <p className="mt-1 text-xs text-[var(--muted)]">
          {inWallet.toLocaleString()} tBON in your wallet, not deposited yet.
        </p>
      )}
      <div className="mt-4 flex flex-col gap-2 sm:flex-row">
        {canTopUp && (
          <button
            onClick={() => void topUp()}
            disabled={!!busy}
            className="flex-1 rounded-xl bg-[var(--fg)] px-4 py-3 font-semibold text-[var(--bg)] hover:opacity-90 disabled:opacity-40"
          >
            {busy === 'topping up' ? 'Confirm in your wallet…' : topUpLabel}
          </button>
        )}
        {inGame > 0 && (
          <button
            onClick={() =>
              void run('withdrawing', () =>
                sendCalls(address, withdrawCalls(onchain, inGame), onchain.paymasterUrl),
              )
            }
            disabled={!!busy}
            className="rounded-xl border border-[var(--border)] px-4 py-3 font-semibold hover:bg-[var(--bubble-them)] disabled:opacity-40"
          >
            {busy === 'withdrawing' ? 'Confirm in your wallet…' : 'Withdraw all'}
          </button>
        )}
      </div>
      {needsTokens && !faucetReady && inWallet === 0 && balances && (
        <p className="mt-2 text-xs text-[var(--muted)]">
          The free tBON faucet opens again{' '}
          {new Date(balances.faucetReadyAt).toLocaleString(undefined, {
            weekday: 'short',
            hour: 'numeric',
            minute: '2-digit',
          })}
          .
        </p>
      )}
      {error && <p className="mt-2 text-[var(--bot)]">{error}</p>}
      <p className="mt-3 text-xs text-[var(--muted)]">
        Base Sepolia testnet. tBON is a test token with no value.
      </p>
    </div>
  );
}

function friendly(err: unknown): string {
  const msg = err instanceof Error ? err.message : String(err);
  if (/reject|denied|cancel/i.test(msg)) return 'Cancelled in the wallet.';
  return msg.split('\n')[0]!.slice(0, 160);
}
