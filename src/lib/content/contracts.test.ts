import { describe, expect, it } from "vitest";

import {
  contentStats,
  countChars,
  countWords,
  deriveTitle,
  findHashtags,
  parseBlog,
  parseEmail,
  parseXThread,
  validateContent,
} from "./contracts";

const codes = (warnings: { code: string }[]) => warnings.map((warning) => warning.code);

describe("counting", () => {
  it("counts characters by code point, as X does", () => {
    expect(countChars("čćžšđ")).toBe(5);
    expect(countChars("🧵")).toBe(1);
    expect("🧵".length).toBe(2);
  });

  it("counts words, ignoring markdown markers and bare punctuation", () => {
    expect(countWords("## Hello — world!\n\n- one\n- two")).toBe(4);
    expect(countWords("   ")).toBe(0);
    expect(countWords("Zašto mali timovi isporučuju")).toBe(4);
  });

  it("finds hashtags but not anchors inside words or bare #", () => {
    expect(findHashtags("Go #fast and #čisto_2 now, issue#12, # alone")).toEqual([
      "#fast",
      "#čisto_2",
    ]);
  });
});

describe("blog", () => {
  const blog = (overrides: { title?: string; description?: string; sections?: number } = {}) => {
    const sections = Array.from(
      { length: overrides.sections ?? 3 },
      (_, i) => `## Section ${i + 1}\n\nText.`,
    ).join("\n\n");
    return `---
meta_title: ${overrides.title ?? "A fine title"}
meta_description: ${overrides.description ?? "A fine description."}
---

# The Post

Intro.

${sections}
`;
  };

  it("parses the front block, title and sections", () => {
    expect(parseBlog(blog())).toMatchObject({
      metaTitle: "A fine title",
      metaDescription: "A fine description.",
      title: "The Post",
      sectionCount: 3,
    });
  });

  it("accepts a conforming post", () => {
    expect(validateContent("blog", blog())).toEqual([]);
  });

  it("warns when SEO fields are too long, with the numbers", () => {
    const warnings = validateContent(
      "blog",
      blog({ title: "T".repeat(61), description: "D".repeat(156) }),
    );
    expect(warnings).toEqual([
      { code: "meta_title_too_long", values: { actual: 61, max: 60 } },
      { code: "meta_description_too_long", values: { actual: 156, max: 155 } },
    ]);
  });

  it("accepts SEO fields exactly at the limit", () => {
    expect(
      validateContent("blog", blog({ title: "T".repeat(60), description: "D".repeat(155) })),
    ).toEqual([]);
  });

  it("warns about a missing front block, title or section count", () => {
    expect(codes(validateContent("blog", "Just some text."))).toEqual([
      "meta_missing",
      "title_missing",
      "sections_out_of_range",
    ]);
    expect(codes(validateContent("blog", blog({ sections: 2 })))).toEqual([
      "sections_out_of_range",
    ]);
    expect(codes(validateContent("blog", blog({ sections: 7 })))).toEqual([
      "sections_out_of_range",
    ]);
  });

  it("checks the word target only when a length is given", () => {
    expect(validateContent("blog", blog())).toEqual([]);
    expect(codes(validateContent("blog", blog(), { length: "long" }))).toEqual([
      "words_out_of_range",
    ]);
  });

  it("does not count the front block as readable words", () => {
    expect(contentStats("blog", blog()).words).toBe(countWords(parseBlog(blog()).body));
  });
});

describe("linkedin and instagram", () => {
  const words = (count: number) => Array.from({ length: count }, () => "word").join(" ");

  it("limits LinkedIn to 5 hashtags and 120–220 words", () => {
    expect(validateContent("linkedin", `${words(150)}\n\n#a #b #c #d #e`)).toEqual([]);
    expect(codes(validateContent("linkedin", `${words(150)}\n\n#a #b #c #d #e #f`))).toEqual([
      "hashtags_too_many",
    ]);
    expect(codes(validateContent("linkedin", words(40)))).toEqual(["words_out_of_range"]);
  });

  it("requires 5–8 Instagram hashtags, all on the last line", () => {
    const caption = (tags: string, body = words(70)) => `${body}\n\n${tags}`;
    expect(validateContent("instagram", caption("#a #b #c #d #e"))).toEqual([]);
    expect(codes(validateContent("instagram", caption("#a #b #c #d")))).toEqual([
      "hashtags_out_of_range",
    ]);
    expect(codes(validateContent("instagram", `#early ${words(70)}\n\n#a #b #c #d #e`))).toEqual([
      "hashtags_not_last_line",
    ]);
  });
});

describe("email", () => {
  const body = Array.from({ length: 160 }, () => "word").join(" ");

  it("parses subject, preheader and body", () => {
    const email = parseEmail(`Subject: Hello there\nPreheader: Quick note\n\nHi,\n\n${body}`);
    expect(email.subject).toBe("Hello there");
    expect(email.preheader).toBe("Quick note");
    expect(email.body.startsWith("Hi,")).toBe(true);
  });

  it("warns when the header lines are missing", () => {
    expect(codes(validateContent("email", body))).toEqual(["subject_missing", "preheader_missing"]);
  });

  it("counts only the body towards the word range", () => {
    const text = `Subject: ${body}\nPreheader: x\n\nToo short.`;
    expect(codes(validateContent("email", text))).toEqual(["words_out_of_range"]);
  });
});

describe("x thread", () => {
  const thread = (posts: string[]) => posts.map((post, i) => `${i + 1}/ ${post}`).join("\n\n");

  it("splits posts at their numbered markers, including multi-line posts", () => {
    const posts = parseXThread("1/ Hook\nsecond line\n\n2/7 Middle\n\n3/ End");
    expect(posts.map((p) => p.number)).toEqual([1, 2, 3]);
    expect(posts[0]!.text).toBe("1/ Hook\nsecond line");
    expect(posts[1]!.text).toBe("2/7 Middle");
  });

  it("counts the marker as part of the post, because it is published", () => {
    const [post] = parseXThread("1/ Hello");
    expect(post!.chars).toBe(8);
  });

  it("accepts 5–9 posts of up to 280 characters", () => {
    expect(validateContent("x_thread", thread(Array(5).fill("Fine.")))).toEqual([]);
    expect(validateContent("x_thread", thread(Array(9).fill("Fine.")))).toEqual([]);
    expect(codes(validateContent("x_thread", thread(Array(4).fill("Fine."))))).toEqual([
      "posts_out_of_range",
    ]);
    expect(codes(validateContent("x_thread", thread(Array(10).fill("Fine."))))).toEqual([
      "posts_out_of_range",
    ]);
  });

  it("flags each post over 280 characters, naming the post", () => {
    const posts = Array(6).fill("Fine.");
    posts[2] = "x".repeat(278); // "3/ " + 278 = 281
    posts[4] = "y".repeat(277); // "5/ " + 277 = 280 — exactly at the limit
    expect(validateContent("x_thread", thread(posts))).toEqual([
      { code: "post_too_long", values: { post: 3, actual: 281, max: 280 } },
    ]);
  });

  it("reports per-post character counts while the thread is still streaming", () => {
    const stats = contentStats("x_thread", "1/ First post\n\n2/ Second po");
    expect(stats.posts?.map((p) => p.chars)).toEqual([13, 12]);
  });

  it("never truncates: an over-long post is reported, not shortened", () => {
    const long = `1/ ${"z".repeat(400)}`;
    expect(parseXThread(long)[0]!.text).toBe(long);
  });
});

describe("deriveTitle", () => {
  it("uses the blog's own title and the email's subject", () => {
    expect(deriveTitle("blog", "---\nmeta_title: m\n---\n# Real Title\n", "topic")).toBe(
      "Real Title",
    );
    expect(deriveTitle("email", "Subject: The Subject\n\nBody", "topic")).toBe("The Subject");
  });

  it("falls back to the topic, clipped to the library's 200-character limit", () => {
    expect(deriveTitle("linkedin", "Some post", "My topic")).toBe("My topic");
    expect(Array.from(deriveTitle("x_thread", "1/ x", "t".repeat(300)))).toHaveLength(200);
    expect(deriveTitle("blog", "no title here", "")).toBe("Untitled");
  });
});
