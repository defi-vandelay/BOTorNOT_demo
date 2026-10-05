import type { Settlement } from '@/lib/game';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Panel } from '@/components/Panel';

/** What the last payout pool paid this player, until they dismiss it. */
export function SettlementCard({
  settlement,
  unit,
  explorer,
  onDismiss,
}: {
  settlement: Settlement;
  unit: 'pts' | 'tBON';
  explorer?: string;
  onDismiss: () => void;
}) {
  const { you } = settlement;
  const sign = you.net > 0 ? '+' : '';
  return (
    <Panel className="mb-6 p-4 text-sm" role="status">
      <div className="flex items-start justify-between gap-4">
        <div>
          <p className="flex flex-wrap items-baseline gap-x-2">
            <span className="eyebrow">Pool #{settlement.epoch} settled</span>
            <span
              className={cn(
                'font-mono font-medium tabular-nums',
                you.net > 0 ? 'text-brand' : you.net < 0 ? 'text-destructive' : 'text-foreground',
              )}
            >
              {sign}
              {you.net} {unit}
            </span>
          </p>
          <p className="mt-2 leading-relaxed text-muted-foreground">
            You made {you.right} right and {you.wrong} wrong{' '}
            {you.right + you.wrong === 1 ? 'call' : 'calls'}. Each right call earned +
            {settlement.profitPerRight} ({settlement.rightCalls} right, {settlement.wrongCalls}{' '}
            wrong in the pool).
            {you.deception > 0 && ` Fooling your partner earned you +${you.deception}.`}
          </p>
          <p className="mt-2 font-mono text-[11px] text-muted-foreground">
            Daily pool: {settlement.dailyPool} {unit}
            {settlement.txHash && explorer && (
              <>
                {' · '}
                <a
                  href={`${explorer}/tx/${settlement.txHash}`}
                  target="_blank"
                  rel="noreferrer"
                  className="underline underline-offset-4 hover:text-foreground"
                >
                  payout transaction
                </a>
              </>
            )}
          </p>
        </div>
        <Button variant="ghost" size="icon" onClick={onDismiss} aria-label="Dismiss">
          ✕
        </Button>
      </div>
    </Panel>
  );
}
