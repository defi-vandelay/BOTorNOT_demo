import { cn } from '@/lib/utils';

/** The bordered surface everything sits on. Crosshairs mark its corners, Vercel-style. */
export function Panel({
  className,
  crosshairs = false,
  children,
  ...props
}: React.ComponentProps<'div'> & { crosshairs?: boolean }) {
  return (
    <div
      className={cn(
        'relative border border-border bg-card',
        crosshairs ? 'rounded-none' : 'rounded-md',
        className,
      )}
      {...props}
    >
      {crosshairs && <Crosshairs />}
      {children}
    </div>
  );
}

export const panelClass = 'rounded-md border border-border bg-card';

function Crosshairs() {
  return (
    <>
      <Plus className="-top-[6px] -left-[6px]" />
      <Plus className="-top-[6px] -right-[6px]" />
      <Plus className="-bottom-[6px] -left-[6px]" />
      <Plus className="-right-[6px] -bottom-[6px]" />
    </>
  );
}

function Plus({ className }: { className: string }) {
  return (
    <svg
      aria-hidden
      width="11"
      height="11"
      viewBox="0 0 11 11"
      className={cn('pointer-events-none absolute text-muted-foreground/70', className)}
    >
      <path d="M5.5 0v11M0 5.5h11" stroke="currentColor" strokeWidth="1" />
    </svg>
  );
}
