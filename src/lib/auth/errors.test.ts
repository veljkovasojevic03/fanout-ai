import { describe, expect, it } from "vitest";

import en from "../../../messages/en.json";
import sr from "../../../messages/sr.json";

import {
  AUTH_ERROR_CODES,
  AUTH_NOTICES,
  FIELD_ERROR_CODES,
  isAuthErrorCode,
  mapAuthError,
} from "./errors";

describe("mapAuthError", () => {
  it.each([
    ["invalid_credentials", "invalid_credentials"],
    ["user_already_exists", "email_taken"],
    ["email_exists", "email_taken"],
    ["captcha_failed", "captcha_failed"],
    ["over_email_send_rate_limit", "rate_limited"],
    ["anonymous_provider_disabled", "guest_disabled"],
    ["manual_linking_disabled", "linking_disabled"],
    ["identity_already_exists", "identity_taken"],
    ["otp_expired", "link_expired"],
    ["bad_code_verifier", "link_expired"],
  ])("maps Supabase code %s to %s", (code, expected) => {
    expect(mapAuthError({ code })).toBe(expected);
  });

  it("falls back on HTTP status when the code is unknown", () => {
    expect(mapAuthError({ code: "brand_new_code", status: 429 })).toBe("rate_limited");
    expect(mapAuthError({ status: 503 })).toBe("unavailable");
  });

  it("treats network failures as unavailable", () => {
    expect(mapAuthError({ name: "AuthRetryableFetchError", status: 0 })).toBe("unavailable");
  });

  it("never leaks an unmapped code: unknown input becomes 'unknown'", () => {
    expect(mapAuthError({ code: "some_internal_detail", status: 400 })).toBe("unknown");
    expect(mapAuthError(null)).toBe("unknown");
  });
});

describe("auth message catalogue", () => {
  const sorted = (values: readonly string[]) => [...values].sort();

  it.each([
    ["en", en],
    ["sr", sr],
  ])("%s has exactly one message per error code, field error and notice", (_name, messages) => {
    expect(sorted(Object.keys(messages.auth.errors))).toEqual(sorted(AUTH_ERROR_CODES));
    expect(sorted(Object.keys(messages.auth.fieldErrors))).toEqual(sorted(FIELD_ERROR_CODES));
    expect(sorted(Object.keys(messages.auth.notices))).toEqual(sorted(AUTH_NOTICES));
  });

  it("validates codes coming from the query string", () => {
    expect(isAuthErrorCode("link_expired")).toBe(true);
    expect(isAuthErrorCode("<script>")).toBe(false);
    expect(isAuthErrorCode(undefined)).toBe(false);
  });
});
