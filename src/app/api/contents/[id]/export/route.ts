import { z } from "zod";

import {
  generationError,
  getRequestUser,
  retryAfter,
  withinRateLimit,
} from "@/lib/generation/server";
import {
  buildDocx,
  buildMarkdown,
  buildPlainText,
  EXPORT_FORMATS,
  EXPORT_MIME,
  exportFilename,
  type ExportInput,
} from "@/lib/library/export";
import { getContent } from "@/lib/library/queries";
import { log } from "@/lib/log";
import { isSupabaseConfigured } from "@/lib/supabase/env";

export const dynamic = "force-dynamic";

const querySchema = z.object({ format: z.enum(EXPORT_FORMATS) });

/**
 * GET /api/contents/[id]/export?format=txt|md|docx — downloads one saved piece.
 *
 * The piece is read as the signed-in user, so RLS is the ownership check:
 * another user's id is a 404, exactly like an id that does not exist. The file
 * is built on the server, which keeps the docx library out of the browser bundle.
 */
export async function GET(request: Request, context: RouteContext<"/api/contents/[id]/export">) {
  if (!isSupabaseConfigured()) return generationError("not_configured");

  const user = await getRequestUser();
  if (!user) return generationError("unauthenticated");

  const { id } = await context.params;
  const query = querySchema.safeParse({ format: new URL(request.url).searchParams.get("format") });
  if (!query.success) return generationError("invalid_input");
  const { format } = query.data;

  if (!(await withinRateLimit("export", user.id))) {
    return generationError("rate_limited", retryAfter("export"));
  }

  const found = await getContent(id);
  if (found.status === "not_found") return generationError("not_found");
  if (found.status === "error") return generationError("server_error");

  const { content } = found;
  const input: ExportInput = {
    type: content.type,
    title: content.title,
    body: content.body_md,
    language: content.language,
  };

  try {
    const body =
      format === "docx"
        ? await buildDocx(input)
        : format === "md"
          ? buildMarkdown(input)
          : buildPlainText(input);

    return new Response(body, {
      status: 200,
      headers: {
        "Content-Type": EXPORT_MIME[format],
        // exportFilename() returns [a-z0-9-.] only, so it is safe inside the quotes.
        "Content-Disposition": `attachment; filename="${exportFilename(content.title, format)}"`,
        "Cache-Control": "private, no-store",
        "X-Content-Type-Options": "nosniff",
      },
    });
  } catch (error) {
    log.error("library.export_failed", {
      format,
      name: error instanceof Error ? error.name : "unknown",
    });
    return generationError("server_error");
  }
}
