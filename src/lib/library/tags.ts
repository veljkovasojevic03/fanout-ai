/*
 * Tags are free-form (spec §4.4), so they are normalised in one place: the tag
 * editor uses these functions for instant feedback and the save action runs
 * them again as the actual gate. The database enforces the same length and
 * count limits (contents_tags_valid).
 */

export const TAG_LIMITS = { maxLength: 32, maxPerContent: 20 } as const;

/**
 * One tag in its stored form: lower case, single spaces, no leading "#", at
 * most 32 characters. Returns null when nothing usable is left.
 */
export function normalizeTag(raw: string): string | null {
  const cleaned = raw
    .normalize("NFC")
    // Control and zero-width characters would make two tags look identical.
    .replace(/[\p{Cc}\p{Cf}]/gu, " ")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/^#+\s*/, "")
    .toLowerCase();

  const clipped = Array.from(cleaned).slice(0, TAG_LIMITS.maxLength).join("").trim();
  return clipped === "" ? null : clipped;
}

/** Normalises a list: drops empties and duplicates, keeps first-seen order, caps the count. */
export function normalizeTags(raw: readonly string[]): string[] {
  const tags: string[] = [];
  for (const value of raw) {
    const tag = normalizeTag(value);
    if (tag && !tags.includes(tag)) tags.push(tag);
    if (tags.length >= TAG_LIMITS.maxPerContent) break;
  }
  return tags;
}

/** Adds `raw` (which may hold several comma-separated tags) to the list, within the limits. */
export function addTags(current: readonly string[], raw: string): string[] {
  return normalizeTags([...current, ...raw.split(/[,\n]/)]);
}

/**
 * Autocomplete: the user's existing tags that match what is being typed and
 * are not on this piece yet. Prefix matches come before "contains" matches.
 */
export function suggestTags(
  known: readonly string[],
  current: readonly string[],
  draft: string,
  limit = 8,
): string[] {
  const query = normalizeTag(draft);
  const available = known.filter((tag) => !current.includes(tag));
  if (!query) return available.slice(0, limit);

  const starts = available.filter((tag) => tag.startsWith(query));
  const contains = available.filter((tag) => !tag.startsWith(query) && tag.includes(query));
  return [...starts, ...contains].slice(0, limit);
}
