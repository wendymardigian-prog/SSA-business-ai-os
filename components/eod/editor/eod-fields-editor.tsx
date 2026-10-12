"use client";

import { useState } from "react";
import { ArrowDown, ArrowUp, Trash2 } from "lucide-react";
import { FieldEditor } from "@/components/forms/builder/field-editor";
import { FIELD_ICONS } from "@/components/forms/builder/field-icons";
import { FieldTypePicker } from "@/components/forms/builder/field-type-picker";
import { moveField, relabelField, removeField, setFieldKey, updateField } from "@/lib/forms/builder";
import { addEodField } from "@/lib/eod/builder";
import { metricLabel } from "@/lib/eod/metrics";
import { EOD_FIELD_TYPES, FIELD_TYPE_LABELS, MAX_FIELDS, type FormField } from "@/lib/forms/fields";
import { cn } from "@/lib/utils";

/**
 * La lista de preguntas de un reporte de fin de día con su panel: la usan las preguntas
 * generales y cada canal. Reusa el builder de Formularios limitado a los cinco tipos
 * de un EOD. Solo compone: las reglas viven en `lib/forms/builder.ts` y `lib/eod/`.
 */
export function EodFieldsEditor({
  fields,
  onChange,
  disabled,
  neverPublished,
  label,
  emptyText = "Todavía no hay preguntas. Agregá la primera.",
}: {
  fields: FormField[];
  onChange: (next: FormField[]) => void;
  disabled: boolean;
  neverPublished: boolean;
  /** El nombre de la lista para el lector de pantalla ("Preguntas de Instagram"). */
  label: string;
  emptyText?: string;
}) {
  const [selected, setSelected] = useState<number>(fields.length > 0 ? 0 : -1);
  const current = fields[selected];

  function setFields(next: FormField[], nextSelected?: number) {
    onChange(next);
    if (nextSelected !== undefined) setSelected(nextSelected);
  }

  return (
    <div className="grid gap-4 lg:grid-cols-[280px_minmax(0,1fr)]">
      <section aria-label={label} className="space-y-3">
        {!disabled && (
          <FieldTypePicker
            label="Agregar pregunta"
            types={EOD_FIELD_TYPES}
            disabled={fields.length >= MAX_FIELDS}
            onPick={(t) => setFields(addEodField(fields, t), fields.length)}
          />
        )}
        {fields.length === 0 ? (
          <p className="rounded-lg border border-dashed border-border p-4 text-sm text-muted-foreground">{emptyText}</p>
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
                      <span className="flex flex-wrap gap-1.5 text-[10px] text-muted-foreground">
                        {field.required && <span>Obligatoria</span>}
                        {field.metricKey && <span>Mide: {metricLabel(field.metricKey)}</span>}
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

      <section aria-label="Editar pregunta" className="min-w-0 rounded-xl border border-border bg-card p-4">
        {current ? (
          <FieldEditor
            key={current.id}
            mode="eod"
            field={current}
            index={selected}
            fields={fields}
            neverPublished={neverPublished}
            disabled={disabled}
            onPatch={(patch) => setFields(updateField(fields, selected, patch))}
            onRelabel={(text) => setFields(relabelField(fields, selected, text, neverPublished))}
            onSetKey={(key) => {
              const result = setFieldKey(fields, selected, key);
              if (!result.error) setFields(result.fields);
              return result.error;
            }}
          />
        ) : (
          <p className="text-sm text-muted-foreground">Elegí una pregunta de la lista para editarla.</p>
        )}
      </section>
    </div>
  );
}
