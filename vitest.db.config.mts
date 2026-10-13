import { defineConfig } from "vitest/config";

// Database tests (RLS, grants, quota functions). See tests/db/harness.ts.
export default defineConfig({
  test: {
    environment: "node",
    include: ["tests/db/**/*.test.ts"],
    // One database connection per file; files run one after another.
    fileParallelism: false,
    testTimeout: 30_000,
    hookTimeout: 60_000,
  },
});
