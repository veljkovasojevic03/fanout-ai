import { describe, expect, it } from "vitest";

import { fieldErrors, formValues, signInSchema, signUpSchema, upgradeEmailSchema } from "./schemas";

describe("auth schemas", () => {
  it("normalises the email (trim + lowercase)", () => {
    const result = signUpSchema.safeParse({ email: "  Ada@Example.COM ", password: "longenough" });
    expect(result.success && result.data.email).toBe("ada@example.com");
  });

  it("reports one error code per invalid field", () => {
    const result = signUpSchema.safeParse({ email: "not-an-email", password: "short" });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(fieldErrors(result.error)).toEqual({
        email: "email_invalid",
        password: "password_too_short",
      });
    }
  });

  it("caps new passwords at 72 characters (bcrypt limit)", () => {
    const result = signUpSchema.safeParse({ email: "a@b.co", password: "x".repeat(73) });
    expect(!result.success && fieldErrors(result.error)).toEqual({ password: "password_too_long" });
  });

  it("does not apply the new-password rules when signing in", () => {
    expect(signInSchema.safeParse({ email: "a@b.co", password: "old" }).success).toBe(true);
    expect(signInSchema.safeParse({ email: "a@b.co", password: "" }).success).toBe(false);
  });

  it("treats a missing field as invalid", () => {
    const result = upgradeEmailSchema.safeParse({});
    expect(!result.success && fieldErrors(result.error)).toHaveProperty("email");
  });
});

describe("formValues", () => {
  it("picks only the named string fields", () => {
    const data = new FormData();
    data.set("email", "a@b.co");
    data.set("role", "admin");
    data.set("avatar", new Blob(["x"]));
    expect(formValues(data, ["email", "avatar", "missing"])).toEqual({ email: "a@b.co" });
  });
});
