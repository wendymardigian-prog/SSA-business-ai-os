"use client";

import { useId } from "react";
import { cn } from "@/lib/utils";
import type { ToolConfigField, ToolConfigOption, ToolOptionSource } from "@/lib/agent/tools/types";
import { NumberInput, inputClass } from "./fields";

/**
 * Renderiza los parametros de UNA herramienta a partir de su descriptor
 * (configFields). No sabe que herramienta es: sabe que hay un booleano, un
 * numero, una eleccion o una lista, y de donde salen las opciones.
 */

export type OptionSources = Record<ToolOptionSource, ToolConfigOption[]>;

export function fieldOptions(field: ToolConfigField, sources: OptionSources): ToolConfigOption[] {
  if (field.kind !== "select" && field.kind !== "multiselect") return [];
  if (field.options) return field.options;
  return field.optionSource ? sources[field.optionSource] ?? [] : [];
}

/** Un multiselect obligatorio sin opciones en su fuente: la herramienta no se puede habilitar. */
export function blockingField(fields: ToolConfigField[], sources: OptionSources): ToolConfigField | null {
  return (
    fields.find((f) => f.kind === "multiselect" && f.requiredForTool && fieldOptions(f, sources).length === 0) ?? null
  );
}

export function ToolConfigFields({
  fields,
  values,
  sources,
  onChange,
  disabled,
}: {
  fields: ToolConfigField[];
  values: Record<string, unknown>;
  sources: OptionSources;
  onChange: (key: string, value: unknown) => void;
  disabled?: boolean;
}) {
  return (
    <div className="space-y-3">
      {fields.map((field) => {
        if (field.showIf && values[field.showIf.key] !== field.showIf.equals) return null;
        return (
          <ConfigField key={field.key} field={field} value={values[field.key]} options={fieldOptions(field, sources)} onChange={(v) => onChange(field.key, v)} disabled={disabled} />
        );
      })}
    </div>
  );
}

function ConfigField({
  field,
  value,
  options,
  onChange,
  disabled,
}: {
  field: ToolConfigField;
  value: unknown;
  options: ToolConfigOption[];
  onChange: (value: unknown) => void;
  disabled?: boolean;
}) {
  const id = useId();

  if (field.kind === "boolean") {
    return (
      <label className="flex cursor-pointer items-start gap-3">
        <input type="checkbox" checked={Boolean(value)} disabled={disabled} onChange={(e) => onChange(e.target.checked)} className="mt-0.5 h-4 w-4 flex-shrink-0" />
        <span>
          <span className="block text-sm font-medium">{field.label}</span>
          {field.hint && <span className="mt-0.5 block text-xs text-muted-foreground">{field.hint}</span>}
        </span>
      </label>
    );
  }

  if (field.kind === "number") {
    return (
      <div>
        <label htmlFor={id} className="block text-xs font-semibold">{field.label}</label>
        <div className="mt-1 max-w-xs">
          <NumberInput id={id} value={typeof value === "number" ? value : null} min={field.min} max={field.max} step={field.step} onChange={(v) => onChange(v ?? field.min ?? 0)} />
        </div>
        {field.hint && <p className="mt-1 text-[11px] text-muted-foreground">{field.hint}</p>}
      </div>
    );
  }

  if (field.kind === "select") {
    return (
      <div>
        <label htmlFor={id} className="block text-xs font-semibold">{field.label}</label>
        <select id={id} value={typeof value === "string" ? value : ""} disabled={disabled} onChange={(e) => onChange(e.target.value || null)} className={`${inputClass} mt-1 max-w-sm`}>
          <option value="">Elegí…</option>
          {options.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}{o.hint ? ` (${o.hint})` : ""}
            </option>
          ))}
        </select>
        {field.hint && <p className="mt-1 text-[11px] text-muted-foreground">{field.hint}</p>}
      </div>
    );
  }

  // multiselect: chips que se prenden y apagan
  const selected = new Set(Array.isArray(value) ? (value as string[]) : []);
  return (
    <div>
      <p className="text-xs font-semibold">{field.label}</p>
      {field.hint && <p className="text-[11px] text-muted-foreground">{field.hint}</p>}
      {options.length === 0 ? (
        <p className="mt-2 text-xs text-amber-700 dark:text-amber-400">{field.emptySourceMessage ?? "No hay opciones disponibles."}</p>
      ) : (
        <div className="mt-2 flex flex-wrap gap-1.5" role="group" aria-label={field.label}>
          {options.map((o) => {
            const on = selected.has(o.value);
            return (
              <button
                key={o.value}
                type="button"
                aria-pressed={on}
                disabled={disabled}
                onClick={() => {
                  const next = new Set(selected);
                  if (on) next.delete(o.value);
                  else next.add(o.value);
                  onChange([...next]);
                }}
                className={cn(
                  "rounded-full border px-2.5 py-1 text-xs transition-colors disabled:opacity-50",
                  on ? "border-primary bg-primary text-primary-foreground" : "border-border hover:bg-accent",
                )}
              >
                {o.label}
                {o.hint && <span className={cn("ml-1", on ? "opacity-80" : "text-muted-foreground")}>· {o.hint}</span>}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
