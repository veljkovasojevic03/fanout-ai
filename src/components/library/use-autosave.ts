"use client";

import { useCallback, useEffect, useRef, useState } from "react";

export type SaveStatus = "saved" | "dirty" | "saving" | "error";

export type SaveOutcome<E extends string> = { ok: true } | { ok: false; code: E };

type Options<T, E extends string> = {
  /** The thing to keep saved. Compared by its JSON form. */
  value: T;
  save(value: T): Promise<SaveOutcome<E>>;
  /** Reported when `save` throws (e.g. the network is down). */
  fallbackError: E;
  /** Quiet time after the last change before saving. */
  delayMs?: number;
};

/**
 * Debounced autosave with an honest status (spec Phase 4.2).
 *
 *  - saves `delayMs` after the last change; only one save runs at a time, and
 *    changes made while it runs are saved right after it;
 *  - a failed save is not retried in a loop: the status stays "error" until
 *    the next edit or an explicit `flush()` (the Retry button);
 *  - `flush()` saves now and resolves to whether everything is stored — used
 *    before actions that read the saved version, like export;
 *  - while there are unsaved changes the browser asks before closing the tab,
 *    and a last save is attempted when the editor unmounts.
 */
export function useAutosave<T, E extends string>({
  value,
  save,
  fallbackError,
  delayMs = 1200,
}: Options<T, E>) {
  const serialized = JSON.stringify(value);
  const [saved, setSaved] = useState(serialized);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<E | null>(null);

  const latest = useRef({ value, serialized });
  const savedRef = useRef(serialized);
  const saveRef = useRef(save);
  const runner = useRef<Promise<boolean> | null>(null);
  useEffect(() => {
    latest.current = { value, serialized };
    saveRef.current = save;
  });

  const flush = useCallback((): Promise<boolean> => {
    runner.current ??= (async () => {
      try {
        while (latest.current.serialized !== savedRef.current) {
          const snapshot = latest.current;
          setSaving(true);
          let outcome: SaveOutcome<E>;
          try {
            outcome = await saveRef.current(snapshot.value);
          } catch {
            outcome = { ok: false, code: fallbackError };
          }
          if (!outcome.ok) {
            setError(outcome.code);
            return false;
          }
          savedRef.current = snapshot.serialized;
          setSaved(snapshot.serialized);
          setError(null);
        }
        return true;
      } finally {
        runner.current = null;
        setSaving(false);
      }
    })();
    return runner.current;
  }, [fallbackError]);

  const dirty = serialized !== saved;

  useEffect(() => {
    if (!dirty) return;
    const timer = window.setTimeout(() => void flush(), delayMs);
    return () => window.clearTimeout(timer);
    // `serialized` restarts the timer on every change, which is the debounce.
  }, [dirty, serialized, delayMs, flush]);

  useEffect(() => {
    if (!dirty) return;
    const warn = (event: BeforeUnloadEvent) => event.preventDefault();
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [dirty]);

  // Leaving the page inside the app: save whatever is still pending.
  useEffect(() => () => void flush(), [flush]);

  const status: SaveStatus = saving ? "saving" : !dirty ? "saved" : error ? "error" : "dirty";

  return { status, error: dirty ? error : null, flush };
}
