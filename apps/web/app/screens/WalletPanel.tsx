'use client';

import { useCallback, useEffect, useState } from 'react';
import type { Address } from 'viem';
import { STAKE_POINTS, type ClientMessage } from '@botornot/shared';
import type { GameState } from '@/lib/game';
import {
  SESSION_DAYS,
  readBalances,
  signSession,
  signWithdrawAll,
  wholeTokens,
  type WalletBalances,
} from '@/lib/wallet';
import { Button } from '@/components/ui/button';
import { Panel } from '@/components/Panel';

const short = (a: string) => `${a.slice(0, 6)}…${a.slice(-4)}`;

type WalletRequest = Extract<ClientMessage, { type: 'wallet.topUp' | 'wallet.withdraw' }>;
/** What's in progress, and whether it's waiting on the wallet or on the chain. */
type Busy = { action: 'signIn' | 'topUp' | 'withdraw'; step: 'wallet' | 'chain' };

/**
 * On-chain mode only. Guests can sign in with a Base Account to play for test tokens; signed-in
 * players see their balance and session and can top up or withdraw. The wallet only signs: the
 * game server sends the transactions and pays the gas.
 */
export function WalletPanel({
  state,
  address,
  onSignIn,
  onSignOut,
  onRequest,
}: {
  state: GameState;
  address: Address | null;
  onSignIn: () => Promise<void>;
  onSignOut: () => void;
  onRequest: (msg: WalletRequest) => Promise<void>;
}) {
  const welcome = state.welcome;
  const onchain = welcome?.onchain;
  const [busy, setBusy] = useState<Busy | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [balances, setBalances] = useState<WalletBalances | null>(null);

  const tokensMode = welcome?.mode === 'tokens';
  const reload = useCallback(() => {
    if (!onchain || !address || !tokensMode) return;
    readBalances(onchain, address).then(setBalances, () => setBalances(null));
  }, [onchain, address, tokensMode]);
  useEffect(reload, [reload]);

  if (!welcome || !onchain) return null;

  const run = async (fn: () => Promise<void>) => {
    setError(null);
    try {
      await fn();
      reload();
    } catch (err) {
      setError(friendly(err));
    } finally {
      setBusy(null);
    }
  };

  if (!tokensMode || !address) {
    return (
      <Panel className="p-5 text-sm">
        <p className="eyebrow">Wallet</p>
        <p className="mt-3 font-medium">You're playing free as a guest.</p>
        <p className="mt-1 leading-relaxed text-muted-foreground">
          Sign in with a Base Account to stake free test tokens (tBON) on your calls. It uses a
          passkey, so there's nothing to install, and the game pays your gas.
        </p>
        <Button
          variant="outline"
          onClick={() => {
            setBusy({ action: 'signIn', step: 'wallet' });
            void run(onSignIn);
          }}
          disabled={!!busy}
          className="mt-4 w-full"
        >
          {busy ? 'Waiting for your wallet…' : 'Sign in with Base Account'}
        </Button>
        {error && <p className="mt-2 text-destructive">{error}</p>}
      </Panel>
    );
  }

  const inGame = state.points ?? 0;
  const inWallet = balances ? wholeTokens(balances.wallet) : 0;
  const faucetReady = !!balances && balances.faucetReadyAt <= Date.now();
  const sessionEndsAt = state.sessionEndsAt ?? 0;
  // The server wants at least a few minutes left on a session before it stakes a new round.
  const sessionOk = sessionEndsAt > Date.now() + 10 * 60_000;
  const claimFaucet = faucetReady && inGame < STAKE_POINTS;
  const canTopUp = !!balances && (claimFaucet || !sessionOk);

  const topUp = () =>
    run(async () => {
      let session: { days: number; signature: `0x${string}` } | undefined;
      if (!sessionOk) {
        setBusy({ action: 'topUp', step: 'wallet' });
        session = {
          days: SESSION_DAYS,
          signature: await signSession(onchain, address, SESSION_DAYS, balances!.nonce),
        };
      }
      setBusy({ action: 'topUp', step: 'chain' });
      await onRequest({ type: 'wallet.topUp', faucet: claimFaucet, session });
    });
  const withdraw = () =>
    run(async () => {
      setBusy({ action: 'withdraw', step: 'wallet' });
      const signature = await signWithdrawAll(onchain, address, balances!.nonce);
      setBusy({ action: 'withdraw', step: 'chain' });
      await onRequest({ type: 'wallet.withdraw', signature });
    });
  const topUpLabel = claimFaucet
    ? sessionOk
      ? 'Get 1,000 free tBON'
      : 'Get 1,000 free tBON and start playing'
    : `Start a ${SESSION_DAYS}-day session`;
  const label = (action: Busy['action'], idle: string) =>
    busy?.action !== action
      ? idle
      : busy.step === 'wallet'
        ? 'Sign in your wallet…'
        : 'Sending to the chain…';

  return (
    <Panel className="text-sm">
      <div className="flex items-center justify-between border-b border-border px-5 py-3">
        <p className="flex items-center gap-3">
          <span className="eyebrow">Wallet</span>
          <a
            href={`${onchain.explorer}/address/${address}`}
            target="_blank"
            rel="noreferrer"
            className="font-mono text-xs underline underline-offset-4 hover:text-brand"
          >
            {short(address)}
          </a>
        </p>
        <Button variant="link" size="sm" onClick={onSignOut} className="min-h-0 py-0">
          Sign out
        </Button>
      </div>
      <div className="p-5">
        <dl className="grid grid-cols-2 gap-4">
          <div>
            <dt className="eyebrow">In the game</dt>
            <dd className="mt-1 font-mono text-base sm:text-lg tabular-nums">
              {inGame.toLocaleString()} tBON
            </dd>
          </div>
          <div>
            <dt className="eyebrow">Session</dt>
            <dd className="mt-1 font-mono text-base sm:text-lg">
              {sessionOk ? `until ${new Date(sessionEndsAt).toLocaleDateString()}` : 'not started'}
            </dd>
          </div>
        </dl>
        {inWallet > 0 && (
          <p className="mt-2 font-mono text-[11px] text-muted-foreground">
            {inWallet.toLocaleString()} tBON withdrawn to your wallet.
          </p>
        )}
        <div className="mt-4 flex flex-col gap-2 sm:flex-row">
          {canTopUp && (
            <Button onClick={() => void topUp()} disabled={!!busy} className="min-h-10 flex-1">
              {label('topUp', topUpLabel)}
            </Button>
          )}
          {inGame > 0 && balances && (
            <Button
              variant="outline"
              onClick={() => void withdraw()}
              disabled={!!busy}
              className="min-h-10"
            >
              {label('withdraw', 'Withdraw all')}
            </Button>
          )}
        </div>
        {inGame < STAKE_POINTS && !faucetReady && balances && (
          <p className="mt-2 font-mono text-[11px] text-muted-foreground">
            The free tBON faucet opens again{' '}
            {new Date(balances.faucetReadyAt).toLocaleString(undefined, {
              weekday: 'short',
              hour: 'numeric',
              minute: '2-digit',
            })}
            .
          </p>
        )}
        {error && <p className="mt-2 text-destructive">{error}</p>}
        <p className="mt-4 font-mono text-[11px] leading-relaxed text-muted-foreground">
          Base Sepolia testnet. tBON is a test token with no value. Your wallet only signs; the game
          pays the gas.
        </p>
      </div>
    </Panel>
  );
}

function friendly(err: unknown): string {
  const msg = err instanceof Error ? err.message : String(err);
  if (/reject|denied|cancel/i.test(msg)) return 'Cancelled in the wallet.';
  return msg.split('\n')[0]!.slice(0, 160);
}
