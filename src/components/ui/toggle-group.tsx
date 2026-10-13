"use client";

import { ToggleGroup as ToggleGroupPrimitive } from "radix-ui";

import { cn } from "@/lib/utils";

/**
 * A row of chips: `type="single"` behaves like radio buttons, `type="multiple"`
 * like checkboxes. Arrow keys move between chips; Space/Enter toggles.
 */
function ToggleGroup({
  className,
  ...props
}: React.ComponentProps<typeof ToggleGroupPrimitive.Root>) {
  return (
    <ToggleGroupPrimitive.Root
      data-slot="toggle-group"
      className={cn("flex flex-wrap gap-1.5", className)}
      {...props}
    />
  );
}

function ToggleGroupItem({
  className,
  ...props
}: React.ComponentProps<typeof ToggleGroupPrimitive.Item>) {
  return (
    <ToggleGroupPrimitive.Item
      data-slot="toggle-group-item"
      className={cn(
        "inline-flex h-8.5 items-center gap-1.5 rounded-md border border-border bg-surface px-3 text-[13px] font-medium whitespace-nowrap text-muted",
        "transition-colors duration-150 hover:border-border-strong hover:text-foreground",
        "data-[state=on]:border-accent-ring data-[state=on]:bg-accent-soft data-[state=on]:text-accent",
        "disabled:pointer-events-none disabled:opacity-45",
        "[&_svg]:size-3.5 [&_svg]:shrink-0",
        className,
      )}
      {...props}
    />
  );
}

export { ToggleGroup, ToggleGroupItem };
