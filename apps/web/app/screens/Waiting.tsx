export function Waiting({ onCancel }: { onCancel: () => void }) {
  return (
    <section className="flex flex-1 flex-col items-center justify-center gap-6 text-center">
      <div className="flex gap-2" aria-hidden>
        {[0, 1, 2].map((i) => (
          <span
            key={i}
            className="typing-dot h-3 w-3 rounded-full bg-[var(--accent)]"
            style={{ animationDelay: `${i * 0.2}s` }}
          />
        ))}
      </div>
      <div>
        <p className="text-lg font-semibold">Finding someone to chat with…</p>
        <p className="mt-1 text-sm text-[var(--muted)]">Could be a person. Could be a bot.</p>
      </div>
      <button onClick={onCancel} className="text-sm text-[var(--muted)] underline">
        Cancel
      </button>
    </section>
  );
}
