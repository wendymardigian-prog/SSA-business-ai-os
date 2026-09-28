"use client";

import { useState } from "react";
import { ChevronDown, ChevronUp, Trash2 } from "lucide-react";
import {
  CUSTOM_FIELD_TYPES,
  FIELD_TYPE_LABELS,
  MAX_OPTIONS,
  MIN_OPTIONS,
  VISIBILITIES,
  identifierFromLabel,
  uniqueIdentifier,
} from "@/lib/scheduling/booking-fields";
import type { BookingField, BookingFieldType, BookingFieldVisibility } from "@/lib/scheduling/types";

/**
 * Constructor del formulario de reserva (F20). Adaptado de Cal.diy
 * (https://github.com/calcom/cal.diy), MIT License, Copyright (c)
 * 2020-present Cal.com, Inc. (FormBuilder), limitado a los tipos que el plano
 * pide y sin react-hook-form.
 *
 * Los tres campos del sistema quedan arriba, en orden fijo: nombre siempre
 * obligatorio; email o telefono tiene que ser obligatorio (lo valida el
 * nucleo y lo avisa la pantalla).
 */

const VISIBILITY_LABELS: Record<BookingFieldVisibility, string> = {
  required: "Obligatorio",
  optional: "Opcional",
  hidden: "Oculto",
};

export function FormBuilder({
  fields,
  onChange,
  error,
  disabled,
}: {
  fields: BookingField[];
  onChange: (next: BookingField[]) => void;
  error?: string | null;
  disabled?: boolean;
}) {
  const [editing, setEditing] = useState<string | null>(null);

  const update = (id: string, patch: Partial<BookingField>) => onChange(fields.map((f) => (f.id === id ? { ...f, ...patch } : f)));

  function addQuestion(type: BookingFieldType) {
    const label = "Nueva pregunta";
    const identifier = uniqueIdentifier(identifierFromLabel(label), fields.map((f) => f.identifier));
    const field: BookingField = {
      id: identifier,
      type,
      system: false,
      label,
      visibility: "optional",
      identifier,
      ...(type === "select" || type === "multiselect" ? { options: ["Opción 1", "Opción 2"] } : {}),
    };
    onChange([...fields, field]);
    setEditing(field.id);
  }

  function move(index: number, delta: number) {
    const custom = fields.filter((f) => !f.system);
    const systems = fields.filter((f) => f.system);
    const target = index + delta;
    if (target < 0 || target >= custom.length) return;
    const next = [...custom];
    [next[index], next[target]] = [next[target], next[index]];
    onChange([...systems, ...next]);
  }

  const systemFields = fields.filter((f) => f.system);
  const customFields = fields.filter((f) => !f.system);
  const inputClass = "h-9 w-full rounded-lg border border-input bg-background px-3 text-sm";

  return (
    <div className="space-y-4">
      <p className="text-xs text-muted-foreground">
        Nombre siempre; <strong>email o teléfono tiene que ser obligatorio</strong> (hace falta para vincular el contacto).
      </p>
      {error && <p className="rounded-lg border border-red-300 bg-red-50 p-2 text-sm text-red-700 dark:border-red-500/40 dark:bg-red-950/40 dark:text-red-300">{error}</p>}

      <ul className="space-y-2">
        {systemFields.map((f) => (
          <li key={f.id} className="flex flex-wrap items-center gap-2 rounded-lg border border-border bg-muted/30 p-2">
            <span className="text-sm font-medium">{f.label}</span>
            <span className="rounded-full border border-border px-2 py-0.5 text-[11px] text-muted-foreground">{FIELD_TYPE_LABELS[f.type]}</span>
            {f.type === "name" ? (
              <span className="ml-auto text-xs text-muted-foreground">Siempre obligatorio</span>
            ) : (
              <select
                aria-label={`Visibilidad de ${f.label}`}
                value={f.visibility}
                disabled={disabled}
                onChange={(e) => update(f.id, { visibility: e.target.value as BookingFieldVisibility })}
                className="ml-auto h-8 rounded-lg border border-input bg-background px-2 text-sm"
              >
                {VISIBILITIES.map((v) => (
                  <option key={v} value={v}>{VISIBILITY_LABELS[v]}</option>
                ))}
              </select>
            )}
          </li>
        ))}

        {customFields.map((f, i) => (
          <li key={f.id} className="rounded-lg border border-border p-2">
            <div className="flex flex-wrap items-center gap-2">
              <span className="flex flex-col">
                <button type="button" disabled={disabled || i === 0} aria-label={`Subir ${f.label}`} onClick={() => move(i, -1)} className="text-muted-foreground disabled:opacity-30"><ChevronUp className="h-3.5 w-3.5" /></button>
                <button type="button" disabled={disabled || i === customFields.length - 1} aria-label={`Bajar ${f.label}`} onClick={() => move(i, 1)} className="text-muted-foreground disabled:opacity-30"><ChevronDown className="h-3.5 w-3.5" /></button>
              </span>
              <button type="button" onClick={() => setEditing(editing === f.id ? null : f.id)} className="min-w-0 flex-1 text-left">
                <span className="block text-sm font-medium">{f.label}</span>
                <span className="block text-xs text-muted-foreground">{FIELD_TYPE_LABELS[f.type]} · {VISIBILITY_LABELS[f.visibility]} · {`{{answers.${f.identifier}}}`}</span>
              </button>
              <button type="button" disabled={disabled} aria-label={`Quitar ${f.label}`} onClick={() => onChange(fields.filter((x) => x.id !== f.id))} className="rounded p-1 text-muted-foreground hover:bg-muted hover:text-red-600">
                <Trash2 className="h-4 w-4" />
              </button>
            </div>

            {editing === f.id && (
              <div className="mt-3 grid gap-3 border-t border-border pt-3 sm:grid-cols-2">
                <label className="block text-xs font-medium">
                  Etiqueta
                  <input
                    value={f.label}
                    disabled={disabled}
                    onChange={(e) => {
                      const label = e.target.value;
                      // El identificador sigue a la etiqueta hasta que se toca a mano.
                      const auto = uniqueIdentifier(identifierFromLabel(label), fields.filter((x) => x.id !== f.id).map((x) => x.identifier));
                      update(f.id, { label, identifier: f.identifier === identifierFromLabel(f.label) || !f.identifier ? auto : f.identifier });
                    }}
                    maxLength={120}
                    className={`${inputClass} mt-1 font-normal`}
                  />
                </label>
                <label className="block text-xs font-medium">
                  Identificador <span className="font-normal text-muted-foreground">(va en las variables)</span>
                  <input value={f.identifier} disabled={disabled} onChange={(e) => update(f.id, { identifier: e.target.value.toLowerCase() })} maxLength={40} className={`${inputClass} mt-1 font-normal`} />
                </label>
                <label className="block text-xs font-medium">
                  Texto de ayuda
                  <input value={f.help ?? ""} disabled={disabled} onChange={(e) => update(f.id, { help: e.target.value })} maxLength={200} className={`${inputClass} mt-1 font-normal`} />
                </label>
                <label className="block text-xs font-medium">
                  Visibilidad
                  <select value={f.visibility} disabled={disabled} onChange={(e) => update(f.id, { visibility: e.target.value as BookingFieldVisibility })} className={`${inputClass} mt-1 font-normal`}>
                    {VISIBILITIES.map((v) => (
                      <option key={v} value={v}>{VISIBILITY_LABELS[v]}</option>
                    ))}
                  </select>
                </label>
                {(f.type === "select" || f.type === "multiselect") && (
                  <div className="sm:col-span-2">
                    <p className="text-xs font-medium">Opciones <span className="font-normal text-muted-foreground">({MIN_OPTIONS} a {MAX_OPTIONS})</span></p>
                    <div className="mt-1 space-y-1">
                      {(f.options ?? []).map((opt, oi) => (
                        <div key={oi} className="flex items-center gap-1.5">
                          <input
                            value={opt}
                            disabled={disabled}
                            aria-label={`Opción ${oi + 1}`}
                            onChange={(e) => update(f.id, { options: (f.options ?? []).map((o, j) => (j === oi ? e.target.value : o)) })}
                            className={inputClass}
                          />
                          <button type="button" disabled={disabled || (f.options ?? []).length <= MIN_OPTIONS} aria-label={`Quitar opción ${oi + 1}`} onClick={() => update(f.id, { options: (f.options ?? []).filter((_, j) => j !== oi) })} className="text-xs text-muted-foreground disabled:opacity-30">✕</button>
                        </div>
                      ))}
                      <button type="button" disabled={disabled || (f.options ?? []).length >= MAX_OPTIONS} onClick={() => update(f.id, { options: [...(f.options ?? []), `Opción ${(f.options ?? []).length + 1}`] })} className="text-xs text-primary disabled:opacity-40">
                        + Opción
                      </button>
                    </div>
                  </div>
                )}
              </div>
            )}
          </li>
        ))}
      </ul>

      <div className="flex flex-wrap items-center gap-2">
        <span className="text-xs text-muted-foreground">Agregar pregunta:</span>
        {CUSTOM_FIELD_TYPES.map((t) => (
          <button key={t} type="button" disabled={disabled} onClick={() => addQuestion(t)} className="rounded-lg border border-border px-2.5 py-1 text-xs hover:bg-muted disabled:opacity-50">
            {FIELD_TYPE_LABELS[t]}
          </button>
        ))}
      </div>
    </div>
  );
}
