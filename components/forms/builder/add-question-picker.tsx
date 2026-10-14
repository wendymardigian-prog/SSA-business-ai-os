"use client";

import { useState } from "react";
import { Plus } from "lucide-react";
import { pickerGroups } from "@/lib/forms/canvas-view";
import type { FormFieldType, FormType } from "@/lib/forms/fields";
import { FIELD_ICONS } from "./field-icons";

/**
 * "+ Agregar pregunta": un boton punteado al pie del lienzo que se abre EN el lienzo (no es un modal) con los tipos
 * agrupados (plano formularios-ui, F9). Elegir uno agrega la pregunta y cierra el selector.
 */
export function AddQuestionPicker({
  formType,
  onPick,
  disabled,
  label = "Agregar pregunta",
  autoOpen = false,
}: {
  formType: FormType;
  onPick: (type: FormFieldType) => void;
  /** Sin permiso, o con el tope de preguntas alcanzado. */
  disabled?: boolean;
  label?: string;
  autoOpen?: boolean;
}) {
  const [open, setOpen] = useState(autoOpen);
  if (!open) {
    return (
      <button
        type="button"
        disabled={disabled}
        onClick={() => setOpen(true)}
        className="flex w-full items-center justify-center gap-1.5 rounded-xl border border-dashed border-border px-3 py-3 text-sm font-medium text-muted-foreground transition-colors hover:border-primary hover:text-foreground disabled:pointer-events-none disabled:opacity-50"
      >
        <Plus className="h-4 w-4" aria-hidden /> {label}
      </button>
    );
  }
  return (
    <div role="group" aria-label="Elegí el tipo de pregunta" className="space-y-3 rounded-xl border border-border bg-card p-3">
      <div className="flex items-center justify-between">
        <p className="text-xs font-semibold">Elegí el tipo de pregunta</p>
        <button type="button" onClick={() => setOpen(false)} className="text-xs text-muted-foreground underline hover:text-foreground">
          Cerrar
        </button>
      </div>
      {pickerGroups(formType).map((group) => (
        <div key={group.title}>
          <p className="mb-1.5 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">{group.title}</p>
          <div className="grid grid-cols-2 gap-1.5 sm:grid-cols-3">
            {group.types.map(({ type, label: typeLabel }) => {
              const Icon = FIELD_ICONS[type];
              return (
                <button
                  key={type}
                  type="button"
                  onClick={() => {
                    onPick(type);
                    setOpen(false);
                  }}
                  className="flex items-center gap-2 rounded-lg border border-border px-2.5 py-2 text-left text-sm hover:border-primary hover:bg-accent"
                >
                  <Icon className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden />
                  {typeLabel}
                </button>
              );
            })}
          </div>
        </div>
      ))}
    </div>
  );
}
