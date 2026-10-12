import { cn } from "@/lib/utils";

type EmptyStateProps = Omit<React.ComponentProps<"div">, "title"> & {
  icon?: React.ReactNode;
  title: React.ReactNode;
  description?: React.ReactNode;
  /** Primary (and optional secondary) action, usually one or two Buttons. */
  action?: React.ReactNode;
  tone?: "neutral" | "danger";
};

/** Centered placeholder for empty lists and recoverable error states. */
function EmptyState({
  icon,
  title,
  description,
  action,
  tone = "neutral",
  className,
  ...props
}: EmptyStateProps) {
  return (
    <div
      data-slot="empty-state"
      className={cn(
        "flex flex-col items-center justify-center gap-4 rounded-xl border border-dashed border-border px-6 py-12 text-center",
        className,
      )}
      {...props}
    >
      {icon ? (
        <div
          aria-hidden="true"
          className={cn(
            "flex size-11 items-center justify-center rounded-lg border [&_svg]:size-5",
            tone === "danger"
              ? "border-danger/25 bg-danger-soft text-danger"
              : "border-border bg-elevated text-muted",
          )}
        >
          {icon}
        </div>
      ) : null}
      <div className="flex max-w-sm flex-col gap-1.5">
        <p className="text-[15px] font-semibold tracking-tight text-foreground">{title}</p>
        {description ? <p className="text-sm leading-relaxed text-muted">{description}</p> : null}
      </div>
      {action ? (
        <div className="flex flex-wrap items-center justify-center gap-2">{action}</div>
      ) : null}
    </div>
  );
}

export { EmptyState };
