"use client";

import { Toaster as SonnerToaster, toast, type ToasterProps } from "sonner";

/**
 * App-wide toast region (sonner), restyled to the Fanout tokens.
 * Mount once in the root layout; trigger with `toast(...)` from anywhere on the client.
 */
function Toaster(props: ToasterProps) {
  return (
    <SonnerToaster
      theme="dark"
      position="bottom-right"
      gap={10}
      toastOptions={{
        classNames: {
          toast: "!font-sans !shadow-[0_16px_48px_-12px_rgba(0,0,0,0.7)]",
          title: "!text-sm !font-medium",
          description: "!text-[13px] !text-muted",
          actionButton: "!bg-accent !text-accent-foreground !font-medium !rounded-sm",
          cancelButton: "!bg-white/[0.06] !text-foreground !rounded-sm",
          success: "[&_[data-icon]]:!text-success",
          error: "[&_[data-icon]]:!text-danger",
          warning: "[&_[data-icon]]:!text-warn",
          info: "[&_[data-icon]]:!text-accent",
        },
      }}
      style={
        {
          "--normal-bg": "var(--elevated)",
          "--normal-text": "var(--foreground)",
          "--normal-border": "var(--border-strong)",
          "--border-radius": "var(--radius)",
        } as React.CSSProperties
      }
      {...props}
    />
  );
}

export { toast, Toaster };
