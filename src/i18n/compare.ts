/**
 * Pure comparison of two message catalogues. Used by `pnpm i18n:check` (CI) and
 * by the unit tests. Beyond matching key sets it also checks that every message
 * uses the same ICU arguments and rich-text tags in both languages — a
 * translation that drops `{count}` or `<link>` is a bug that key parity misses.
 */
export type MessageTree = { [key: string]: string | MessageTree };

export type CatalogueProblem =
  | { kind: "missing"; key: string }
  | { kind: "extra"; key: string }
  | { kind: "empty"; key: string }
  | { kind: "arguments"; key: string; expected: string[]; actual: string[] }
  | { kind: "tags"; key: string; expected: string[]; actual: string[] };

export function flatten(tree: MessageTree, prefix = ""): Map<string, string> {
  const result = new Map<string, string>();
  for (const [key, value] of Object.entries(tree)) {
    const path = prefix ? `${prefix}.${key}` : key;
    if (typeof value === "string") result.set(path, value);
    else for (const [k, v] of flatten(value, path)) result.set(k, v);
  }
  return result;
}

/** ICU argument names: `{name}`, `{count, plural, …}`. `{# items}` branches are not arguments. */
export function icuArguments(message: string): string[] {
  const names = new Set<string>();
  for (const match of message.matchAll(/\{\s*([A-Za-z_]\w*)\s*[,}]/g)) names.add(match[1]!);
  return [...names].sort();
}

/** Rich-text tag names: `<link>…</link>`. */
export function richTags(message: string): string[] {
  const names = new Set<string>();
  for (const match of message.matchAll(/<([A-Za-z]\w*)>/g)) names.add(match[1]!);
  return [...names].sort();
}

const same = (a: string[], b: string[]) => a.length === b.length && a.every((v, i) => v === b[i]);

/** Problems in `other` relative to `base` (the reference catalogue). */
export function compareCatalogues(base: MessageTree, other: MessageTree): CatalogueProblem[] {
  const baseFlat = flatten(base);
  const otherFlat = flatten(other);
  const problems: CatalogueProblem[] = [];

  for (const [key, baseMessage] of baseFlat) {
    const otherMessage = otherFlat.get(key);
    if (otherMessage === undefined) {
      problems.push({ kind: "missing", key });
      continue;
    }
    if (otherMessage.trim() === "") problems.push({ kind: "empty", key });

    const expectedArgs = icuArguments(baseMessage);
    const actualArgs = icuArguments(otherMessage);
    if (!same(expectedArgs, actualArgs)) {
      problems.push({ kind: "arguments", key, expected: expectedArgs, actual: actualArgs });
    }

    const expectedTags = richTags(baseMessage);
    const actualTags = richTags(otherMessage);
    if (!same(expectedTags, actualTags)) {
      problems.push({ kind: "tags", key, expected: expectedTags, actual: actualTags });
    }
  }

  for (const key of otherFlat.keys()) {
    if (!baseFlat.has(key)) problems.push({ kind: "extra", key });
  }
  for (const [key, message] of baseFlat) {
    if (message.trim() === "") problems.push({ kind: "empty", key });
  }

  return problems;
}

export function describeProblem(problem: CatalogueProblem, otherName: string): string {
  switch (problem.kind) {
    case "missing":
      return `${otherName}: missing key "${problem.key}"`;
    case "extra":
      return `${otherName}: extra key "${problem.key}" (not in the reference catalogue)`;
    case "empty":
      return `empty message at "${problem.key}"`;
    case "arguments":
      return `${otherName}: "${problem.key}" uses arguments {${problem.actual.join(", ")}} but the reference uses {${problem.expected.join(", ")}}`;
    case "tags":
      return `${otherName}: "${problem.key}" uses tags <${problem.actual.join(", ")}> but the reference uses <${problem.expected.join(", ")}>`;
  }
}
