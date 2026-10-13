import type { AppLocale } from "@/i18n/config";
import type { ContentType } from "@/lib/presets";

/** One sample topic: every content type, in every content language. */
export type Fixture = Record<AppLocale, Record<ContentType, string>>;
