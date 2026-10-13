import { cn } from "@/lib/utils";

type UsageMeterProps = Omit<React.ComponentProps<"div">, "children"> & {
  used: number;
  limit: number;
  /** Accessible description, e.g. "2 of 5 generations used". Pass a translated string. */
  label: string;
  size?: "sm" | "md";
  /** Hide the "2/5" counter and show only the bar. */
  hideCount?: boolean;
};

export type UsageLevel = "ok" | "low" | "exhausted";

/** ok below 80%, low from 80%, exhausted at the limit (a zero limit counts as exhausted). */
export function usageLevel(used: number, limit: number): UsageLevel {
  if (limit <= 0 || used >= limit) return "exhausted";
  return used / limit >= 0.8 ? "low" : "ok";
}

const BAR_TONE: Record<UsageLevel, string> = {
  ok: "bg-accent",
  low: "bg-warn",
  exhausted: "bg-danger",
};

/**
 * Quota bar with a mono counter. The colour shifts as the allowance runs out,
 * but the numbers always carry the meaning — colour is only reinforcement.
 */
function UsageMeter({
  used,
  limit,
  label,
  size = "md",
  hideCount = false,
  className,
  ...props
}: UsageMeterProps) {
  const safeUsed = Math.max(0, Math.min(used, Math.max(limit, 0)));
  const percent = limit > 0 ? (safeUsed / limit) * 100 : 100;
  const level = usageLevel(used, limit);

  return (
    <div
      data-slot="usage-meter"
      data-level={level}
      className={cn("flex items-center gap-2.5", className)}
      {...props}
    >
      <div
        role="progressbar"
        aria-label={label}
        aria-valuemin={0}
        aria-valuemax={Math.max(limit, 0)}
        aria-valuenow={safeUsed}
        aria-valuetext={label}
        className={cn(
          "flex-1 overflow-hidden rounded-full bg-white/[0.07]",
          size === "sm" ? "h-1 min-w-12" : "h-1.5 min-w-20",
        )}
      >
        <div
          className={cn(
            "h-full rounded-full transition-[width] duration-500 ease-out",
            BAR_TONE[level],
          )}
          style={{ width: `${percent}%` }}
        />
      </div>
      {hideCount ? null : (
        <span
          aria-hidden="true"
          className={cn("shrink-0 counter text-muted", size === "sm" ? "text-[11px]" : "text-xs")}
        >
          <span className="text-foreground">{used}</span>/{limit}
        </span>
      )}
    </div>
  );
}

export { UsageMeter };
