export function InviteOnly() {
  return (
    <section className="flex flex-1 flex-col items-center justify-center gap-3 text-center">
      <p className="eyebrow">Private beta</p>
      <h2 className="text-2xl font-semibold tracking-tight">BOT or NOT is invite-only for now</h2>
      <p className="max-w-sm text-muted-foreground">
        Open the invite link you were sent. If you don&apos;t have one, ask whoever told you about
        the game.
      </p>
    </section>
  );
}
