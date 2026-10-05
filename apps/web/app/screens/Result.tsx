'use client';

import { useEffect, useState } from 'react';
import type { Address } from 'viem';
import type { GameState } from '@/lib/game';
import { verifyRound, type Verification } from '@/lib/verify';
import { clock, secondsLeft, useNow } from '@/lib/useNow';
import { STAKE_POINTS } from '@botornot/shared';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Panel, panelClass } from '@/components/Panel';

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
  const verdictColor =
    result.correct === null
      ? 'text-muted-foreground'
      : result.correct
        ? 'text-brand'
        : 'text-destructive';

  return (
    <section className="flex flex-1 flex-col gap-6">
      <Panel crosshairs className="px-6 py-8 text-center">
        <p className="eyebrow">It was</p>
        <p className="mt-3 font-pixel text-5xl sm:text-6xl">{wasBot ? 'A BOT' : 'A HUMAN'}</p>
        <p className="mt-5 text-lg">
          <span className={verdictColor}>{verdict}</span>
          {result.yourCall && (
            <span className="text-muted-foreground"> You said {result.yourCall}.</span>
          )}
        </p>
        {stakeNote && <p className="mt-2 text-sm text-muted-foreground">{stakeNote}</p>}
        {mode === 'tokens' && result.yourCall && (
          <p className="mt-2 font-mono text-xs text-muted-foreground">
            {state.settleTx && explorer ? (
              <a
                href={`${explorer}/tx/${state.settleTx}`}
                target="_blank"
                rel="noreferrer"
                className="underline underline-offset-4 hover:text-foreground"
              >
                Settled on-chain ↗
              </a>
            ) : (
              'Settling on-chain…'
            )}
          </p>
        )}
        {result.persona && (
          <p className="mt-6 rounded-md border border-border bg-surface-raised px-4 py-3 text-sm">
            You were talking to <strong className="font-medium">{result.persona.name}</strong>:{' '}
            <span className="text-muted-foreground">{result.persona.blurb}</span>
          </p>
        )}
      </Panel>

      <details className={cn(panelClass, 'p-5 text-sm')} open>
        <summary className="eyebrow cursor-pointer transition-colors hover:text-foreground">
          Fairness check
        </summary>
        <ul className="mt-4 space-y-2">
          <CheckRow
            ok={check?.commitMatches}
            label="The answer matches the sealed commitment you got before the chat"
          />
          <CheckRow
            ok={check?.signedByOperator}
            label="The commitment was signed by the game operator"
          />
        </ul>
        <dl className="mt-4 space-y-1 border-t border-border pt-4 font-mono text-[11px] break-all text-muted-foreground">
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

      <Button variant="brand" size="lg" onClick={onAgain}>
        Play again
      </Button>
    </section>
  );
}

function CheckRow({ ok, label }: { ok: boolean | undefined; label: string }) {
  const icon = ok === undefined ? '…' : ok ? '✓' : '✗';
  const color = ok === undefined ? 'text-muted-foreground' : ok ? 'text-brand' : 'text-destructive';
  return (
    <li className="flex gap-3">
      <span className={cn('w-4 shrink-0 font-mono font-bold', color)}>{icon}</span>
      <span>{label}</span>
    </li>
  );
}
