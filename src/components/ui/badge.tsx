import { cva, type VariantProps } from "class-variance-authority";

import { cn } from "@/lib/utils";

const badgeVariants = cva(
  "inline-flex h-5.5 items-center gap-1 rounded-sm border px-2 font-mono text-[11px] leading-none font-medium tracking-wide whitespace-nowrap [&_svg]:size-3",
  {
    variants: {
      variant: {
        neutral: "border-border bg-white/[0.04] text-muted",
        accent: "border-accent-ring bg-accent-soft text-accent",
        solid: "border-transparent bg-accent text-accent-foreground",
        success: "border-success/25 bg-success-soft text-success",
        warn: "border-warn/25 bg-warn-soft text-warn",
        danger: "border-danger/25 bg-danger-soft text-danger",
      },
    },
    defaultVariants: {
      variant: "neutral",
    },
  },
);

type BadgeProps = React.ComponentProps<"span"> &
  VariantProps<typeof badgeVariants> & {
    /** Leading status dot in the badge's own color. */
    dot?: boolean;
  };

function Badge({ className, variant, dot = false, children, ...props }: BadgeProps) {
  return (
    <span data-slot="badge" className={cn(badgeVariants({ variant }), className)} {...props}>
      {dot ? <span aria-hidden="true" className="size-1.5 rounded-full bg-current" /> : null}
      {children}
    </span>
  );
}

export { Badge, badgeVariants };
