/**
 * pnpm i18n:check — fails (exit 1) unless every locale has exactly the same
 * message keys, ICU arguments and rich-text tags as the reference (en.json).
 * Run with plain Node (type stripping); no build step, no dependencies.
 */
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";

import {
  compareCatalogues,
  describeProblem,
  flatten,
  type MessageTree,
} from "../src/i18n/compare.ts";

const MESSAGES_DIR = path.resolve(import.meta.dirname, "../messages");
const REFERENCE = "en.json";

const load = (file: string): MessageTree =>
  JSON.parse(readFileSync(path.join(MESSAGES_DIR, file), "utf8")) as MessageTree;

const reference = load(REFERENCE);
const others = readdirSync(MESSAGES_DIR).filter((f) => f.endsWith(".json") && f !== REFERENCE);

if (others.length === 0) {
  console.error(`i18n:check — no locale files next to ${REFERENCE}`);
  process.exit(1);
}

let failed = false;

for (const file of others) {
  const problems = compareCatalogues(reference, load(file));
  if (problems.length > 0) {
    failed = true;
    console.error(`\n${file} — ${problems.length} problem(s):`);
    for (const problem of problems) console.error(`  - ${describeProblem(problem, file)}`);
  }
}

if (failed) {
  console.error("\ni18n:check failed.");
  process.exit(1);
}

console.warn(
  `i18n:check passed — ${flatten(reference).size} keys in ${[REFERENCE, ...others].join(", ")}`,
);
