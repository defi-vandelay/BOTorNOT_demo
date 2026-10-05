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
    <section className="flex flex-1 flex-col gap-10">
      <div>
        <h2 className="text-4xl leading-[1.05] font-semibold tracking-tighter sm:text-5xl">
          Human or AI?
          <br />
          <span className="text-muted-foreground">You decide.</span>
        </h2>
        <p className="mt-5 max-w-md text-[15px] leading-relaxed text-muted-foreground">
          Chat with a stranger for {CHAT_DURATION_MS / 60_000} minutes. Some are people. Some are
          bots doing their best to pass as people. Then make the call.
        </p>
      </div>

      <Panel crosshairs>
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

      <div className="flex flex-col gap-3">
        <Button variant="brand" size="lg" onClick={onFind} disabled={!ready}>
          Find a match
        </Button>
        {error && (
          <p className="text-center text-sm text-destructive" role="alert">
            {error === 'not enough points' ? 'Not enough points for another round.' : error}
          </p>
        )}
        <p className="text-center font-mono text-[11px] text-muted-foreground">
          {mode === 'points' || !mode
            ? 'Testnet demo. Points only, no real money.'
            : 'Testnet demo on Base Sepolia. Test tokens only, no real money.'}
        </p>
      </div>
      {children}
    </section>
  );
}
