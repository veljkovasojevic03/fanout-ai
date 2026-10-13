import type { AuthErrorCode, AuthNotice, FieldErrorCode } from "./errors";

/** Result of an auth Server Action, consumed by `useActionState` in the forms. */
export type AuthFormState =
  | { status: "idle" }
  | {
      status: "error";
      code: AuthErrorCode;
      fields?: Record<string, FieldErrorCode>;
      /** Changes on every attempt; forms use it to remount the single-use CAPTCHA. */
      at: number;
    }
  | { status: "success"; notice: AuthNotice; at: number };

export const IDLE_STATE: AuthFormState = { status: "idle" };
