"use client";

import type { ReactNode } from "react";
import { Check } from "lucide-react";
import { previewEnding } from "@/lib/forms/preview-view";
import { conditionChip, emptyShortcuts, mappingChip } from "@/lib/forms/canvas-view";
import type { ContactConfig, CustomFieldDef } from "@/lib/forms/contact-config";
import type { FormDesign } from "@/lib/forms/defaults";
import { MAX_FIELDS, type FormField, type FormFieldType, type FormType } from "@/lib/forms/fields";
import type { BuilderSelection } from "@/lib/forms/builder-selection";
import type { PublishIssues } from "@/lib/forms/publish-issues";
import type { SuccessConfig } from "@/lib/forms/success";
import { metricLabel } from "@/lib/eod/metrics";
import { cn } from "@/lib/utils";
import { AddQuestionPicker } from "./add-question-picker";
import { QuestionCard, type CardActions } from "./question-card";

/**
 * El lienzo (plano formularios-ui, F9): el formulario como lo ve quien responde, pero con las preguntas editables en
 * el lugar. Solo dibuja: las acciones y el estado los pone `useBuilderActions` desde quien lo usa.
 *
 * `mode="eod"`: un reporte de fin de dia no tiene titulo, boton ni pantalla final propios, ni contacto ni
 * condiciones; es solo la lista de preguntas.
 */
export function FormCanvas({
  mode,
  formType,
  fields,
  selection,
  onSelect,
  actions,
  dropAt,
  onAdd,
  disabled,
  design,
  onDesign,
  success,
  formName,
  contactConfig,
  customFields,
  issues,
  addLabel,
  emptyText,
  beforeFields,
  afterFields,
}: {
  mode: "form" | "eod";
  formType: FormType;
  fields: FormField[];
  selection: BuilderSelection;
  onSelect: (selection: BuilderSelection) => void;
  actions: CardActions;
  dropAt: { id: string; position: "before" | "after" } | null;
  onAdd: (type: FormFieldType) => void;
  disabled: boolean;
  design?: FormDesign;
  onDesign?: (next: FormDesign) => void;
  success?: SuccessConfig;
  formName?: string;
  contactConfig?: ContactConfig;
  customFields?: CustomFieldDef[];
  issues?: PublishIssues;
  addLabel?: string;
  emptyText?: string;
  /** Lo que va entre el título y las preguntas (en un contrato, el texto). */
  beforeFields?: ReactNode;
  /** Lo que va entre las preguntas y el botón de enviar (en un contrato, la aceptación y la firma). */
  afterFields?: ReactNode;
}) {
  const isForm = mode === "form";
  const atLimit = fields.length >= MAX_FIELDS;
  const ending = isForm && success ? previewEnding(success, { formName: formName ?? "", answers: {} }) : null;
  const submitText = design?.submitLabel || (formType === "contract" ? "Firmar y enviar" : "Enviar");

  return (
    <div className="mx-auto w-full max-w-[720px] space-y-2">
      {isForm && <p className="px-1 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">El formulario · así lo ve quien responde: escribí directo sobre él</p>}
      <div className="space-y-3 rounded-2xl border border-border bg-background p-4 shadow-sm sm:p-6">
        {isForm && design && onDesign && (
          <div
            onClick={() => onSelect({ kind: "form" })}
            className={cn("space-y-1 rounded-xl border border-transparent p-2", selection.kind === "form" && "border-primary ring-1 ring-primary")}
          >
            <input
              aria-label="Título del formulario"
              value={design.title}
              disabled={disabled}
              maxLength={200}
              placeholder="Título del formulario"
              onFocus={() => onSelect({ kind: "form" })}
              onChange={(e) => onDesign({ ...design, title: e.target.value })}
              className="w-full rounded border border-transparent bg-transparent px-1 text-2xl font-bold hover:border-border focus:border-ring focus:outline-none disabled:opacity-100"
            />
            <textarea
              aria-label="Introducción"
              rows={design.intro ? Math.min(4, design.intro.split("\n").length + 1) : 1}
              value={design.intro}
              disabled={disabled}
              maxLength={2000}
              placeholder="Una introducción (opcional)"
              onFocus={() => onSelect({ kind: "form" })}
              onChange={(e) => onDesign({ ...design, intro: e.target.value })}
              className="w-full resize-none rounded border border-transparent bg-transparent px-1 text-sm text-muted-foreground hover:border-border focus:border-ring focus:outline-none disabled:opacity-100"
            />
          </div>
        )}

        {beforeFields}

        {fields.length === 0 ? (
          <div className="space-y-3 rounded-xl border border-dashed border-border p-4 text-center">
            <p className="text-sm text-muted-foreground">{emptyText ?? "Todavía no hay preguntas. Empezá por una de las más comunes:"}</p>
            {!disabled && (
              <div className="flex flex-wrap justify-center gap-1.5">
                {emptyShortcuts(formType).map((s) => (
                  <button key={s.type} type="button" disabled={atLimit} onClick={() => onAdd(s.type)} className="rounded-full border border-border px-3 py-1 text-xs hover:border-primary hover:bg-accent">
                    {s.label}
                  </button>
                ))}
              </div>
            )}
          </div>
        ) : (
          <ul aria-label="Preguntas del formulario" className="space-y-3">
            {fields.map((field, index) => (
              <QuestionCard
                key={field.id}
                field={field}
                index={index}
                count={fields.length}
                selected={selection.kind === "field" && selection.id === field.id}
                disabled={disabled}
                conditionChip={isForm ? conditionChip(field, fields) : null}
                mappingChip={isForm && contactConfig ? mappingChip(field, contactConfig, customFields ?? []) : null}
                extraChip={!isForm && field.metricKey ? `Mide: ${metricLabel(field.metricKey)}` : null}
                problems={issues?.byField[field.key]?.join("\n") ?? ""}
                dropIndicator={dropAt?.id === field.id ? dropAt.position : null}
                actions={actions}
              />
            ))}
          </ul>
        )}

        {!disabled && <AddQuestionPicker formType={formType} onPick={onAdd} disabled={atLimit} label={addLabel} />}
        {atLimit && <p className="text-center text-xs text-muted-foreground">Llegaste al máximo de {MAX_FIELDS} preguntas.</p>}

        {afterFields}

        {isForm && design && onDesign && (
          <div className="pt-1">
            <div className="inline-flex items-center rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground">
              <input
                aria-label="Texto del botón de enviar"
                value={design.submitLabel}
                disabled={disabled}
                maxLength={60}
                placeholder={submitText}
                size={Math.max(8, (design.submitLabel || submitText).length)}
                onFocus={() => onSelect({ kind: "form" })}
                onChange={(e) => onDesign({ ...design, submitLabel: e.target.value })}
                className="bg-transparent text-center placeholder:text-primary-foreground focus:outline-none disabled:opacity-100"
              />
            </div>
          </div>
        )}
      </div>

      {isForm && ending && (
        <>
          <p className="px-1 pt-3 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">Después de enviar · lo que ve la persona cuando termina</p>
          <button
            type="button"
            onClick={() => onSelect({ kind: "end" })}
            className={cn("w-full rounded-2xl border bg-background p-5 text-left shadow-sm transition-colors", selection.kind === "end" ? "border-primary ring-1 ring-primary" : "border-border hover:border-primary/40")}
          >
            <span className="flex items-start gap-3">
              <span className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-emerald-100 text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-300">
                <Check className="h-4 w-4" aria-hidden />
              </span>
              <span className="min-w-0">
                {ending.title && <span className="block text-base font-semibold">{ending.title}</span>}
                <span className="block whitespace-pre-line text-sm text-muted-foreground">{ending.body}</span>
              </span>
            </span>
          </button>
        </>
      )}
    </div>
  );
}
