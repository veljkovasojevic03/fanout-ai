import type { ContentType } from "@/lib/presets";

/** Where each card sits in the demo grid. Shared by the waiting cards and the streaming ones. */
export const demoCardClass = (type: ContentType) =>
  type === "blog" ? "flex min-w-0 lg:col-span-2" : "flex min-w-0";
