"use client";

import { createContext, useContext, useId, useMemo } from "react";

import { cn } from "@/lib/utils";

import { Label } from "./label";

type FieldContextValue = {
  id: string;
  describedBy: string | undefined;
  invalid: boolean;
};

const FieldContext = createContext<FieldContextValue | null>(null);

type ControlA11yProps = {
  id?: string;
  "aria-describedby"?: string;
  "aria-invalid"?: React.AriaAttributes["aria-invalid"];
};

/**
 * Wires a form control to its surrounding `Field` (label, hint, error).
 * Explicit props on the control always win over the field's defaults.
 */
export function useFieldControl<T extends ControlA11yProps>(props: T): T {
  const field = useContext(FieldContext);
  if (!field) return props;

  const describedBy =
    [props["aria-describedby"], field.describedBy].filter(Boolean).join(" ") || undefined;

  return {
    ...props,
    id: props.id ?? field.id,
    "aria-describedby": describedBy,
    "aria-invalid": props["aria-invalid"] ?? (field.invalid || undefined),
  };
}

type FieldProps = Omit<React.ComponentProps<"div">, "children"> & {
  label: React.ReactNode;
  /** Helper text shown below the control. */
  hint?: React.ReactNode;
  /** Error message; when set the control is marked invalid and the hint is replaced. */
  error?: React.ReactNode;
  /** Trailing element on the label row, e.g. a character counter. */
  aside?: React.ReactNode;
  children: React.ReactNode;
};

/** Label + control + hint/error, with ids and ARIA wired automatically. */
function Field({ label, hint, error, aside, className, children, ...props }: FieldProps) {
  const id = useId();
  const hintId = `${id}-hint`;
  const errorId = `${id}-error`;
  const invalid = Boolean(error);

  const value = useMemo<FieldContextValue>(
    () => ({
      id,
      describedBy: invalid ? errorId : hint ? hintId : undefined,
      invalid,
    }),
    [id, invalid, errorId, hint, hintId],
  );

  return (
    <FieldContext.Provider value={value}>
      <div data-slot="field" className={cn("flex flex-col gap-1.5", className)} {...props}>
        <div className="flex items-baseline justify-between gap-3">
          <Label htmlFor={id}>{label}</Label>
          {aside ? <span className="counter text-[11px] text-muted">{aside}</span> : null}
        </div>
        {children}
        {invalid ? (
          <p id={errorId} role="alert" className="text-[13px] leading-snug text-danger">
            {error}
          </p>
        ) : hint ? (
          <p id={hintId} className="text-[13px] leading-snug text-muted">
            {hint}
          </p>
        ) : null}
      </div>
    </FieldContext.Provider>
  );
}

export { Field };
