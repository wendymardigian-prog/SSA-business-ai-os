"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { createIdea } from "@/lib/actions/content";
import { ContentDialog, DialogField, fieldInput } from "./dialog";
import { ClassificationFields, type TaxonomyOptions } from "./classification-fields";
import { CONTENT_PLATFORMS } from "@/lib/content/network-format";

/**
 * Crear una idea, encima del tablero (C2).
 *
 * Un post nuevo ya no pasa por un modal: crea el borrador y abre su drawer
 * (`use-new-post.ts`), donde se escribe todo con el guardado automatico.
 *
 * Editar una idea tampoco pasa por aca: se edita en el drawer (F95), donde todo
 * es editable al abrir.
 */

// ── Nueva idea ────────────────────────────────────────────────────────────

const EMPTY_IDEA = {
  title: "",
  content: "",
  format: "",
  reference: "",
  platforms: [] as string[],
  pillarId: "",
  offerId: "",
  funnelStage: "",
};

export function IdeaDialog({
  canApprove,
  platforms,
  taxonomy,
  onClose,
}: {
  canApprove: boolean;
  /** Las redes conectadas, para elegir a cuales apunta (F91). */
  platforms: string[];
  taxonomy: TaxonomyOptions;
  onClose: () => void;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [values, setValues] = useState(EMPTY_IDEA);

  const set = (key: "title" | "content") => (v: string) =>
    setValues((prev) => ({ ...prev, [key]: v }));

  function save() {
    setError(null);
    start(async () => {
      const input = {
        title: values.title,
        content: values.content,
        format: values.format,
        reference: values.reference,
        platforms: values.platforms,
        pillar_id: values.pillarId || null,
        offer_id: values.offerId || null,
        funnel_stage: values.funnelStage || null,
      };
      const result = await createIdea(input);
      if (!result.ok) return setError(result.error);
      onClose();
      router.refresh();
    });
  }

  return (
    <ContentDialog
      label="Nueva idea"
      title="Nueva idea"
      onClose={onClose}
      footer={
        <>
          <span className="text-[11px] text-muted-foreground">
            {canApprove ? "Queda en la columna Ideas." : "Queda esperando aprobación."}
          </span>
          <span className="flex-1" />
          {error && (
            <span role="alert" className="text-xs text-red-700 dark:text-red-400">
              {error}
            </span>
          )}
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg border border-border px-3 py-1.5 text-sm hover:bg-accent"
          >
            Cancelar
          </button>
          <button
            type="button"
            onClick={save}
            disabled={pending || !values.title.trim()}
            className="rounded-lg bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground disabled:opacity-50"
          >
            Guardar idea
          </button>
        </>
      }
    >
      <DialogField label="Título *" hint="Con una frase alcanza.">
        <input
          value={values.title}
          onChange={(e) => set("title")(e.target.value)}
          maxLength={200}
          className={fieldInput}
        />
      </DialogField>

      <DialogField
        label="Idea"
        hint="Todo junto: con qué arranca, desde dónde se cuenta, notas. Escribilo como te salga."
      >
        <textarea
          rows={6}
          value={values.content}
          onChange={(e) => set("content")(e.target.value)}
          className={fieldInput}
        />
      </DialogField>

      <ClassificationFields
        value={{
          format: values.format,
          pillarId: values.pillarId,
          offerId: values.offerId,
          funnelStage: values.funnelStage,
          reference: values.reference,
        }}
        onChange={(patch) =>
          setValues((prev) => ({
            ...prev,
            ...(patch.format !== undefined ? { format: patch.format } : {}),
            ...(patch.pillarId !== undefined ? { pillarId: patch.pillarId } : {}),
            ...(patch.offerId !== undefined ? { offerId: patch.offerId } : {}),
            ...(patch.funnelStage !== undefined ? { funnelStage: patch.funnelStage } : {}),
            ...(patch.reference !== undefined ? { reference: patch.reference } : {}),
          }))
        }
        taxonomy={taxonomy}
        platforms={{
          available: CONTENT_PLATFORMS,
          manual: CONTENT_PLATFORMS.filter((p) => !platforms.includes(p)),
          selected: values.platforms,
          onChange: (next) => setValues((prev) => ({ ...prev, platforms: next })),
        }}
      />
    </ContentDialog>
  );
}
