"use client";

import { useMemo, useState, useSyncExternalStore } from "react";
import { Columns3 } from "lucide-react";
import { cn } from "@/lib/utils";
import { FilterMenu, MenuGroupLabel } from "@/components/ui/filter-menu";
import {
  COLUMNS_STORAGE_KEY,
  CUSTOM_FILTER_OP_LABELS,
  opsForType,
  parseVisibleColumns,
  type CustomFieldRef,
  type CustomFilterOp,
  type OptionalColumn,
} from "@/lib/contacts/list-filters";

/**
 * Los controles nuevos de la lista de contactos (pipeline): el filtro por un
 * campo personalizado y el selector de columnas. La lógica vive en
 * `lib/contacts/list-filters.ts`; esto solo la compone.
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
          className={cn(inputClass, current ? "border-primary" : "")}
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

/**
 * Qué columnas opcionales se ven: Estado, Producto y cada campo personalizado.
 * Es una preferencia de cada persona: vive en `localStorage` (siempre en
 * try/catch; sin poder leerlo, las de por defecto). Mismo patrón que las
 * vistas guardadas de Llamadas: `useSyncExternalStore`, así el servidor dibuja
 * las de por defecto y el navegador las de la persona sin un render de más.
 */
const COLUMNS_EVENT = "contacts:columns-changed";
function subscribeColumns(onChange: () => void): () => void {
  window.addEventListener("storage", onChange);
  window.addEventListener(COLUMNS_EVENT, onChange);
  return () => {
    window.removeEventListener("storage", onChange);
    window.removeEventListener(COLUMNS_EVENT, onChange);
  };
}
function readColumns(): string | null {
  try {
    return window.localStorage.getItem(COLUMNS_STORAGE_KEY);
  } catch {
    return null;
  }
}

export function useVisibleColumns(fieldIds: string[]) {
  const raw = useSyncExternalStore(subscribeColumns, readColumns, () => null);
  const key = fieldIds.join(",");
  const columns = useMemo(() => parseVisibleColumns(raw, key ? key.split(",") : []), [raw, key]);

  function toggle(column: OptionalColumn) {
    const next = columns.includes(column) ? columns.filter((c) => c !== column) : [...columns, column];
    try {
      window.localStorage.setItem(COLUMNS_STORAGE_KEY, JSON.stringify(next));
    } catch {
      // Sin almacenamiento: no se guarda.
    }
    window.dispatchEvent(new Event(COLUMNS_EVENT));
  }
  return { columns, toggle };
}

export function ColumnsMenu({
  fields,
  columns,
  onToggle,
}: {
  fields: CustomFieldRef[];
  columns: OptionalColumn[];
  onToggle: (column: OptionalColumn) => void;
}) {
  const options: Array<{ value: OptionalColumn; label: string }> = [
    { value: "status", label: "Estado" },
    { value: "product", label: "Producto de interés" },
    ...fields.map((f) => ({ value: `cf:${f.id}` as OptionalColumn, label: f.name })),
  ];
  return (
    <FilterMenu
      label="Columnas"
      compact
      active={false}
      icon={<Columns3 className="h-3.5 w-3.5 text-muted-foreground" aria-hidden />}
      menuClassName="topbar:w-[260px]"
    >
      <div className="max-h-80 space-y-1 overflow-y-auto px-2.5 pb-2">
        <MenuGroupLabel>Columnas</MenuGroupLabel>
        {options.map((o, i) => (
          <div key={o.value}>
            {i === 2 && <MenuGroupLabel>Campos personalizados</MenuGroupLabel>}
            <label className="flex cursor-pointer items-center gap-2 rounded-lg px-1 py-1 text-sm hover:bg-accent">
              <input type="checkbox" checked={columns.includes(o.value)} onChange={() => onToggle(o.value)} className="h-4 w-4 accent-primary" />
              {o.label}
            </label>
          </div>
        ))}
      </div>
    </FilterMenu>
  );
}
