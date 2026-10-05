import type { ReactNode } from 'react';
import { CHAT_DURATION_MS, MAX_MESSAGE_CHARS, STAKE_POINTS, TURN_MS } from '@botornot/shared';
import type { Welcome } from '@/lib/game';
import { Button } from '@/components/ui/button';
import { Panel } from '@/components/Panel';

const STAKE_STEP = {
  points: `Each call stakes ${STAKE_POINTS} points. Right calls split the stakes of wrong ones, and fooling a human partner earns you a cut of theirs.`,
  tokens: `Each call stakes ${STAKE_POINTS} tBON. Right calls split the stakes of wrong ones, and fooling a human partner earns you a cut of theirs. Every round settles on-chain.`,
  free: 'As a guest nothing is staked. Sign in below to play for test tokens.',
};

export function Lobby({
  ready,
  mode,
  error,
  onFind,
  children,
}: {
  ready: boolean;
  mode?: Welcome['mode'];
  error?: string;
  onFind: () => void;
  children?: ReactNode;
}) {
  return (
    // Phones stack hero, steps, button, wallet. Desktops put the hero and button on the left and
    // the steps and wallet on the right; the wrappers are display: contents until then.
    <section className="flex flex-1 flex-col gap-10 lg:grid lg:grid-cols-2 lg:content-center lg:items-start lg:gap-x-16 lg:pb-8">
      <div className="contents lg:flex lg:flex-col lg:gap-10">
        <div className="order-1">
          <h2 className="text-4xl leading-[1.05] font-semibold tracking-tighter sm:text-5xl lg:text-7xl">
            Human or AI?
            <br />
            <span className="text-muted-foreground">You decide.</span>
          </h2>
          <p className="mt-5 max-w-md text-[15px] leading-relaxed text-muted-foreground lg:mt-6 lg:text-lg">
            Chat with a stranger for {CHAT_DURATION_MS / 60_000} minutes. Some are people. Some are
            bots doing their best to pass as people. Then make the call.
          </p>
        </div>

        <div className="order-3 flex flex-col gap-3 lg:items-start">
          <Button variant="brand" size="lg" onClick={onFind} disabled={!ready} className="lg:w-64">
            Find a match
          </Button>
          {error && (
            <p className="text-center text-sm text-destructive lg:text-left" role="alert">
              {error === 'not enough points' ? 'Not enough points for another round.' : error}
            </p>
          )}
          <p className="text-center font-mono text-[11px] text-muted-foreground lg:text-left">
            {mode === 'points' || !mode
              ? 'Testnet demo. Points only, no real money.'
              : 'Testnet demo on Base Sepolia. Test tokens only, no real money.'}
          </p>
        </div>
      </div>

      <div className="contents lg:flex lg:flex-col lg:gap-6">
        <Panel crosshairs className="order-2">
          <ol className="divide-y divide-border text-sm">
            {[
              `Take turns: one message each, up to ${MAX_MESSAGE_CHARS} characters.`,
              `You get ${TURN_MS / 1000} seconds per message.`,
              'When the chat ends, call it: BOT or NOT.',
              STAKE_STEP[mode ?? 'points'],
              'The answer was locked in before you said hello. Check it yourself at the end.',
            ].map((step, i) => (
              <li key={i} className="flex gap-4 px-5 py-3.5">
                <span className="pt-px font-mono text-xs text-muted-foreground tabular-nums">
                  {String(i + 1).padStart(2, '0')}
                </span>
                <span className="leading-relaxed">{step}</span>
              </li>
            ))}
          </ol>
        </Panel>
        <div className="order-4">{children}</div>
      </div>
    </section>
  );
}
