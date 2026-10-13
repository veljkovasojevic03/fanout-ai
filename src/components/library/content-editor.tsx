"use client";

import {
  ArrowLeft,
  ChevronDown,
  CircleAlert,
  CircleCheck,
  Copy,
  Download,
  Languages,
  LoaderCircle,
  Maximize2,
  Minimize2,
  Palette,
  Trash2,
  TriangleAlert,
  Undo2,
} from "lucide-react";
import type { Route } from "next";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { useCallback, useMemo, useState, useTransition } from "react";

import { FormAlert } from "@/components/auth/form-parts";
import { PublishButton } from "@/components/publish/publish-dialog";
import { ContentTypeIcon } from "@/components/shell/content-type-icon";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Field } from "@/components/ui/field";
import { Input, Textarea } from "@/components/ui/input";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { toast } from "@/components/ui/toast";
import type { AppLocale } from "@/i18n/config";
import { contentStats, countChars, validateContent } from "@/lib/content/contracts";
import { toGenerateErrorCode } from "@/lib/generation/errors";
import type { StreamMeta } from "@/lib/generation/schema";
import {
  deleteContentAction,
  duplicateContentAction,
  updateContentAction,
} from "@/lib/library/actions";
import type { ExportFormat } from "@/lib/library/export";
import { CONTENT_LIMITS, type LibraryErrorCode } from "@/lib/library/schema";
import { TONES, type ContentType, type Tone } from "@/lib/presets";
import {
  REFINE_LIMITS,
  type RefineAction,
  type RefineRequest,
  type RefineScope,
} from "@/lib/refine/schema";
import { cn } from "@/lib/utils";

import { ContentPreview } from "./content-preview";
import { RefineSuggestion } from "./refine-suggestion";
import { TagInput } from "./tag-input";
import { useAutosave, type SaveOutcome, type SaveStatus } from "./use-autosave";

// Listed here rather than imported, so the docx builder stays out of the browser bundle.
const EXPORT_FORMATS: readonly ExportFormat[] = ["txt", "md", "docx"];

export type EditorContent = {
  id: string;
  type: ContentType;
  title: string;
  body: string;
  language: AppLocale;
  tags: string[];
};

type ContentEditorProps = {
  content: EditorContent;
  /** The user's existing tags, for autocomplete. */
  knownTags: readonly string[];
  /** Refinements left on the generation this piece came from; null = no such cap. */
  refinementsLeft: number | null;
  /** Guests can open the publish dialog, but only to be told to create an account. */
  guest?: boolean;
};

type Draft = Pick<EditorContent, "title" | "body" | "language" | "tags">;

type ActiveRefine = {
  key: number;
  request: RefineRequest;
  label: string;
  start: number;
  end: number;
};

/** What Accept replaced, so it can be put back. */
type UndoStep = Pick<Draft, "body" | "language">;

const MAX_UNDO = 20;

/**
 * The editor for one saved piece (spec §4.3, §4.4): Markdown with a live
 * preview (side by side on desktop, tabs on mobile), debounced autosave with a
 * visible state, tags, the refine actions, publish, export, duplicate and delete.
 */
export function ContentEditor({
  content,
  knownTags,
  refinementsLeft,
  guest = false,
}: ContentEditorProps) {
  const t = useTranslations();
  const router = useRouter();
  const { id, type } = content;

  const [title, setTitle] = useState(content.title);
  const [body, setBody] = useState(content.body);
  const [language, setLanguage] = useState(content.language);
  const [tags, setTags] = useState(content.tags);

  const [selection, setSelection] = useState({ start: 0, end: 0 });
  const [refine, setRefine] = useState<ActiveRefine | null>(null);
  const [left, setLeft] = useState(refinementsLeft);
  const [undoSteps, setUndoSteps] = useState<UndoStep[]>([]);

  const [view, setView] = useState("write");
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [working, startWork] = useTransition();
  const [exporting, setExporting] = useState(false);

  const draft = useMemo<Draft>(
    () => ({ title, body, language, tags }),
    [title, body, language, tags],
  );

  const save = useCallback(
    async (value: Draft): Promise<SaveOutcome<LibraryErrorCode>> => {
      // Caught here so an empty title never costs a request.
      if (value.title.trim() === "") return { ok: false, code: "title_required" };
      const result = await updateContentAction({ id, ...value });
      return result.ok ? { ok: true } : { ok: false, code: result.code };
    },
    [id],
  );

  const autosave = useAutosave({ value: draft, save, fallbackError: "save_failed" });

  const stats = useMemo(() => contentStats(type, body), [type, body]);
  const warnings = useMemo(
    () => (body.trim() === "" ? [] : validateContent(type, body)),
    [type, body],
  );

  const selected = body.slice(selection.start, selection.end);
  const hasSelection = /\S/.test(selected);
  const otherLanguage: AppLocale = language === "en" ? "sr" : "en";
  const refineBlocked = refine !== null || (left !== null && left <= 0);

  function startRefine(action: RefineAction, tone?: Tone) {
    const scope: RefineScope = hasSelection ? "selection" : "all";
    const start = scope === "selection" ? selection.start : 0;
    const end = scope === "selection" ? selection.end : body.length;
    const text = body.slice(start, end);

    if (!/\S/.test(text)) {
      toast.error(t("editor.refine.empty"));
      return;
    }
    if (text.length > REFINE_LIMITS.textMax) {
      toast.error(t("editor.refine.tooLong", { count: text.length, max: REFINE_LIMITS.textMax }));
      return;
    }

    const label =
      action === "tone"
        ? t("editor.refine.labels.tone", { tone: t(`common.tones.${tone ?? "professional"}`) })
        : action === "translate"
          ? t("editor.refine.labels.translate", {
              language: t(`common.languageTargets.${otherLanguage}`),
            })
          : t(`editor.refine.labels.${action}`);

    setRefine({
      key: Date.now(),
      label,
      start,
      end,
      request: {
        contentId: id,
        action,
        scope,
        text,
        language,
        tone: action === "tone" ? tone : undefined,
        targetLanguage: action === "translate" ? otherLanguage : undefined,
      },
    });
  }

  function undo() {
    const step = undoSteps.at(-1);
    if (!step) return;
    setUndoSteps((steps) => steps.slice(0, -1));
    setBody(step.body);
    setLanguage(step.language);
    toast.success(t("editor.actions.undone"));
  }

  function acceptRefine(suggestion: string) {
    if (!refine) return;
    const { start, end, request } = refine;
    // The editor is locked while a suggestion is open, so the range is still valid.
    const original = body.slice(start, end);
    const lead = request.scope === "selection" ? (/^\s*/.exec(original)?.[0] ?? "") : "";
    const trail = request.scope === "selection" ? (/\s*$/.exec(original)?.[0] ?? "") : "";
    const next = body.slice(0, start) + lead + suggestion.trim() + trail + body.slice(end);

    // Never cut the text to make it fit: refuse, and leave the suggestion open.
    if (next.length > CONTENT_LIMITS.bodyMax) {
      toast.error(t("editor.refine.resultTooLong", { max: CONTENT_LIMITS.bodyMax }));
      return;
    }

    setUndoSteps((steps) => [...steps.slice(-(MAX_UNDO - 1)), { body, language }]);
    setBody(next);
    // A translated piece is now in the other language; a translated passage is not.
    if (request.action === "translate" && request.scope === "all" && request.targetLanguage) {
      setLanguage(request.targetLanguage);
    }
    setSelection({ start: 0, end: 0 });
    setRefine(null);
    toast.success(t("editor.refine.accepted"));
  }

  const onRefineMeta = useCallback((meta: StreamMeta) => {
    if (meta.regenerationsLeft !== null) setLeft(meta.regenerationsLeft);
  }, []);

  async function exportAs(format: ExportFormat) {
    if (exporting) return;
    setExporting(true);
    try {
      // The file is built on the server from the saved version.
      if (!(await autosave.flush())) {
        toast.error(t("editor.actions.exportSaveFirst"));
        return;
      }
      const response = await fetch(`/api/contents/${id}/export?format=${format}`);
      if (!response.ok) {
        const payload: unknown = await response.json().catch(() => null);
        const code = (payload as { error?: { code?: unknown } } | null)?.error?.code;
        toast.error(t(`generate.errors.${toGenerateErrorCode(code, "server_error")}`));
        return;
      }
      const name = /filename="([^"]+)"/.exec(response.headers.get("Content-Disposition") ?? "");
      const url = URL.createObjectURL(await response.blob());
      const link = document.createElement("a");
      link.href = url;
      link.download = name?.[1] ?? `fanout-content.${format}`;
      document.body.append(link);
      link.click();
      link.remove();
      URL.revokeObjectURL(url);
      toast.success(t("editor.actions.exported"));
    } catch {
      toast.error(t("generate.errors.network_error"));
    } finally {
      setExporting(false);
    }
  }

  function duplicate() {
    startWork(async () => {
      // The copy is made from the saved version, so save first.
      if (!(await autosave.flush())) {
        toast.error(t(`editor.errors.${autosave.error ?? "save_failed"}`));
        return;
      }
      const result = await duplicateContentAction({
        id,
        suffix: t("editor.actions.copySuffix"),
      });
      if (!result.ok) {
        toast.error(t(`editor.errors.${result.code}`));
        return;
      }
      toast.success(t("editor.actions.duplicated"));
      router.push(`/app/library/${result.id}` as Route);
    });
  }

  function remove() {
    startWork(async () => {
      const result = await deleteContentAction({ id });
      if (!result.ok) {
        toast.error(t(`editor.errors.${result.code}`));
        return;
      }
      setConfirmDelete(false);
      toast.success(t("editor.actions.deleted"));
      router.replace("/app/library");
    });
  }

  const titleError =
    title.trim() === "" || countChars(title.trim()) > CONTENT_LIMITS.titleMax
      ? t("editor.errors.title_required")
      : undefined;

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-3">
        <Button asChild variant="ghost" size="sm" className="-ml-3">
          <Link href="/app/library">
            <ArrowLeft aria-hidden="true" />
            {t("editor.back")}
          </Link>
        </Button>

        <div className="flex flex-wrap items-center gap-2">
          <SaveIndicator status={autosave.status} onRetry={() => void autosave.flush()} />

          {/* What goes out is the saved version, so the dialog saves first. */}
          <PublishButton
            contentId={id}
            title={title.trim() || content.title}
            guest={guest}
            beforeSubmit={autosave.flush}
            variant="primary"
          />

          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="secondary" size="sm" loading={exporting}>
                {exporting ? null : <Download aria-hidden="true" />}
                {t("editor.actions.export")}
                <ChevronDown aria-hidden="true" className="size-3.5 text-muted" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent>
              {EXPORT_FORMATS.map((format) => (
                <DropdownMenuItem key={format} onSelect={() => void exportAs(format)}>
                  {t(`editor.actions.formats.${format}`)}
                </DropdownMenuItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>

          <Button variant="secondary" size="sm" onClick={duplicate} disabled={working}>
            <Copy aria-hidden="true" />
            {t("editor.actions.duplicate")}
          </Button>
          <Button variant="danger" size="sm" onClick={() => setConfirmDelete(true)}>
            <Trash2 aria-hidden="true" />
            {t("editor.actions.delete")}
          </Button>
        </div>
      </div>

      {/* Why the save failed. A missing title is explained on the title field instead. */}
      {autosave.error && autosave.error !== "title_required" ? (
        <FormAlert tone="error">{t(`editor.errors.${autosave.error}`)}</FormAlert>
      ) : null}

      <div className="flex flex-wrap items-center gap-x-3 gap-y-2 text-[13px] text-muted">
        <span className="flex items-center gap-2 text-foreground">
          <span className="flex size-7 items-center justify-center rounded-md border border-border bg-elevated text-muted">
            <ContentTypeIcon type={type} className="size-3.5" />
          </span>
          {t(`common.formats.${type}`)}
        </span>
        <Badge>{t(`common.languages.${language}`)}</Badge>
        <span className="counter text-xs">
          {type === "x_thread" && stats.posts ? (
            <>
              {t("generate.card.posts", { count: stats.posts.length })}
              {" · "}
            </>
          ) : null}
          {t("generate.card.words", { count: stats.words })}
          {" · "}
          {t("generate.card.chars", { count: stats.chars })}
        </span>
      </div>

      <div className="grid gap-5 md:grid-cols-2">
        <Field
          label={t("editor.titleLabel")}
          error={titleError}
          aside={`${countChars(title)}/${CONTENT_LIMITS.titleMax}`}
        >
          <Input
            value={title}
            onChange={(event) => setTitle(event.target.value)}
            placeholder={t("editor.titlePlaceholder")}
            maxLength={CONTENT_LIMITS.titleMax * 2}
          />
        </Field>
        <Field label={t("editor.tags.label")} hint={t("editor.tags.hint")}>
          <TagInput value={tags} onChange={setTags} suggestions={knownTags} />
        </Field>
      </div>

      <section
        aria-labelledby="refine-title"
        className="flex flex-col gap-3 rounded-xl border border-border bg-surface p-4"
      >
        <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1">
          <h2 id="refine-title" className="text-sm font-semibold">
            {t("editor.refine.title")}
          </h2>
          {left !== null ? (
            <p className="counter text-xs text-muted" aria-live="polite">
              {t("editor.refine.left", { left, max: REFINE_LIMITS.maxPerGeneration })}
            </p>
          ) : null}
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <Button
            variant="secondary"
            size="sm"
            disabled={refineBlocked}
            onClick={() => startRefine("shorten")}
          >
            <Minimize2 aria-hidden="true" />
            {t("editor.refine.shorten")}
          </Button>
          <Button
            variant="secondary"
            size="sm"
            disabled={refineBlocked}
            onClick={() => startRefine("expand")}
          >
            <Maximize2 aria-hidden="true" />
            {t("editor.refine.expand")}
          </Button>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="secondary" size="sm" disabled={refineBlocked}>
                <Palette aria-hidden="true" />
                {t("editor.refine.tone")}
                <ChevronDown aria-hidden="true" className="size-3.5 text-muted" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start">
              {TONES.map((tone) => (
                <DropdownMenuItem key={tone} onSelect={() => startRefine("tone", tone)}>
                  {t(`common.tones.${tone}`)}
                </DropdownMenuItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>
          <Button
            variant="secondary"
            size="sm"
            disabled={refineBlocked}
            onClick={() => startRefine("translate")}
          >
            <Languages aria-hidden="true" />
            {t("editor.refine.translate", {
              language: t(`common.languageTargets.${otherLanguage}`),
            })}
          </Button>
          <Button
            variant="ghost"
            size="sm"
            className="ml-auto"
            disabled={undoSteps.length === 0 || refine !== null}
            onClick={undo}
          >
            <Undo2 aria-hidden="true" />
            {t("editor.actions.undo")}
          </Button>
        </div>

        <p className="text-[13px] leading-snug text-muted" aria-live="polite">
          {refine
            ? t("editor.refine.locked")
            : left !== null && left <= 0
              ? t("generate.errors.refinement_cap_reached")
              : hasSelection
                ? t("editor.refine.scopeSelection", { count: countChars(selected) })
                : t("editor.refine.scopeAll")}
        </p>

        {refine ? (
          <RefineSuggestion
            key={refine.key}
            request={refine.request}
            label={refine.label}
            language={refine.request.targetLanguage ?? language}
            onAccept={acceptRefine}
            onDiscard={() => setRefine(null)}
            onMeta={onRefineMeta}
          />
        ) : null}
      </section>

      <Tabs value={view} onValueChange={setView}>
        <TabsList aria-label={t("editor.viewLabel")} className="lg:hidden">
          <TabsTrigger value="write">{t("editor.tabs.write")}</TabsTrigger>
          <TabsTrigger value="preview">{t("editor.tabs.preview")}</TabsTrigger>
        </TabsList>

        <div className="grid items-start gap-4 lg:grid-cols-2">
          <TabsContent
            value="write"
            forceMount
            className="data-[state=inactive]:hidden lg:data-[state=inactive]:block"
          >
            <Field
              label={t("editor.bodyLabel")}
              hint={t("editor.bodyHint")}
              aside={`${body.length}/${CONTENT_LIMITS.bodyMax}`}
            >
              <Textarea
                value={body}
                readOnly={refine !== null}
                maxLength={CONTENT_LIMITS.bodyMax}
                spellCheck
                onChange={(event) => setBody(event.target.value)}
                onSelect={(event) =>
                  setSelection({
                    start: event.currentTarget.selectionStart,
                    end: event.currentTarget.selectionEnd,
                  })
                }
                className={cn(
                  "min-h-[28rem] font-mono text-[13px] leading-relaxed lg:min-h-[36rem]",
                  refine !== null && "opacity-70",
                )}
              />
            </Field>
          </TabsContent>

          <TabsContent
            value="preview"
            forceMount
            className="data-[state=inactive]:hidden lg:data-[state=inactive]:block"
          >
            <section aria-labelledby="preview-title" className="flex flex-col gap-1.5">
              <h2 id="preview-title" className="text-[13px] leading-5 font-medium">
                {t("editor.previewLabel")}
              </h2>
              <div className="min-h-40 rounded-md border border-border bg-surface p-4 sm:p-5 lg:max-h-[36rem] lg:overflow-y-auto">
                <ContentPreview type={type} body={body} language={language} />
              </div>
            </section>
          </TabsContent>
        </div>
      </Tabs>

      {warnings.length > 0 ? (
        <div className="rounded-md border border-warn/25 bg-warn-soft px-3 py-2.5 text-[13px] leading-snug text-warn">
          <p className="mb-1 flex items-center gap-2 font-medium">
            <TriangleAlert aria-hidden="true" className="size-3.5 shrink-0" />
            {t("generate.warnings.title")}
          </p>
          <ul className="flex list-disc flex-col gap-0.5 pl-6">
            {warnings.map((warning, index) => (
              <li key={`${warning.code}-${index}`}>
                {t(`generate.warnings.${warning.code}`, warning.values)}
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      <Dialog open={confirmDelete} onOpenChange={setConfirmDelete}>
        <DialogContent closeLabel={t("common.close")}>
          <DialogHeader>
            <DialogTitle>{t("editor.deleteDialog.title")}</DialogTitle>
            <DialogDescription>
              {t("editor.deleteDialog.description", { title: title.trim() || content.title })}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <DialogClose asChild>
              <Button variant="secondary">{t("editor.deleteDialog.cancel")}</Button>
            </DialogClose>
            <Button variant="danger" onClick={remove} loading={working}>
              {t("editor.deleteDialog.confirm")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

type SaveIndicatorProps = {
  status: SaveStatus;
  onRetry?(): void;
};

/**
 * The autosave state, always visible: saved, unsaved, saving, or failed with a
 * retry. Deliberately not a live region — it changes on every pause in typing;
 * a failed save is announced by the alert the editor shows next to it.
 */
export function SaveIndicator({ status, onRetry }: SaveIndicatorProps) {
  const t = useTranslations("editor.save");
  const Icon = status === "saved" ? CircleCheck : status === "saving" ? LoaderCircle : CircleAlert;

  return (
    <div className="flex items-center gap-2">
      <p
        className={cn(
          "flex items-center gap-1.5 text-[13px]",
          status === "error" ? "text-danger" : status === "dirty" ? "text-warn" : "text-muted",
        )}
      >
        <Icon
          aria-hidden="true"
          className={cn("size-3.5", status === "saving" && "animate-spin")}
        />
        {t(status)}
      </p>
      {status === "error" && onRetry ? (
        <Button variant="link" size="sm" onClick={onRetry}>
          {t("retry")}
        </Button>
      ) : null}
    </div>
  );
}
