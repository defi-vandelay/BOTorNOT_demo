import type { Settlement } from '@/lib/game';

/** What the last payout pool paid this player, until they dismiss it. */
export function SettlementCard({
  settlement,
  onDismiss,
}: {
  settlement: Settlement;
  onDismiss: () => void;
}) {
  const { you } = settlement;
  const sign = you.net > 0 ? '+' : '';
  return (
    <div
      className="mb-6 rounded-2xl border border-[var(--border)] bg-[var(--card)] p-4 text-sm"
      role="status"
    >
      <div className="flex items-start justify-between gap-4">
        <div>
          <p className="font-semibold">
            Pool #{settlement.epoch} settled:{' '}
            <span style={{ color: you.net >= 0 ? 'var(--human)' : 'var(--bot)' }}>
              {sign}
              {you.net} pts
            </span>
          </p>
          <p className="mt-1 text-[var(--muted)]">
            You made {you.right} right and {you.wrong} wrong{' '}
            {you.right + you.wrong === 1 ? 'call' : 'calls'}. Each right call earned +
            {settlement.profitPerRight} ({settlement.rightCalls} right, {settlement.wrongCalls}{' '}
            wrong in the pool).
            {you.deception > 0 && ` Fooling your partner earned you +${you.deception}.`}
          </p>
          <p className="mt-1 text-xs text-[var(--muted)]">Daily pool: {settlement.dailyPool} pts</p>
        </div>
        <button
          onClick={onDismiss}
          className="text-[var(--muted)] hover:text-[var(--fg)]"
          aria-label="Dismiss"
        >
          ✕
        </button>
      </div>
    </div>
  );
}
