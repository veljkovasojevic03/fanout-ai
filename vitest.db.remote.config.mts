import { defineConfig, mergeConfig } from "vitest/config";

import base from "./vitest.db.config.mts";

// Same database tests, against the real Supabase database in SUPABASE_DB_URL.
// Every test runs in a transaction that is rolled back.
export default mergeConfig(
  base,
  defineConfig({
    test: {
      env: { DB_TEST_TARGET: "remote" },
    },
  }),
);
