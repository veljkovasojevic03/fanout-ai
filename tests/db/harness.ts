import { randomUUID } from "node:crypto";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import path from "node:path";

import { PGlite } from "@electric-sql/pglite";
import pg from "pg";
import { expect } from "vitest";

/**
 * Database test harness.
 *
 * Default: an in-process Postgres (PGlite) with a small Supabase shim and all
 * migrations applied — hermetic, no Docker, runs in CI.
 *
 * With SUPABASE_DB_URL set (e.g. `pnpm test:db:remote`): the same tests run
 * against a real Supabase database whose migrations are already applied. Every
 * test runs inside a transaction that is rolled back, so nothing is persisted.
 */

const ROOT = path.resolve(import.meta.dirname, "../..");
const MIGRATIONS_DIR = path.join(ROOT, "supabase/migrations");
const SHIM_FILE = path.join(import.meta.dirname, "supabase-shim.sql");

export const PERMISSION_DENIED = "42501";
export const CHECK_VIOLATION = "23514";

export type Row = Record<string, unknown>;

export interface Db {
  readonly kind: "pglite" | "remote";
  query<T extends Row = Row>(sql: string, params?: unknown[]): Promise<T[]>;
  close(): Promise<void>;
}

function loadLocalEnv(): void {
  const file = path.join(ROOT, ".env.local");
  if (!process.env.SUPABASE_DB_URL && existsSync(file)) {
    process.loadEnvFile(file);
  }
}

async function openPglite(): Promise<Db> {
  const db = new PGlite();
  await db.exec(readFileSync(SHIM_FILE, "utf8"));
  const files = readdirSync(MIGRATIONS_DIR)
    .filter((name) => name.endsWith(".sql"))
    .sort();
  for (const name of files) {
    try {
      await db.exec(readFileSync(path.join(MIGRATIONS_DIR, name), "utf8"));
    } catch (error) {
      throw new Error(`Migration ${name} failed: ${(error as Error).message}`, { cause: error });
    }
  }
  return {
    kind: "pglite",
    async query<T extends Row = Row>(sql: string, params: unknown[] = []) {
      const result = await db.query<T>(sql, params);
      return result.rows;
    },
    close: () => db.close(),
  };
}

async function openRemote(url: string): Promise<Db> {
  const client = new pg.Client({ connectionString: url });
  await client.connect();
  return {
    kind: "remote",
    async query<T extends Row = Row>(sql: string, params: unknown[] = []) {
      const result = await client.query(sql, params);
      return result.rows as T[];
    },
    close: () => client.end(),
  };
}

export async function openDb(): Promise<Db> {
  loadLocalEnv();
  const url = process.env.DB_TEST_TARGET === "remote" ? process.env.SUPABASE_DB_URL : undefined;
  if (process.env.DB_TEST_TARGET === "remote" && !url) {
    throw new Error("DB_TEST_TARGET=remote requires SUPABASE_DB_URL (see .env.example).");
  }
  return url ? openRemote(url) : openPglite();
}

/** Each test runs in its own transaction; `rollback` discards everything it did. */
export const begin = (db: Db) => db.query("begin");
export const rollback = (db: Db) => db.query("rollback");

type NewUser = { anonymous?: boolean; meta?: Record<string, unknown> };

/** Inserts an auth user the way Supabase Auth would, firing the profile trigger. */
export async function createUser(db: Db, options: NewUser = {}): Promise<string> {
  const id = randomUUID();
  const anonymous = options.anonymous ?? false;
  await db.query(
    `insert into auth.users (id, aud, role, email, is_anonymous, raw_user_meta_data)
     values ($1, 'authenticated', 'authenticated', $2, $3, $4::jsonb)`,
    [id, anonymous ? null : `${id}@fanout.test`, anonymous, JSON.stringify(options.meta ?? {})],
  );
  return id;
}

async function resetRole(db: Db): Promise<void> {
  await db.query("reset role");
  await db.query("select set_config('request.jwt.claims', '', true)");
}

/** Runs `fn` as a signed-in user: the `authenticated` role plus their JWT `sub`. */
export async function asUser<T>(db: Db, userId: string, fn: () => Promise<T>): Promise<T> {
  await db.query("set local role authenticated");
  await db.query("select set_config('request.jwt.claims', $1, true)", [
    JSON.stringify({ sub: userId, role: "authenticated" }),
  ]);
  try {
    return await fn();
  } finally {
    await resetRole(db);
  }
}

/** Runs `fn` as a logged-out visitor (the `anon` role, no JWT subject). */
export async function asAnon<T>(db: Db, fn: () => Promise<T>): Promise<T> {
  await db.query("set local role anon");
  try {
    return await fn();
  } finally {
    await resetRole(db);
  }
}

/** Runs `fn` the way server routes do: the `service_role`, bypassing RLS. */
export async function asService<T>(db: Db, fn: () => Promise<T>): Promise<T> {
  await db.query("set local role service_role");
  try {
    return await fn();
  } finally {
    await resetRole(db);
  }
}

/**
 * Asserts that a statement is rejected with the given SQLSTATE. Runs inside a
 * savepoint so the surrounding test transaction stays usable afterwards.
 */
export async function expectSqlError(
  db: Db,
  code: string,
  sql: string,
  params: unknown[] = [],
): Promise<void> {
  await db.query("savepoint expect_error");
  let caught: unknown;
  try {
    await db.query(sql, params);
  } catch (error) {
    caught = error;
  }
  await db.query("rollback to savepoint expect_error");
  expect(caught, `expected SQLSTATE ${code} from: ${sql}`).toBeDefined();
  expect((caught as { code?: string }).code).toBe(code);
}

export const expectDenied = (db: Db, sql: string, params: unknown[] = []) =>
  expectSqlError(db, PERMISSION_DENIED, sql, params);
