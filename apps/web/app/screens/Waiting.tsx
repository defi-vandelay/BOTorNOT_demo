import { Button } from '@/components/ui/button';

export function Waiting({ onCancel }: { onCancel: () => void }) {
  return (
    <section className="flex flex-1 flex-col items-center justify-center gap-6 text-center">
      <div className="flex gap-1.5" aria-hidden>
        {[0, 1, 2].map((i) => (
          <span
            key={i}
            className="typing-dot size-2 bg-brand"
            style={{ animationDelay: `${i * 0.2}s` }}
          />
        ))}
      </div>
      <div>
        <p className="text-lg font-medium tracking-tight">Finding someone to chat with…</p>
        <p className="mt-1 text-sm text-muted-foreground">Could be a person. Could be a bot.</p>
      </div>
      <Button variant="link" onClick={onCancel}>
        Cancel
      </Button>
    </section>
  );
}
