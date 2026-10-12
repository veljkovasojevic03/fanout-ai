import { cn } from "@/lib/utils";

const RAY_ENDS = [3, 7.5, 12, 16.5, 21] as const;

/** The mark: one source point fanning out into five outputs. */
export function FanoutMark({ className, ...props }: React.SVGProps<SVGSVGElement>) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      aria-hidden="true"
      focusable="false"
      className={cn("size-5 text-accent", className)}
      {...props}
    >
      {RAY_ENDS.map((y) => (
        <path
          key={y}
          d={`M5 12 L19 ${y}`}
          stroke="currentColor"
          strokeWidth="1.5"
          strokeLinecap="round"
          opacity={y === 12 ? 1 : 0.7}
        />
      ))}
      {RAY_ENDS.map((y) => (
        <circle key={y} cx="19.5" cy={y} r="1.5" fill="currentColor" />
      ))}
      <circle cx="4.5" cy="12" r="2.5" fill="currentColor" />
    </svg>
  );
}

const sizes = {
  sm: { text: "text-base", mark: "size-4", badge: "text-[9px] px-1 py-px" },
  md: { text: "text-lg", mark: "size-5", badge: "text-[10px] px-1.5 py-px" },
  lg: { text: "text-3xl", mark: "size-8", badge: "text-xs px-2 py-0.5" },
} as const;

type WordmarkProps = React.HTMLAttributes<HTMLSpanElement> & {
  size?: keyof typeof sizes;
};

/** Fanout wordmark: mark + "Fanout" + a small "AI" badge. */
export function Wordmark({ size = "md", className, ...props }: WordmarkProps) {
  const s = sizes[size];
  return (
    <span
      role="img"
      aria-label="Fanout AI"
      className={cn("inline-flex items-center gap-2 select-none", className)}
      {...props}
    >
      <FanoutMark className={s.mark} />
      <span aria-hidden="true" className="inline-flex items-center gap-1.5">
        <span className={cn("font-semibold tracking-tight text-foreground", s.text)}>Fanout</span>
        <span
          className={cn(
            "rounded-[5px] border border-accent-ring bg-accent-soft font-mono leading-none font-medium tracking-wider text-accent",
            s.badge,
          )}
        >
          AI
        </span>
      </span>
    </span>
  );
}
