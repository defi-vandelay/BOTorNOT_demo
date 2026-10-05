import { cva, type VariantProps } from 'class-variance-authority';
import { cn } from '@/lib/utils';

const badgeVariants = cva(
  'inline-flex items-center gap-1 rounded-sm border px-1.5 py-0.5 font-mono text-[10px] leading-none tracking-wider uppercase',
  {
    variants: {
      variant: {
        default: 'border-border-strong text-muted-foreground',
        brand: 'border-brand/40 text-brand',
        destructive: 'border-destructive/40 text-destructive',
      },
    },
    defaultVariants: { variant: 'default' },
  },
);

export function Badge({
  className,
  variant,
  ...props
}: React.ComponentProps<'span'> & VariantProps<typeof badgeVariants>) {
  return <span className={cn(badgeVariants({ variant }), className)} {...props} />;
}
