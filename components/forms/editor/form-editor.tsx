"use client";

import { useCallback, useEffect, useMemo, useRef, useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { BarChart3, ExternalLink, Inbox, Loader2 } from "lucide-react";
import { PageHeader } from "@/components/page-header";
import { BackLink } from "@/components/forms/back-link";
import { Notice } from "@/components/agents/fields";
import { Tabs } from "@/components/ui/tabs";
import { publishForm, saveFormDraft } from "@/lib/actions/forms/forms";
import { FORM_STATUS_LABELS, FORM_TYPE_LABELS } from "@/lib/forms/fields";
import { checkPublishable, hasUnpublishedChanges } from "@/lib/forms/publish";
import { typeChecks } from "@/lib/forms/type-checks";
import { fingerprint } from "@/lib/unsaved-changes";
import { cn } from "@/lib/utils";
import { FieldsTab } from "./fields-tab";
import { PublishTab } from "./publish-tab";
import type { Draft, EditorForm, EditorVersion } from "./types";

/**
 * El editor de un formulario (F4, F8). Carcasa: encabezado con el nombre, el
 * estado y "Publicar"; las pestañas; y el guardado automático del borrador.
 *
 * El borrador se guarda solo (a los 0,8 s de dejar de escribir). Si alguien más
 * cambió el formulario mientras tanto, el guardado se frena y se avisa: nunca se
 * pisa lo de otra persona sin que lo sepa.
 */

type Section = "campos" | "publicar";
type SaveState = "saved" | "pending" | "saving" | "error" | "conflict";

const SAVE_LABEL: Record<SaveState, string> = {
  saved: "Guardado",
  pending: "Cambios sin guardar…",
  saving: "Guardando…",
  error: "No se pudo guardar",
  conflict: "Alguien más cambió este formulario",
};

export function FormEditor({
  form,
  versions,
  canManage,
  turnstileConfigured,
  appUrl,
  timeZone,
}: {
  form: EditorForm;
  versions: EditorVersion[];
  canManage: boolean;
  turnstileConfigured: boolean;
  appUrl: string;
  timeZone: string;
}) {
  const router = useRouter();
  const [section, setSection] = useState<Section>("campos");
  const [draft, setDraft] = useState<Draft>({ name: form.name, definition: form.draftDefinition, design: form.design, success: form.success });
  const [slug, setSlug] = useState(form.slug);
  const [status, setStatus] = useState(form.status);
  const [snapshot, setSnapshot] = useState(form.publishedSnapshot);
  const [saveState, setSaveState] = useState<SaveState>("saved");
  const [saveError, setSaveError] = useState<string | null>(null);
  const [publishMessage, setPublishMessage] = useState<{ tone: "success" | "error"; text: string; reasons?: string[] } | null>(null);
  const [publishing, startPublishing] = useTransition();

  const updatedAt = useRef(form.updatedAt);
  const [savedFp, setSavedFp] = useState(() => fingerprint({ name: form.name, definition: form.draftDefinition, design: form.design, success: form.success }));
  const fp = useMemo(() => fingerprint(draft), [draft]);
  const dirty = fp !== savedFp;
  const inFlight = useRef(false);

  const disabled = !canManage || status === "archived";
  const neverPublished = snapshot === null;

  const save = useCallback(
    async (target: Draft, targetFp: string): Promise<boolean> => {
      if (inFlight.current) return false;
      inFlight.current = true;
      setSaveState("saving");
      setSaveError(null);
      try {
        const result = await saveFormDraft({
          formId: form.id,
          name: target.name,
          definition: target.definition,
          design: target.design,
          success: target.success,
          expectedUpdatedAt: updatedAt.current,
        });
        if (result.ok) {
          updatedAt.current = result.updatedAt;
          setSavedFp(targetFp);
          setSaveState("saved");
          return true;
        }
        setSaveError(result.error);
        setSaveState(result.conflict ? "conflict" : "error");
        return false;
      } catch {
        setSaveError("No se pudo guardar. Reintentá.");
        setSaveState("error");
        return false;
      } finally {
        inFlight.current = false;
      }
    },
    [form.id],
  );

  // Guardado automático: a los 0,8 s de la última edición. Con un conflicto no se
  // guarda nada hasta que la persona recargue.
  const conflict = saveState === "conflict";
  useEffect(() => {
    if (disabled || !dirty || conflict) return;
    setSaveState((s) => (s === "saving" ? s : "pending"));
    const timer = window.setTimeout(() => void save(draft, fp), 800);
    return () => window.clearTimeout(timer);
  }, [fp, dirty, disabled, conflict, draft, save]);

  // Avisar antes de cerrar la pestaña con cambios sin guardar.
  useEffect(() => {
    if (!dirty || disabled) return;
    const warn = (event: BeforeUnloadEvent) => event.preventDefault();
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [dirty, disabled]);

  const check = useMemo(
    () =>
      checkPublishable({
        type: form.type,
        slug,
        definition: draft.definition,
        turnstileConfigured,
        extraChecks: typeChecks(form.type, { surveyConfig: null, contractConfig: null }),
      }),
    [form.type, slug, draft.definition, turnstileConfigured],
  );
  const unpublished = hasUnpublishedChanges(draft.definition, snapshot);
  const reasons = check.ok ? [] : check.reasons;
  const publishBlocked = disabled || reasons.length > 0 || publishing || saveState === "conflict";

  function publish() {
    setPublishMessage(null);
    startPublishing(async () => {
      // Lo último que se escribió tiene que estar guardado ANTES de publicar.
      if (dirty) {
        const saved = await save(draft, fp);
        if (!saved) {
          setPublishMessage({ tone: "error", text: "No pudimos guardar los últimos cambios. Probá de nuevo." });
          return;
        }
      }
      const result = await publishForm(form.id);
      if (result.ok) {
        setStatus("published");
        setSnapshot(draft.definition);
        setPublishMessage({
          tone: "success",
          text: result.changed ? `Publicado: versión ${result.versionNumber}` : "Ya estaba al día: no hay cambios para publicar.",
        });
        router.refresh();
      } else {
        setPublishMessage({ tone: "error", text: result.error, reasons: result.reasons });
      }
    });
  }

  return (
    <div className="flex h-full min-h-0 flex-col">
      <PageHeader
        title={draft.name || "Formulario"}
        tooltip="Los campos, cómo se publica y qué pasa con cada respuesta."
        backHref={<BackLink href="/dashboard/formularios" label="Volver a Formularios" />}
        right={
          <div className="flex shrink-0 items-center gap-2">
            <a
              href={`/f/${slug}?preview=1`}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex h-9 items-center gap-1.5 rounded-lg border border-border px-2.5 text-sm hover:bg-accent"
            >
              <ExternalLink className="h-4 w-4" aria-hidden />
              <span className="hidden sm:inline">Vista previa</span>
            </a>
            {canManage && (
              <button
                type="button"
                onClick={publish}
                disabled={publishBlocked}
                title={reasons[0]}
                className="inline-flex h-9 items-center gap-1.5 rounded-lg bg-primary px-3 text-sm font-medium text-primary-foreground hover:opacity-90 disabled:opacity-50"
              >
                {publishing && <Loader2 className="h-4 w-4 animate-spin" aria-hidden />}
                {status === "published" && !unpublished ? "Publicado" : "Publicar"}
              </button>
            )}
          </div>
        }
      />

      <div className="min-h-0 flex-1 overflow-auto p-4 sm:p-6">
        <div className="mb-4 flex flex-wrap items-center gap-3">
          <label className="sr-only" htmlFor="form-name-input">
            Nombre del formulario
          </label>
          <input
            id="form-name-input"
            value={draft.name}
            disabled={disabled}
            maxLength={120}
            onChange={(e) => setDraft({ ...draft, name: e.target.value })}
            className="min-w-[12rem] flex-1 rounded-lg border border-transparent bg-transparent px-2 py-1 text-lg font-semibold hover:border-input focus:border-input focus:outline-none focus:ring-2 focus:ring-ring"
          />
          <span className="rounded-full border border-border px-2 py-0.5 text-[11px] text-muted-foreground">{FORM_TYPE_LABELS[form.type]}</span>
          <span className="rounded-full border border-border px-2 py-0.5 text-[11px]">{FORM_STATUS_LABELS[status]}</span>
          {status === "published" && unpublished && <span className="rounded-full bg-amber-100 px-2 py-0.5 text-[11px] text-amber-800 dark:bg-amber-500/20 dark:text-amber-200">Hay cambios sin publicar</span>}
          {!disabled && (
            <span role="status" aria-live="polite" className={cn("text-xs", saveState === "error" || saveState === "conflict" ? "text-destructive" : "text-muted-foreground")}>
              {SAVE_LABEL[saveState]}
              {(saveState === "error" || saveState === "conflict") && (
                <button
                  type="button"
                  className="ml-2 underline"
                  onClick={() => (saveState === "conflict" ? router.refresh() : void save(draft, fp))}
                >
                  {saveState === "conflict" ? "Recargar" : "Reintentar"}
                </button>
              )}
            </span>
          )}
          <span className="ml-auto flex items-center gap-2">
            <Link href={`/dashboard/formularios/${form.id}/respuestas`} className="inline-flex items-center gap-1.5 rounded-lg border border-border px-2.5 py-1.5 text-xs hover:bg-accent">
              <Inbox className="h-3.5 w-3.5" aria-hidden /> Respuestas
            </Link>
            <Link href={`/dashboard/formularios/${form.id}/metricas`} className="inline-flex items-center gap-1.5 rounded-lg border border-border px-2.5 py-1.5 text-xs hover:bg-accent">
              <BarChart3 className="h-3.5 w-3.5" aria-hidden /> Métricas
            </Link>
          </span>
        </div>

        {!canManage && <div className="mb-4"><Notice tone="info">Podés ver este formulario, pero solo quien administra formularios puede editarlo.</Notice></div>}
        {status === "archived" && <div className="mb-4"><Notice tone="warning">Este formulario está archivado. Restauralo desde la lista para editarlo.</Notice></div>}
        {saveError && <div className="mb-4"><Notice tone="error">{saveError}</Notice></div>}
        {publishMessage && (
          <div className="mb-4" role="status">
            <Notice tone={publishMessage.tone}>
              {publishMessage.text}
              {publishMessage.reasons && publishMessage.reasons.length > 1 && (
                <ul className="mt-1 list-inside list-disc">
                  {publishMessage.reasons.slice(0, 6).map((r) => (
                    <li key={r}>{r}</li>
                  ))}
                </ul>
              )}
            </Notice>
          </div>
        )}
        {canManage && reasons.length > 0 && section === "publicar" && (
          <div className="mb-4">
            <Notice tone="warning">
              Para publicar falta:
              <ul className="mt-1 list-inside list-disc">
                {reasons.slice(0, 6).map((r) => (
                  <li key={r}>{r}</li>
                ))}
              </ul>
            </Notice>
          </div>
        )}

        <Tabs
          label="Secciones del formulario"
          value={section}
          onChange={setSection}
          tabs={[
            { value: "campos", label: "Campos" },
            { value: "publicar", label: "Publicar" },
          ]}
        >
          <div className="pt-4">
            {section === "campos" ? (
              <FieldsTab draft={draft} onChange={setDraft} disabled={disabled} neverPublished={neverPublished} slug={slug} type={form.type} />
            ) : (
              <PublishTab
                form={{ ...form, slug, status }}
                versions={versions}
                canManage={canManage}
                turnstileConfigured={turnstileConfigured}
                appUrl={appUrl}
                published={status === "published"}
                onSlugChanged={setSlug}
                timeZone={timeZone}
              />
            )}
          </div>
        </Tabs>
      </div>
    </div>
  );
}
