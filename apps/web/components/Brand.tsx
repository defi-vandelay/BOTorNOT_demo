import { cn } from '@/lib/utils';

/** The BOT or NOT wordmark: a cyan pixel and the name in Geist Pixel. */
export function Wordmark({ className }: { className?: string }) {
  return (
    <span className={cn('inline-flex items-center gap-2 text-xl leading-none', className)}>
      <span aria-hidden className="size-2.5 bg-brand" />
      <span className="font-pixel">BOT</span>
      <span className="font-sans text-sm text-muted-foreground">or</span>
      <span className="font-pixel">NOT</span>
    </span>
  );
}

/** The top bar shared by every page: wordmark on the left, the page's own items on the right. */
export function SiteHeader({ children, page }: { children?: React.ReactNode; page?: string }) {
  return (
    <header className="-mx-4 mb-8 flex h-14 items-center justify-between gap-4 border-b border-border px-4 sm:-mx-8 sm:px-8">
      <h1 className="flex items-center gap-3">
        <Wordmark />
        {page && <span className="eyebrow">/ {page}</span>}
      </h1>
      <div className="flex items-center gap-3 sm:gap-4">{children}</div>
    </header>
  );
}

/** The centred column with ruled edges that every page sits in. */
export function PageFrame({
  className,
  children,
}: {
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <main
      className={cn(
        'mx-auto flex min-h-screen w-full max-w-xl flex-col bg-background px-4 pb-10 sm:border-x sm:border-border sm:px-8',
        className,
      )}
    >
      {children}
    </main>
  );
}
