"use client";

import { useState } from "react";
import { cn } from "@/lib/utils";
import { CUSTOM_FILTER_OP_LABELS, opsForType, type CustomFieldRef, type CustomFilterOp } from "@/lib/contacts/list-filters";

/**
 * El filtro por un campo personalizado de la lista de contactos. La lógica
 * vive en `lib/contacts/list-filters.ts`; esto solo la compone. Las columnas
 * están en `columns-menu.tsx`.
 */

/**
 * Filtrar por UN campo personalizado: campo, operador y valor. Se aplica con
 * el botón (no en cada tecla) y escribe la URL (`?campo=&op=&valor=`).
 */
export function CustomFieldFilter({
  fields,
  current,
  onApply,
}: {
  fields: CustomFieldRef[];
  current: { slug: string; op: CustomFilterOp; value: string } | null;
  onApply: (next: { campo: string; op: string; valor: string }) => void;
}) {
  const [slug, setSlug] = useState(current?.slug ?? "");
  const [op, setOp] = useState<CustomFilterOp | "">(current?.op ?? "");
  const [value, setValue] = useState(current?.value ?? "");
  if (fields.length === 0) return null;

  const field = fields.find((f) => f.slug === slug) ?? null;
  const ops = field ? opsForType(field.type) : [];
  const effectiveOp: CustomFilterOp | "" = field ? (op && ops.includes(op) ? op : ops[0]) : "";
  const needsValue = effectiveOp !== "" && effectiveOp !== "empty" && effectiveOp !== "filled";
  const inputClass = "w-full rounded-lg border border-input bg-background px-2.5 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-ring";

  return (
    <div className="space-y-1.5">
      <label className="block">
        <span className="mb-0.5 block text-xs text-muted-foreground">Campo personalizado</span>
        <select
          value={slug}
          onChange={(e) => {
            setSlug(e.target.value);
            setOp("");
            setValue("");
            if (!e.target.value) onApply({ campo: "", op: "", valor: "" });
          }}
          className={cn(inputClass, current ? "border-primary-edge" : "")}
        >
          <option value="">Ninguno</option>
          {fields.map((f) => (
            <option key={f.id} value={f.slug}>
              {f.name}
            </option>
          ))}
        </select>
      </label>
      {field && (
        <div className="flex gap-1.5">
          <select aria-label="Condición" value={effectiveOp} onChange={(e) => setOp(e.target.value as CustomFilterOp)} className={cn(inputClass, "w-auto shrink-0")}>
            {ops.map((o) => (
              <option key={o} value={o}>
                {CUSTOM_FILTER_OP_LABELS[o]}
              </option>
            ))}
          </select>
          {needsValue &&
            (field.type === "boolean" ? (
              <select aria-label="Valor" value={value} onChange={(e) => setValue(e.target.value)} className={inputClass}>
                <option value="">—</option>
                <option value="true">Sí</option>
                <option value="false">No</option>
              </select>
            ) : (
              <input
                aria-label="Valor"
                type={field.type === "date" ? "date" : "text"}
                inputMode={field.type === "number" ? "decimal" : undefined}
                value={value}
                onChange={(e) => setValue(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") onApply({ campo: field.slug, op: effectiveOp, valor: value });
                }}
                placeholder={field.type === "number" ? "3" : "Valor"}
                className={inputClass}
              />
            ))}
        </div>
      )}
      {field && (
        <button
          type="button"
          disabled={needsValue && !value.trim()}
          onClick={() => onApply({ campo: field.slug, op: effectiveOp, valor: needsValue ? value : "" })}
          className="w-full rounded-lg border border-border px-2.5 py-1.5 text-xs font-medium hover:bg-accent disabled:opacity-50"
        >
          Aplicar
        </button>
      )}
    </div>
  );
}
