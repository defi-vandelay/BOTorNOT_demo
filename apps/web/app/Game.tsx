'use client';

import Link from 'next/link';
import { useGame } from '@/lib/useGame';
import { cn } from '@/lib/utils';
import { PageFrame, SiteHeader } from '@/components/Brand';
import { Lobby } from './screens/Lobby';
import { Waiting } from './screens/Waiting';
import { Chat } from './screens/Chat';
import { CallScreen } from './screens/CallScreen';
import { Result } from './screens/Result';
import { Void } from './screens/Void';
import { SettlementCard } from './screens/SettlementCard';
import { WalletPanel } from './screens/WalletPanel';
import { InviteOnly } from './screens/InviteOnly';

const chip =
  'rounded-sm border border-border px-2 py-1 font-mono text-[11px] whitespace-nowrap text-foreground';

export function Game() {
  const { state, actions, address, wallet, resuming } = useGame();
  const mode = state.welcome?.mode;

  return (
    <PageFrame>
      <SiteHeader>
        <Link href="/stats" className="eyebrow transition-colors hover:text-foreground">
          Stats
        </Link>
        {mode === 'free' ? (
          <span className={chip}>Free play</span>
        ) : (
          state.points !== undefined && (
            <span className={cn(chip, 'tabular-nums')}>
              {state.points.toLocaleString()} {mode === 'tokens' ? 'tBON' : 'pts'}
            </span>
          )
        )}
        <span className="eyebrow flex items-center gap-2" aria-live="polite">
          <span
            className={cn(
              'size-1.5',
              state.welcome
                ? 'bg-brand'
                : state.inviteRequired
                  ? 'bg-muted-foreground'
                  : 'bg-destructive',
            )}
          />
          {/* Just the square on small screens; screen readers still hear the status. */}
          <span className="sr-only sm:not-sr-only">
            {state.welcome ? 'Connected' : state.inviteRequired ? 'Private beta' : 'Connecting…'}
          </span>
        </span>
      </SiteHeader>

      {state.inviteRequired && (
        <InviteOnly loginOffered={state.loginOffered} login={state.login} onLogIn={actions.logIn} />
      )}

      {state.settlement && (state.screen === 'lobby' || state.screen === 'result') && (
        <SettlementCard
          settlement={state.settlement}
          unit={mode === 'tokens' ? 'tBON' : 'pts'}
          explorer={state.welcome?.onchain?.explorer}
          onDismiss={actions.dismissSettlement}
        />
      )}

      {state.screen === 'lobby' && !state.inviteRequired && (
        <Lobby ready={!!state.welcome} mode={mode} error={state.error} onFind={actions.findMatch}>
          <WalletPanel
            state={state}
            wallet={wallet}
            resuming={resuming}
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
    </PageFrame>
  );
}
