import type { ContentType, Length } from "@/lib/presets";

/*
 * The content contracts (spec §10), as code.
 *
 * One module, used on both sides: the server validates finished output and the
 * UI shows counters and warnings from the same functions, so they can never
 * disagree. Everything here is pure and safe to run on partial (still
 * streaming) text.
 *
 * Violations are reported as warnings — the text is never silently truncated
 * or rewritten (spec §5.11).
 */

export const LIMITS = {
  metaTitle: 60,
  metaDescription: 155,
  blogSections: { min: 3, max: 6 }, // 3–5 sections, plus an optional headed conclusion
  linkedinHashtags: 5,
  instagramHashtags: { min: 5, max: 8 },
  xPosts: { min: 5, max: 9 },
  xPostChars: 280,
  words: {
    linkedin: { min: 120, max: 220 },
    instagram: { min: 60, max: 120 },
    email: { min: 150, max: 350 },
  },
  blogWordTarget: { short: 400, medium: 800, long: 1400 } satisfies Record<Length, number>,
} as const;

export const CONTRACT_WARNING_CODES = [
  "meta_missing",
  "meta_title_too_long",
  "meta_description_too_long",
  "title_missing",
  "sections_out_of_range",
  "hashtags_too_many",
  "hashtags_out_of_range",
  "hashtags_not_last_line",
  "subject_missing",
  "preheader_missing",
  "posts_out_of_range",
  "post_too_long",
  "words_out_of_range",
] as const;

export type ContractWarning = {
  code: (typeof CONTRACT_WARNING_CODES)[number];
  /** Numbers interpolated into the translated message. */
  values: Record<string, number>;
};

export function isContractWarningCode(value: unknown): value is ContractWarning["code"] {
  return typeof value === "string" && (CONTRACT_WARNING_CODES as readonly string[]).includes(value);
}

const warn = (code: ContractWarning["code"], values: Record<string, number> = {}) => ({
  code,
  values,
});

/** Characters as a reader (and X) counts them: by code point, not UTF-16 unit. */
export function countChars(text: string): number {
  return Array.from(text).length;
}

export function countWords(text: string): number {
  // Markdown markers and bare punctuation are not words.
  return text.split(/\s+/).filter((token) => /[\p{L}\p{N}]/u.test(token)).length;
}

export function findHashtags(text: string): string[] {
  return text.match(/(?<![\p{L}\p{N}_])#[\p{L}\p{N}_]+/gu) ?? [];
}

export type ParsedBlog = {
  metaTitle: string | null;
  metaDescription: string | null;
  /** Everything after the front block. */
  body: string;
  title: string | null;
  sectionCount: number;
};

export function parseBlog(text: string): ParsedBlog {
  const front = /^\s*---[ \t]*\r?\n([\s\S]*?)\r?\n---[ \t]*(?:\r?\n|$)/.exec(text);
  const meta = front?.[1] ?? "";
  const body = front ? text.slice(front[0].length) : text;

  const field = (name: string) => {
    const match = new RegExp(`^${name}:[ \\t]*(.*)$`, "mi").exec(meta);
    const value = match?.[1]?.trim().replace(/^["']|["']$/g, "");
    return value ? value : null;
  };

  return {
    metaTitle: field("meta_title"),
    metaDescription: field("meta_description"),
    body,
    title: /^#[ \t]+(.+)$/m.exec(body)?.[1]?.trim() ?? null,
    sectionCount: body.match(/^##[ \t]+\S/gm)?.length ?? 0,
  };
}

export type ParsedEmail = { subject: string | null; preheader: string | null; body: string };

export function parseEmail(text: string): ParsedEmail {
  const subject = /^[ \t]*Subject:[ \t]*(.+)$/im.exec(text);
  const preheader = /^[ \t]*Preheader:[ \t]*(.+)$/im.exec(text);
  const body = text
    .replace(/^[ \t]*Subject:.*$/im, "")
    .replace(/^[ \t]*Preheader:.*$/im, "")
    .trim();
  return {
    subject: subject?.[1]?.trim() ?? null,
    preheader: preheader?.[1]?.trim() ?? null,
    body,
  };
}

export type XPost = {
  /** The number the post declares, e.g. 3 for "3/". */
  number: number;
  /** Full post text including its "3/" marker — that is what gets published. */
  text: string;
  chars: number;
};

/** Splits a thread into posts at lines that start with `1/`, `2/`, … */
export function parseXThread(text: string): XPost[] {
  const posts: XPost[] = [];
  let current: { number: number; lines: string[] } | null = null;

  const flush = () => {
    if (!current) return;
    const postText = current.lines.join("\n").trim();
    posts.push({ number: current.number, text: postText, chars: countChars(postText) });
  };

  for (const line of text.split(/\r?\n/)) {
    const marker = /^\s*(\d{1,2})\/(?:\d{1,2})?(?=\s|$)/.exec(line);
    if (marker) {
      flush();
      current = { number: Number(marker[1]), lines: [line.trim()] };
    } else if (current) {
      current.lines.push(line);
    }
  }
  flush();

  return posts;
}

export type ContentStats = {
  words: number;
  chars: number;
  /** X threads only. */
  posts?: XPost[];
};

/** The text a reader actually sees, i.e. without front matter or header lines. */
function readableBody(type: ContentType, text: string): string {
  if (type === "blog") return parseBlog(text).body;
  if (type === "email") return parseEmail(text).body;
  return text;
}

export function contentStats(type: ContentType, text: string): ContentStats {
  const body = readableBody(type, text);
  const stats: ContentStats = { words: countWords(body), chars: countChars(text.trim()) };
  if (type === "x_thread") stats.posts = parseXThread(text);
  return stats;
}

type ValidateOptions = {
  /**
   * Enables the blog word-target check. Omitted for sample output, whose
   * pre-written fixtures have one fixed length whatever the slider says.
   */
  length?: Length;
};

/** Checks finished output against its contract. Returns [] when it conforms. */
export function validateContent(
  type: ContentType,
  text: string,
  options: ValidateOptions = {},
): ContractWarning[] {
  const warnings: ContractWarning[] = [];
  const range = (actual: number, { min, max }: { min: number; max: number }) =>
    actual < min || actual > max;

  switch (type) {
    case "blog": {
      const blog = parseBlog(text);
      if (!blog.metaTitle || !blog.metaDescription) {
        warnings.push(warn("meta_missing"));
      }
      if (blog.metaTitle && countChars(blog.metaTitle) > LIMITS.metaTitle) {
        warnings.push(
          warn("meta_title_too_long", {
            actual: countChars(blog.metaTitle),
            max: LIMITS.metaTitle,
          }),
        );
      }
      if (blog.metaDescription && countChars(blog.metaDescription) > LIMITS.metaDescription) {
        warnings.push(
          warn("meta_description_too_long", {
            actual: countChars(blog.metaDescription),
            max: LIMITS.metaDescription,
          }),
        );
      }
      if (!blog.title) warnings.push(warn("title_missing"));
      if (range(blog.sectionCount, LIMITS.blogSections)) {
        warnings.push(
          warn("sections_out_of_range", { actual: blog.sectionCount, ...LIMITS.blogSections }),
        );
      }
      if (options.length) {
        const target = LIMITS.blogWordTarget[options.length];
        const bounds = { min: Math.round(target * 0.6), max: Math.round(target * 1.5) };
        const words = countWords(blog.body);
        if (range(words, bounds)) {
          warnings.push(warn("words_out_of_range", { actual: words, ...bounds }));
        }
      }
      break;
    }

    case "linkedin": {
      const tags = findHashtags(text).length;
      if (tags > LIMITS.linkedinHashtags) {
        warnings.push(warn("hashtags_too_many", { actual: tags, max: LIMITS.linkedinHashtags }));
      }
      const words = countWords(text);
      if (range(words, LIMITS.words.linkedin)) {
        warnings.push(warn("words_out_of_range", { actual: words, ...LIMITS.words.linkedin }));
      }
      break;
    }

    case "instagram": {
      const tags = findHashtags(text);
      if (range(tags.length, LIMITS.instagramHashtags)) {
        warnings.push(
          warn("hashtags_out_of_range", { actual: tags.length, ...LIMITS.instagramHashtags }),
        );
      }
      const lastLine = text.trim().split(/\r?\n/).at(-1) ?? "";
      if (tags.length > 0 && findHashtags(lastLine).length !== tags.length) {
        warnings.push(warn("hashtags_not_last_line"));
      }
      const words = countWords(text);
      if (range(words, LIMITS.words.instagram)) {
        warnings.push(warn("words_out_of_range", { actual: words, ...LIMITS.words.instagram }));
      }
      break;
    }

    case "email": {
      const email = parseEmail(text);
      if (!email.subject) warnings.push(warn("subject_missing"));
      if (!email.preheader) warnings.push(warn("preheader_missing"));
      const words = countWords(email.body);
      if (range(words, LIMITS.words.email)) {
        warnings.push(warn("words_out_of_range", { actual: words, ...LIMITS.words.email }));
      }
      break;
    }

    case "x_thread": {
      const posts = parseXThread(text);
      if (range(posts.length, LIMITS.xPosts)) {
        warnings.push(warn("posts_out_of_range", { actual: posts.length, ...LIMITS.xPosts }));
      }
      for (const post of posts) {
        if (post.chars > LIMITS.xPostChars) {
          warnings.push(
            warn("post_too_long", {
              post: post.number,
              actual: post.chars,
              max: LIMITS.xPostChars,
            }),
          );
        }
      }
      break;
    }
  }

  return warnings;
}

const TITLE_MAX = 200;

const clip = (value: string, max: number) => {
  const chars = Array.from(value.trim());
  return chars.length <= max
    ? chars.join("")
    : `${chars
        .slice(0, max - 1)
        .join("")
        .trimEnd()}…`;
};

/**
 * A library title for a piece: the blog's own title, the email's subject, or
 * the topic for formats that have no title of their own.
 */
export function deriveTitle(type: ContentType, text: string, topic: string): string {
  const own =
    type === "blog" ? parseBlog(text).title : type === "email" ? parseEmail(text).subject : null;
  return clip(own || topic || "Untitled", TITLE_MAX);
}
