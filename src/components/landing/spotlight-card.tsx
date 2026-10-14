"use client";

import { cn } from "@/lib/utils";

/**
 * A bento card with a soft highlight that follows the pointer (spec Phase 7.2).
 * The position is written to CSS variables, so moving the pointer never
 * re-renders React. Hidden for touch (no hover) and under reduced motion.
 */
export function SpotlightCard({
  className,
  children,
}: {
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <div
      onPointerMove={(event) => {
        if (event.pointerType !== "mouse") return;
        const box = event.currentTarget.getBoundingClientRect();
        event.currentTarget.style.setProperty("--x", `${event.clientX - box.left}px`);
        event.currentTarget.style.setProperty("--y", `${event.clientY - box.top}px`);
      }}
      className={cn(
        "group relative overflow-hidden rounded-xl border border-border bg-surface transition-colors duration-300 hover:border-border-strong",
        className,
      )}
    >
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-0 opacity-0 transition-opacity duration-300 bg-spotlight group-hover:opacity-100 motion-reduce:hidden"
      />
      <div className="relative h-full">{children}</div>
    </div>
  );
}
