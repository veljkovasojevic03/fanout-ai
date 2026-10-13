import { useTranslations } from "next-intl";
import Markdown, { type Components } from "react-markdown";
import remarkGfm from "remark-gfm";

import { INTL_LOCALE, type AppLocale } from "@/i18n/config";
import { countChars, LIMITS, parseBlog, parseEmail, parseXThread } from "@/lib/content/contracts";
import type { ContentType } from "@/lib/presets";
import { cn } from "@/lib/utils";

/*
 * Markdown is rendered by react-markdown, which builds React elements and never
 * injects HTML: raw HTML in the text is shown as text, and link URLs go through
 * its default sanitiser (no javascript: links). Two more choices on top:
 *  - links open in a new tab without handing over `window.opener` or a referrer;
 *  - images are not loaded — a preview must not make requests to addresses
 *    found in the text. The alt text is shown instead.
 */
const COMPONENTS: Components = {
  h1: ({ children }) => (
    <h1 className="mt-6 mb-3 text-2xl font-semibold tracking-tight first:mt-0">{children}</h1>
  ),
  h2: ({ children }) => (
    <h2 className="mt-6 mb-2.5 text-lg font-semibold tracking-tight first:mt-0">{children}</h2>
  ),
  h3: ({ children }) => (
    <h3 className="mt-5 mb-2 text-base font-semibold first:mt-0">{children}</h3>
  ),
  h4: ({ children }) => <h4 className="mt-4 mb-2 text-sm font-semibold first:mt-0">{children}</h4>,
  h5: ({ children }) => <h5 className="mt-4 mb-2 text-sm font-semibold first:mt-0">{children}</h5>,
  h6: ({ children }) => <h6 className="mt-4 mb-2 text-sm font-semibold first:mt-0">{children}</h6>,
  p: ({ children }) => <p className="my-3 first:mt-0 last:mb-0">{children}</p>,
  ul: ({ children }) => <ul className="my-3 flex list-disc flex-col gap-1 pl-5">{children}</ul>,
  ol: ({ children }) => <ol className="my-3 flex list-decimal flex-col gap-1 pl-5">{children}</ol>,
  li: ({ children }) => <li className="pl-1 marker:text-muted">{children}</li>,
  a: ({ children, href }) => (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer nofollow"
      className="rounded-sm text-accent underline underline-offset-4 hover:text-accent-hover"
    >
      {children}
    </a>
  ),
  blockquote: ({ children }) => (
    <blockquote className="my-3 border-l-2 border-border-strong pl-4 text-muted">
      {children}
    </blockquote>
  ),
  code: ({ children }) => (
    <code className="rounded-sm border border-border bg-white/[0.04] px-1 py-0.5 font-mono text-[0.9em]">
      {children}
    </code>
  ),
  pre: ({ children }) => (
    <pre className="my-3 overflow-x-auto rounded-md border border-border bg-background p-3 text-[13px] [&_code]:border-0 [&_code]:bg-transparent [&_code]:p-0">
      {children}
    </pre>
  ),
  hr: () => <hr className="my-5 border-border" />,
  img: ({ alt }) => (alt ? <span className="text-muted">[{alt}]</span> : null),
  table: ({ children }) => (
    <div className="my-3 overflow-x-auto">
      <table className="w-full border-collapse text-left text-[13px]">{children}</table>
    </div>
  ),
  th: ({ children }) => (
    <th className="border-b border-border-strong px-2 py-1.5 font-semibold">{children}</th>
  ),
  td: ({ children }) => <td className="border-b border-border px-2 py-1.5">{children}</td>,
};

function MarkdownBody({ text }: { text: string }) {
  return (
    <Markdown remarkPlugins={[remarkGfm]} components={COMPONENTS}>
      {text}
    </Markdown>
  );
}

function MetaField({ label, value, max }: { label: string; value: string; max?: number }) {
  const t = useTranslations("editor.meta");
  const count = countChars(value);
  const over = max !== undefined && count > max;
  return (
    <div className="flex flex-col gap-0.5">
      <dt className="flex items-baseline justify-between gap-3 text-[11px] tracking-wide text-muted uppercase">
        {label}
        {max !== undefined ? (
          <span className={cn("counter normal-case", over && "text-danger")}>
            {t("count", { count, max })}
          </span>
        ) : null}
      </dt>
      <dd className="text-sm font-medium break-words">{value}</dd>
    </div>
  );
}

type ContentPreviewProps = {
  type: ContentType;
  body: string;
  /** Language of the text, for `lang` (pronunciation, hyphenation). */
  language: AppLocale;
  className?: string;
};

/**
 * How a piece reads once published. Blog posts and email bodies are rendered
 * as Markdown, with their header fields (SEO meta, subject, preheader) shown
 * apart from the text. LinkedIn and Instagram pieces are plain text, shown with
 * their line breaks; an X thread is split into its posts, each with its count.
 */
export function ContentPreview({ type, body, language, className }: ContentPreviewProps) {
  const t = useTranslations("editor");

  if (body.trim() === "") {
    return <p className={cn("text-sm text-muted", className)}>{t("previewEmpty")}</p>;
  }

  let content: React.ReactNode;

  if (type === "blog") {
    const blog = parseBlog(body);
    content = (
      <>
        {blog.metaTitle || blog.metaDescription ? (
          <dl className="mb-5 flex flex-col gap-3 rounded-md border border-border bg-background p-3.5">
            {blog.metaTitle ? (
              <MetaField label={t("meta.seoTitle")} value={blog.metaTitle} max={LIMITS.metaTitle} />
            ) : null}
            {blog.metaDescription ? (
              <MetaField
                label={t("meta.seoDescription")}
                value={blog.metaDescription}
                max={LIMITS.metaDescription}
              />
            ) : null}
          </dl>
        ) : null}
        <MarkdownBody text={blog.body} />
      </>
    );
  } else if (type === "email") {
    const email = parseEmail(body);
    content = (
      <>
        {email.subject || email.preheader ? (
          <dl className="mb-5 flex flex-col gap-3 rounded-md border border-border bg-background p-3.5">
            {email.subject ? <MetaField label={t("meta.subject")} value={email.subject} /> : null}
            {email.preheader ? (
              <MetaField label={t("meta.preheader")} value={email.preheader} />
            ) : null}
          </dl>
        ) : null}
        <MarkdownBody text={email.body} />
      </>
    );
  } else if (type === "x_thread") {
    const posts = parseXThread(body);
    content =
      posts.length === 0 ? (
        <p className="break-words whitespace-pre-wrap">{body}</p>
      ) : (
        <ol className="flex flex-col gap-2.5">
          {posts.map((post, index) => {
            const over = post.chars > LIMITS.xPostChars;
            return (
              <li
                key={index}
                className="flex flex-col gap-2 rounded-md border border-border bg-background p-3.5"
              >
                <p className="break-words whitespace-pre-wrap">{post.text}</p>
                <p className={cn("counter text-[11px]", over ? "text-danger" : "text-muted")}>
                  <span className="sr-only">{t("meta.post", { number: post.number })}: </span>
                  {t("meta.count", { count: post.chars, max: LIMITS.xPostChars })}
                </p>
              </li>
            );
          })}
        </ol>
      );
  } else {
    content = <p className="break-words whitespace-pre-wrap">{body}</p>;
  }

  return (
    <div
      lang={INTL_LOCALE[language]}
      className={cn("text-sm leading-relaxed break-words", className)}
    >
      {content}
    </div>
  );
}
