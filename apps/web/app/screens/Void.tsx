export function Void({ reason, onBack }: { reason?: string; onBack: () => void }) {
  return (
    <section className="flex flex-1 flex-col items-center justify-center gap-6 text-center">
      <h2 className="text-2xl font-bold">Round ended early</h2>
      <p className="text-[var(--muted)]">{reason ?? 'This round was cancelled.'}</p>
      <button
        onClick={onBack}
        className="rounded-2xl bg-[var(--accent)] px-6 py-3 font-bold text-[var(--accent-fg)]"
      >
        Back to the lobby
      </button>
    </section>
  );
}
