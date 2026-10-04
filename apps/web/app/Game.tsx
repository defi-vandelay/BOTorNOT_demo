'use client';

import Link from 'next/link';
import { useGame } from '@/lib/useGame';
import { Lobby } from './screens/Lobby';
import { Waiting } from './screens/Waiting';
import { Chat } from './screens/Chat';
import { CallScreen } from './screens/CallScreen';
import { Result } from './screens/Result';
import { Void } from './screens/Void';
import { SettlementCard } from './screens/SettlementCard';
import { WalletPanel } from './screens/WalletPanel';

export function Game() {
  const { state, actions, address } = useGame();
  const mode = state.welcome?.mode;

  return (
    <main className="mx-auto flex min-h-screen max-w-xl flex-col px-4 py-6 sm:py-10">
      <header className="mb-6 flex items-center justify-between">
        <h1 className="text-xl font-black tracking-tight">
          BOT <span className="text-[var(--muted)]">or</span> NOT
        </h1>
        <div className="flex items-center gap-4 text-xs text-[var(--muted)]">
          <Link href="/stats" className="underline">
            Stats
          </Link>
          {mode === 'free' ? (
            <span className="rounded-full border border-[var(--border)] px-3 py-1 font-semibold text-[var(--fg)]">
              Free play
            </span>
          ) : (
            state.points !== undefined && (
              <span className="rounded-full border border-[var(--border)] px-3 py-1 font-semibold text-[var(--fg)]">
                {state.points.toLocaleString()} {mode === 'tokens' ? 'tBON' : 'pts'}
              </span>
            )
          )}
          <span className="flex items-center gap-2" aria-live="polite">
            <span
              className={`h-2 w-2 rounded-full ${state.welcome ? 'bg-green-500' : 'bg-red-500'}`}
            />
            {state.welcome ? 'Connected' : 'Connecting…'}
          </span>
        </div>
      </header>

      {state.settlement && (state.screen === 'lobby' || state.screen === 'result') && (
        <SettlementCard
          settlement={state.settlement}
          unit={mode === 'tokens' ? 'tBON' : 'pts'}
          explorer={state.welcome?.onchain?.explorer}
          onDismiss={actions.dismissSettlement}
        />
      )}

      {state.screen === 'lobby' && (
        <Lobby ready={!!state.welcome} mode={mode} error={state.error} onFind={actions.findMatch}>
          <WalletPanel
            state={state}
            address={address}
            onSignIn={actions.signIn}
            onSignOut={actions.signOut}
            onRequest={actions.wallet}
          />
        </Lobby>
      )}
      {state.screen === 'waiting' && <Waiting onCancel={actions.cancel} />}
      {state.screen === 'chat' && (
        <Chat state={state} onSay={actions.say} onTyping={actions.typing} />
      )}
      {state.screen === 'call' && <CallScreen state={state} onCall={actions.call} />}
      {state.screen === 'result' && (
        <Result state={state} address={address} onAgain={actions.backToLobby} />
      )}
      {state.screen === 'void' && <Void reason={state.voidReason} onBack={actions.backToLobby} />}
    </main>
  );
}
