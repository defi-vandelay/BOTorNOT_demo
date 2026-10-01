'use client';

import { useGame } from '@/lib/useGame';
import { Lobby } from './screens/Lobby';
import { Waiting } from './screens/Waiting';
import { Chat } from './screens/Chat';
import { CallScreen } from './screens/CallScreen';
import { Result } from './screens/Result';
import { Void } from './screens/Void';

export function Game() {
  const { state, actions, address } = useGame();

  return (
    <main className="mx-auto flex min-h-screen max-w-xl flex-col px-4 py-6 sm:py-10">
      <header className="mb-6 flex items-center justify-between">
        <h1 className="text-xl font-black tracking-tight">
          BOT <span className="text-[var(--muted)]">or</span> NOT
        </h1>
        <span className="flex items-center gap-2 text-xs text-[var(--muted)]" aria-live="polite">
          <span
            className={`h-2 w-2 rounded-full ${state.welcome ? 'bg-green-500' : 'bg-red-500'}`}
          />
          {state.welcome ? 'Connected' : 'Connecting…'}
        </span>
      </header>

      {state.screen === 'lobby' && <Lobby ready={!!state.welcome} onFind={actions.findMatch} />}
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
