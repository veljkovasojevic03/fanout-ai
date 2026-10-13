"use client";

import { Slider as SliderPrimitive } from "radix-ui";

import { cn } from "@/lib/utils";

type SliderProps = Omit<React.ComponentProps<typeof SliderPrimitive.Root>, "children"> & {
  /** Accessible name / description for the thumb. */
  "aria-labelledby"?: string;
  "aria-valuetext"?: string;
};

/** Single-thumb slider. Arrow keys step; Home/End jump to the ends. */
function Slider({
  className,
  "aria-labelledby": labelledBy,
  "aria-valuetext": valueText,
  ...props
}: SliderProps) {
  return (
    <SliderPrimitive.Root
      data-slot="slider"
      className={cn(
        "relative flex h-5 w-full touch-none items-center select-none data-disabled:opacity-45",
        className,
      )}
      {...props}
    >
      <SliderPrimitive.Track className="relative h-1.5 w-full grow overflow-hidden rounded-full bg-white/[0.08]">
        <SliderPrimitive.Range className="absolute h-full rounded-full bg-accent" />
      </SliderPrimitive.Track>
      <SliderPrimitive.Thumb
        aria-labelledby={labelledBy}
        aria-valuetext={valueText}
        className="block size-4.5 rounded-full border-2 border-accent bg-background shadow-[0_0_0_4px_var(--accent-soft)] transition-shadow hover:shadow-[0_0_0_6px_var(--accent-soft)]"
      />
    </SliderPrimitive.Root>
  );
}

export { Slider };
