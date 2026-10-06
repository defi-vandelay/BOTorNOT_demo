'use client';

import { useCallback, useEffect, useState } from 'react';
import { STAKE_POINTS, type ClientMessage } from '@botornot/shared';
import type { GameState } from '@/lib/game';
import {
  SESSION_DAYS,
  readBalances,
  signSession,
  signWithdrawAll,
  wholeTokens,
  type WalletBalances,
  type WalletSignIn,
} from '@/lib/wallet';
import { Button } from '@/components/ui/button';
import { Panel } from '@/components/Panel';
import { WalletSignInOptions } from './WalletSignIn';

const short = (a: string) => `${a.slice(0, 6)}…${a.slice(-4)}`;

type WalletRequest = Extract<ClientMessage, { type: 'wallet.topUp' | 'wallet.withdraw' }>;
/** What's in progress, and whether it's waiting on the wallet or on the chain. */
type Busy = { action: 'topUp' | 'withdraw'; step: 'wallet' | 'chain' };

/**
 * On-chain mode only. Guests can sign in (WalletSignInOptions) to play for test tokens; signed-in
 * players see their balance and session and can top up or withdraw. The wallet only signs: the
 * game server sends the transactions and pays the gas.
 */
export function WalletPanel({
  state,
  wallet,
  resuming,
  onSignIn,
  onSignOut,
  onRequest,
}: {
  state: GameState;
  wallet: WalletSignIn | null;
  resuming: 'working' | { error: string } | null;
  onSignIn: (how: () => Promise<WalletSignIn>) => Promise<void>;
  onSignOut: () => void;
  onRequest: (msg: WalletRequest) => Promise<void>;
}) {
  const welcome = state.welcome;
  const onchain = welcome?.onchain;
  const address = wallet?.address;
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

  if (!tokensMode || !wallet || !address) {
    return (
      <Panel className="p-5 text-sm">
        <p className="eyebrow">Wallet</p>
        <p className="mt-3 font-medium">You're playing free as a guest.</p>
        <WalletSignInOptions resuming={resuming} onSignIn={onSignIn} />
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

  /**
   * Signs and sends; signs once more if the server rejects the signature. The public RPC can lag a
   * few seconds behind the chain, so straight after a top-up the nonce read here may be the one the
   * top-up just used.
   */
  const signAndSend = async (action: Busy['action'], send: () => Promise<void>) => {
    try {
      await send();
    } catch (err) {
      if (!/signature isn't valid/i.test(err instanceof Error ? err.message : '')) throw err;
      setBusy({ action, step: 'wallet' });
      await new Promise((r) => setTimeout(r, 3000));
      await send();
    }
  };
  const topUp = () =>
    run(() =>
      signAndSend('topUp', async () => {
        let session: { days: number; signature: `0x${string}` } | undefined;
        if (!sessionOk) {
          setBusy({ action: 'topUp', step: 'wallet' });
          session = {
            days: SESSION_DAYS,
            signature: await signSession(onchain, wallet, SESSION_DAYS),
          };
        }
        setBusy({ action: 'topUp', step: 'chain' });
        await onRequest({ type: 'wallet.topUp', faucet: claimFaucet, session });
      }),
    );
  const withdraw = () =>
    run(() =>
      signAndSend('withdraw', async () => {
        setBusy({ action: 'withdraw', step: 'wallet' });
        const signature = await signWithdrawAll(onchain, wallet);
        setBusy({ action: 'withdraw', step: 'chain' });
        await onRequest({ type: 'wallet.withdraw', signature });
      }),
    );
  const topUpLabel = claimFaucet
    ? sessionOk
      ? 'Get 1,000 free tBON'
      : 'Get 1,000 free tBON and start playing'
    : `Start a ${SESSION_DAYS}-day session`;
  const label = (action: Busy['action'], idle: string) =>
    busy?.action !== action
      ? idle
      : busy.step === 'wallet'
        ? wallet.kind === 'embedded'
          ? 'Signing…' // email and social wallets sign on this page, with no popup
          : 'Sign in your wallet…'
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
