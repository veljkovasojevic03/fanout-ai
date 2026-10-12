"use client";

import { cn } from "@/lib/utils";

import { useFieldControl } from "./field";

/** Shared look for text-like controls (Input, Textarea, Select trigger). */
export const controlClasses = cn(
  "w-full rounded-md border border-border bg-surface text-sm text-foreground",
  "placeholder:text-subtle",
  "transition-[border-color,box-shadow,background-color] duration-150 ease-out",
  "hover:border-border-strong",
  "focus-visible:border-accent-ring focus-visible:shadow-[0_0_0_3px_var(--accent-soft)] focus-visible:outline-none",
  "disabled:cursor-not-allowed disabled:opacity-50",
  "aria-invalid:border-danger/60 aria-invalid:focus-visible:shadow-[0_0_0_3px_var(--danger-soft)]",
);

function Input({ className, type = "text", ...props }: React.ComponentProps<"input">) {
  const controlProps = useFieldControl(props);
  return (
    <input
      data-slot="input"
      type={type}
      className={cn(controlClasses, "h-9.5 px-3", className)}
      {...controlProps}
    />
  );
}

function Textarea({ className, rows = 4, ...props }: React.ComponentProps<"textarea">) {
  const controlProps = useFieldControl(props);
  return (
    <textarea
      data-slot="textarea"
      rows={rows}
      className={cn(controlClasses, "min-h-20 resize-y px-3 py-2.5 leading-relaxed", className)}
      {...controlProps}
    />
  );
}

export { Input, Textarea };
