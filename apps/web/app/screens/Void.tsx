import { Button } from '@/components/ui/button';

export function Void({ reason, onBack }: { reason?: string; onBack: () => void }) {
  return (
    <section className="flex flex-1 flex-col items-center justify-center gap-6 text-center">
      <div>
        <p className="eyebrow">Round void</p>
        <h2 className="mt-3 text-2xl font-semibold tracking-tight">Round ended early</h2>
        <p className="mt-2 max-w-sm text-muted-foreground">
          {reason ?? 'This round was cancelled.'}
        </p>
      </div>
      <Button variant="brand" size="lg" onClick={onBack}>
        Back to the lobby
      </Button>
    </section>
  );
}
