"use client";

import { useState } from "react";
import { ArrowDown, ArrowUp, Eye, GitBranch, Trash2 } from "lucide-react";
import { Sheet } from "@/components/ui/sheet";
import { FieldEditor } from "@/components/forms/builder/field-editor";
import { FIELD_ICONS } from "@/components/forms/builder/field-icons";
import { FieldTypePicker } from "@/components/forms/builder/field-type-picker";
import { PublicForm } from "@/components/forms/public/public-form";
import { addField, moveField, relabelField, removeField, setFieldKey, updateField } from "@/lib/forms/builder";
import { validateDefinition } from "@/lib/forms/definition-schema";
import { FIELD_TYPE_LABELS, MAX_FIELDS, type FormDefinition, type FormField } from "@/lib/forms/fields";
import { toPublicFields } from "@/lib/forms/public-definition";
import type { PublicFormData } from "@/lib/forms/public-client";
import { cn } from "@/lib/utils";
import { DesignCards } from "./design-cards";
import { fieldContactLine, type ContactConfig, type CustomFieldDef } from "@/lib/forms/contact-config";
import type { Draft } from "./types";

/**
 * La pestaña Campos (F4): la lista a la izquierda, el panel del campo al medio
 * y la vista previa en vivo a la derecha, con el MISMO componente de la página
 * pública. Aspecto de `CustomFormBuilderPage.tsx` de prevxcrm.
 */
export function FieldsTab({
  draft,
  onChange,
  disabled,
  neverPublished,
  slug,
  type,
  contract,
  contactConfig,
  customFields,
  onOpenContact,
}: {
  draft: Draft;
  onChange: (next: Draft) => void;
  disabled: boolean;
  neverPublished: boolean;
  slug: string;
  type: "custom" | "survey" | "contract";
  /** Solo un contrato: lo que la vista previa necesita para mostrar el texto y la firma. */
  contract?: { title: string; acceptLabel: string; signatureRequired: boolean } | null;
  /** El mapeo al contacto, para decirle a cada campo adónde va (R4). */
  contactConfig: ContactConfig;
  customFields: CustomFieldDef[];
  onOpenContact: () => void;
}) {
  const fields = draft.definition.fields;
  const [selected, setSelected] = useState<number>(fields.length > 0 ? 0 : -1);
  const [previewOpen, setPreviewOpen] = useState(false);
  const current = fields[selected];

  function setFields(next: FormField[], nextSelected?: number) {
    const definition: FormDefinition = { ...draft.definition, fields: next };
    onChange({ ...draft, definition });
    if (nextSelected !== undefined) setSelected(nextSelected);
  }

  const problems = (() => {
    const result = validateDefinition(draft.definition);
    return result.ok ? [] : result.errors;
  })();

  const previewData: PublicFormData = {
    status: "available",
    slug,
    type,
    version_id: "preview",
    design: draft.design,
    fields: toPublicFields(fields),
    contract: type === "contract" && contract ? { text: draft.definition.contractText ?? "", version_number: 0, title: contract.title, accept_label: contract.acceptLabel } : null,
    signature_required: type === "contract" ? (contract?.signatureRequired ?? true) : false,
    survey: null,
  };

  const preview = (
    <div className="rounded-xl border border-border bg-background p-4">
      <PublicForm form={previewData} params={{}} mode="public_page" preview />
    </div>
  );

  return (
    <div className="space-y-6">
      <div className="grid gap-4 lg:grid-cols-[260px_minmax(0,1fr)] xl:grid-cols-[260px_minmax(0,1fr)_minmax(0,420px)]">
        {/* Lista */}
        <section aria-label="Campos del formulario" className="space-y-3">
          {!disabled && <FieldTypePicker disabled={fields.length >= MAX_FIELDS} onPick={(t) => setFields(addField(fields, t), fields.length)} />}
          {fields.length === 0 ? (
            <p className="rounded-lg border border-dashed border-border p-4 text-sm text-muted-foreground">Todavía no hay campos. Agregá el primero.</p>
          ) : (
            <ul className="space-y-1.5">
              {fields.map((field, index) => {
                const Icon = FIELD_ICONS[field.type];
                const active = index === selected;
                return (
                  <li key={field.id} className={cn("flex items-center gap-1 rounded-lg border px-2 py-1.5", active ? "border-primary bg-primary/5" : "border-border")}>
                    <button type="button" onClick={() => setSelected(index)} aria-current={active} className="flex min-w-0 flex-1 items-center gap-2 text-left text-sm focus:outline-none focus-visible:underline">
                      <Icon className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden />
                      <span className="min-w-0 flex-1">
                        <span className="block truncate font-medium">{field.label || FIELD_TYPE_LABELS[field.type]}</span>
                        <span className="flex flex-wrap gap-1">
                          {field.required && <span className="text-[10px] text-muted-foreground">Obligatorio</span>}
                          {field.type === "hidden" && <span className="text-[10px] text-muted-foreground">Oculto</span>}
                          {field.visibility && (
                            <span className="inline-flex items-center gap-0.5 text-[10px] text-amber-600">
                              <GitBranch className="h-2.5 w-2.5" aria-hidden /> Condicional
                            </span>
                          )}
                        </span>
                      </span>
                    </button>
                    {!disabled && (
                      <span className="flex shrink-0 flex-col">
                        <button type="button" aria-label={`Subir ${field.label}`} disabled={index === 0} onClick={() => setFields(moveField(fields, index, -1), index - 1)} className="rounded p-0.5 text-muted-foreground hover:text-foreground disabled:opacity-30">
                          <ArrowUp className="h-3.5 w-3.5" aria-hidden />
                        </button>
                        <button type="button" aria-label={`Bajar ${field.label}`} disabled={index === fields.length - 1} onClick={() => setFields(moveField(fields, index, 1), index + 1)} className="rounded p-0.5 text-muted-foreground hover:text-foreground disabled:opacity-30">
                          <ArrowDown className="h-3.5 w-3.5" aria-hidden />
                        </button>
                      </span>
                    )}
                    {!disabled && (
                      <button
                        type="button"
                        aria-label={`Borrar ${field.label}`}
                        onClick={() => setFields(removeField(fields, index), Math.min(selected, fields.length - 2))}
                        className="rounded p-1 text-muted-foreground hover:text-destructive"
                      >
                        <Trash2 className="h-4 w-4" aria-hidden />
                      </button>
                    )}
                  </li>
                );
              })}
            </ul>
          )}
        </section>

        {/* Panel del campo */}
        <section aria-label="Editar campo" className="min-w-0 rounded-xl border border-border bg-card p-4">
          {current ? (
            <FieldEditor
              key={current.id}
              field={current}
              index={selected}
              fields={fields}
              neverPublished={neverPublished}
              disabled={disabled}
              contactLine={fieldContactLine(contactConfig, current, customFields)}
              onOpenContact={onOpenContact}
              onPatch={(patch) => setFields(updateField(fields, selected, patch))}
              onRelabel={(label) => setFields(relabelField(fields, selected, label, neverPublished))}
              onSetKey={(key) => {
                const result = setFieldKey(fields, selected, key);
                if (!result.error) setFields(result.fields);
                return result.error;
              }}
            />
          ) : (
            <p className="text-sm text-muted-foreground">Elegí un campo de la lista para editarlo.</p>
          )}
        </section>

        {/* Vista previa (pantallas grandes) */}
        <aside aria-label="Vista previa" className="hidden xl:block">
          <p className="mb-2 text-xs font-semibold text-muted-foreground">Así lo ve quien responde</p>
          {preview}
        </aside>
      </div>

      {/* Vista previa (celular y pantallas medianas) */}
      <div className="xl:hidden">
        <button type="button" onClick={() => setPreviewOpen(true)} className="inline-flex items-center gap-2 rounded-lg border border-border px-3 py-1.5 text-sm hover:bg-accent">
          <Eye className="h-4 w-4" aria-hidden /> Ver cómo queda
        </button>
        {previewOpen && (
          <Sheet title="Así lo ve quien responde" onClose={() => setPreviewOpen(false)}>
            {preview}
          </Sheet>
        )}
      </div>

      {problems.length > 0 && (
        <div role="status" className="rounded-lg border border-amber-300 bg-amber-50 p-3 text-xs text-amber-900 dark:border-amber-500/40 dark:bg-amber-500/10 dark:text-amber-200">
          <p className="font-semibold">Para poder publicar falta arreglar:</p>
          <ul className="mt-1 list-inside list-disc space-y-0.5">
            {problems.slice(0, 8).map((p) => (
              <li key={p}>{p}</li>
            ))}
          </ul>
          {problems.length > 8 && <p className="mt-1">…y {problems.length - 8} más.</p>}
        </div>
      )}

      <DesignCards draft={draft} onChange={onChange} disabled={disabled} />
    </div>
  );
}
