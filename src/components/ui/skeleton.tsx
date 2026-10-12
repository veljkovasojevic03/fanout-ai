import { cn } from "@/lib/utils";

/**
 * Loading placeholder. Decorative by default (`aria-hidden`); announce the loading
 * state on the surrounding region instead (e.g. `aria-busy`).
 */
function Skeleton({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="skeleton"
      aria-hidden="true"
      className={cn(
        "animate-shimmer rounded-sm bg-white/[0.05] bg-[linear-gradient(90deg,transparent_25%,rgba(255,255,255,0.07)_50%,transparent_75%)] bg-[length:200%_100%]",
        className,
      )}
      {...props}
    />
  );
}

export { Skeleton };
