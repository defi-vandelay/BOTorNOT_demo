import { Slot } from '@radix-ui/react-slot';
import { cva, type VariantProps } from 'class-variance-authority';
import { cn } from '@/lib/utils';

const buttonVariants = cva(
  'inline-flex cursor-pointer items-center justify-center gap-2 rounded-md text-sm font-medium transition-colors outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background disabled:pointer-events-none disabled:opacity-40',
  {
    variants: {
      variant: {
        /** Off-white, Geist's primary button. */
        default: 'bg-primary text-primary-foreground hover:bg-primary/85',
        /** Cyan: the one main action on a screen. */
        brand: 'bg-brand text-brand-foreground hover:bg-brand/85',
        outline:
          'border border-border-strong bg-transparent text-foreground hover:border-foreground/40 hover:bg-accent',
        ghost: 'text-muted-foreground hover:bg-accent hover:text-foreground',
        link: 'h-auto px-0 text-muted-foreground underline underline-offset-4 hover:text-foreground',
      },
      size: {
        default: 'min-h-9 px-4 py-2',
        sm: 'min-h-8 px-3 py-1.5 text-xs',
        lg: 'min-h-12 px-6 py-3 text-base',
        icon: 'size-8',
      },
    },
    defaultVariants: { variant: 'default', size: 'default' },
  },
);

export function Button({
  className,
  variant,
  size,
  asChild = false,
  ...props
}: React.ComponentProps<'button'> & VariantProps<typeof buttonVariants> & { asChild?: boolean }) {
  const Comp = asChild ? Slot : 'button';
  return <Comp className={cn(buttonVariants({ variant, size }), className)} {...props} />;
}

export { buttonVariants };
