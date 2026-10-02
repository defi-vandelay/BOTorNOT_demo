'use client';

import { useEffect, useState } from 'react';
import type { Address } from 'viem';
import type { GameState } from '@/lib/game';
import { verifyRound, type Verification } from '@/lib/verify';
import { clock, secondsLeft, useNow } from '@/lib/useNow';
import { STAKE_POINTS } from '@botornot/shared';

export function Result({
  state,
  address,
  onAgain,
}: {
  state: GameState;
  address: Address | null;
  onAgain: () => void;
}) {
  const result = state.result!;
  const [check, setCheck] = useState<Verification | null>(null);
  const wasBot = result.answer === 'BOT';
  const now = useNow(1_000);
  const settleIn = secondsLeft(result.settlesAt, now);
  // A server without payout pools sends no settlesAt; then there is nothing to say about stakes.
  const mode = state.welcome?.mode;
  const stake = mode === 'tokens' ? `${STAKE_POINTS} tBON stake` : `${STAKE_POINTS}-point stake`;
  const explorer = state.welcome?.onchain?.explorer;
  const stakeNote =
    mode === 'free'
      ? null
      : result.yourCall === null
        ? mode === 'tokens'
          ? 'No call, so nothing was staked.'
          : 'No call, so your stake was refunded.'
        : result.settlesAt === undefined
          ? null
          : settleIn > 0
            ? `Your ${stake} is in the pool, which settles in ${clock(settleIn)}.`
            : 'The pool has closed.';

  useEffect(() => {
    if (!state.welcome || !state.receipt || !state.roundId || !address) return;
    void verifyRound({
      welcome: state.welcome,
      judge: address,
      roundId: state.roundId,
      receipt: state.receipt,
      result,
    }).then(setCheck);
  }, [state.welcome, state.receipt, state.roundId, address, result]);

  const verdict =
    result.correct === null
      ? 'No call made.'
      : result.correct
        ? 'You got it right.'
        : 'You got fooled.';

  return (
    <section className="flex flex-1 flex-col gap-6">
      <div className="rounded-2xl border border-[var(--border)] bg-[var(--card)] p-6 text-center">
        <p className="text-sm uppercase tracking-widest text-[var(--muted)]">It was</p>
        <p
          className="mt-1 text-5xl font-black"
          style={{ color: wasBot ? 'var(--bot)' : 'var(--human)' }}
        >
          {wasBot ? 'A BOT' : 'A HUMAN'}
        </p>
        <p className="mt-3 text-lg">
          {verdict}
          {result.yourCall && (
            <span className="text-[var(--muted)]"> You said {result.yourCall}.</span>
          )}
        </p>
        {stakeNote && <p className="mt-2 text-sm text-[var(--muted)]">{stakeNote}</p>}
        {mode === 'tokens' && result.yourCall && (
          <p className="mt-1 text-xs text-[var(--muted)]">
            {state.settleTx && explorer ? (
              <a
                href={`${explorer}/tx/${state.settleTx}`}
                target="_blank"
                rel="noreferrer"
                className="underline"
              >
                Settled on-chain ↗
              </a>
            ) : (
              'Settling on-chain…'
            )}
          </p>
        )}
        {result.persona && (
          <p className="mt-4 rounded-xl bg-[var(--bubble-them)] px-4 py-3 text-sm">
            You were talking to <strong>{result.persona.name}</strong>: {result.persona.blurb}
          </p>
        )}
      </div>

      <details
        className="rounded-2xl border border-[var(--border)] bg-[var(--card)] p-5 text-sm"
        open
      >
        <summary className="cursor-pointer font-semibold">Fairness check</summary>
        <ul className="mt-3 space-y-2">
          <CheckRow
            ok={check?.commitMatches}
            label="The answer matches the sealed commitment you got before the chat"
          />
          <CheckRow
            ok={check?.signedByOperator}
            label="The commitment was signed by the game operator"
          />
        </ul>
        <dl className="mt-4 space-y-1 font-mono text-xs break-all text-[var(--muted)]">
          <div>
            <dt className="inline">commitment: </dt>
            <dd className="inline">{state.receipt?.commit}</dd>
          </div>
          <div>
            <dt className="inline">salt: </dt>
            <dd className="inline">{result.salt}</dd>
          </div>
          <div>
            <dt className="inline">transcript: </dt>
            <dd className="inline">{result.transcriptHash}</dd>
          </div>
        </dl>
      </details>

      <button
        onClick={onAgain}
        className="rounded-2xl bg-[var(--accent)] px-6 py-4 text-lg font-bold text-[var(--accent-fg)] hover:opacity-90"
      >
        Play again
      </button>
    </section>
  );
}

function CheckRow({ ok, label }: { ok: boolean | undefined; label: string }) {
  const icon = ok === undefined ? '…' : ok ? '✓' : '✗';
  const color = ok === undefined ? 'var(--muted)' : ok ? 'var(--human)' : 'var(--bot)';
  return (
    <li className="flex gap-3">
      <span className="w-4 font-bold" style={{ color }}>
        {icon}
      </span>
      <span>{label}</span>
    </li>
  );
}
