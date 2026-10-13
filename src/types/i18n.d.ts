import type messages from "../../messages/en.json";
import type { IntlLocale } from "../i18n/config";

// Makes every translation key type-checked against messages/en.json:
// a typo or a missing key is a compile error, not a runtime "MISSING_MESSAGE".
declare module "next-intl" {
  interface AppConfig {
    Locale: IntlLocale;
    Messages: typeof messages;
  }
}
