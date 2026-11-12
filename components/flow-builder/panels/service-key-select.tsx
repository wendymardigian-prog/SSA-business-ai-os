// @plantilla-quitar(servicios)
"use client";

import { AlertTriangle } from "lucide-react";
import { keyLabel, phaseGroups, staleKeyMessage, stepGroups, type PickerScope, type ServicePickerOptions } from "@/lib/services/service-picker";

const inputClass = "w-full rounded-lg border border-border bg-card px-3 py-2 text-sm text-foreground focus:border-ring focus:outline-none focus:ring-1 focus:ring-ring";

/**
 * Elegir una fase o un paso del camino de una lista, con su nombre (F122). Se guarda la clave como siempre. Si la clave
 * guardada ya no existe en el camino, lo dice y queda elegida (para que se vea cual era) hasta que se elija otra.
 */
export function ServiceKeySelect({
  id,
  kind,
  options,
  scope,
  value,
  onChange,
  emptyLabel,
}: {
  id: string;
  kind: "phase" | "step";
  options: ServicePickerOptions | null | undefined;
  scope: PickerScope & { phaseKey?: string | null };
  value: string | null;
  onChange: (key: string | null) => void;
  /** La opcion vacia ("Cualquier paso"). Sin esto, elegir es obligatorio. */
  emptyLabel?: string;
}) {
  if (options === undefined) return <p className="text-xs text-muted-foreground">Cargando los caminos…</p>;
  if (options === null) return <p role="alert" className="text-xs text-destructive">No pude leer los caminos de tus productos. Cerrá el panel y volvé a abrirlo.</p>;
  const groups = kind === "phase" ? phaseGroups(options, scope) : stepGroups(options, scope);
  const stale = value ? staleKeyMessage(options, kind === "phase" ? { ...scope, phaseKey: value } : { ...scope, itemKey: value }) : null;
  const known = groups.some((g) => g.options.some((o) => o.key === value));
  return (
    <div className="space-y-1">
      <select id={id} value={value ?? ""} onChange={(e) => onChange(e.target.value || null)} className={inputClass} aria-invalid={!!stale}>
        <option value="">{emptyLabel ?? (kind === "phase" ? "Elegí la fase…" : "Elegí el paso…")}</option>
        {value && !known && <option value={value}>{keyLabel(options, value) ?? (kind === "phase" ? "(fase que ya no existe)" : "(paso que ya no existe)")}</option>}
        {groups.map((g) => (
          <optgroup key={g.label} label={g.label}>
            {g.options.map((o) => (
              <option key={`${g.label}-${o.key}`} value={o.key}>
                {o.label}
              </option>
            ))}
          </optgroup>
        ))}
      </select>
      {groups.length === 0 && <p className="text-[11px] text-muted-foreground">Ningún producto con esa elección tiene camino todavía. Se arma en Ajustes › Productos › variante › Camino del cliente.</p>}
      {stale && (
        <p role="alert" className="flex items-start gap-1.5 text-[11px] text-destructive">
          <AlertTriangle className="mt-0.5 h-3 w-3 shrink-0" aria-hidden />
          {stale}
        </p>
      )}
    </div>
  );
}

/** El selector de variante de un producto (o "Cualquier variante de este producto"). */
export function ServiceVariantSelect({ id, options, productId, value, onChange }: { id: string; options: ServicePickerOptions | null | undefined; productId: string | null; value: string | null; onChange: (variantId: string | null) => void }) {
  const product = options?.products.find((p) => p.id === productId);
  return (
    <select id={id} value={value ?? ""} disabled={!product} onChange={(e) => onChange(e.target.value || null)} className={inputClass}>
      <option value="">{product ? "Cualquier variante de este producto" : "Elegí primero el producto"}</option>
      {product?.variants.map((v) => (
        <option key={v.id} value={v.id}>
          {v.name}
        </option>
      ))}
    </select>
  );
}
