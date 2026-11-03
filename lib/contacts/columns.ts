/**
 * El catálogo de columnas de la lista de contactos y las preferencias de cada
 * persona (qué columnas ve).
 *
 * Las columnas fijas salen de `columns-core.ts` y de cada área
 * (`list-modules.ts`); los campos personalizados se suman acá, una columna por
 * campo (`cf:<id>`). "Nombre" es la única que no se puede ocultar.
 *
 * Las preferencias viven en `localStorage` (`contacts-columns`). Hay dos
 * formatos guardados y los dos se leen:
 *
 *   viejo  un array con las columnas OPCIONALES que se veían
 *          (`["status","product","cf:…"]`). Las que antes eran fijas
 *          (contacto, setter, vendedor, etiquetas, última) no estaban porque
 *          siempre se veían: al leerlo se suman como visibles.
 *   nuevo  `{ v: 2, visible: [...] }`: todas las que se ven.
 *
 * Lo que ya no existe (un campo borrado) se descarta. Puro.
 */
import { foldText } from "@/lib/ui/multi-filter";
import { GROUPS } from "./filters/catalog";
import type { CellValue, ContactColumnDef, ContactRecord, ListGroupDef } from "./filters/types";
import { CUSTOM_COLUMNS_BEFORE } from "./columns-core";
import { CONTACT_COLUMNS } from "./list-modules";
import type { CustomFieldRef } from "./list-filters";

export const COLUMNS_STORAGE_KEY = "contacts-columns";

/** Las que antes del catálogo no se podían ocultar: un guardado viejo las da por visibles. */
const LEGACY_FIXED = ["contact", "setter", "vendedor", "tags", "last_interaction"] as const;

export const customColumnKey = (fieldId: string) => `cf:${fieldId}`;

/** Todas las columnas, en el orden de la tabla, con los campos personalizados en su lugar. */
export function allColumns(customFields: readonly Pick<CustomFieldRef, "id" | "name">[], base: readonly ContactColumnDef[] = CONTACT_COLUMNS): ContactColumnDef[] {
  const custom: ContactColumnDef[] = customFields.map((f) => ({
    key: customColumnKey(f.id),
    label: f.name,
    group: GROUPS.custom,
    hideable: true,
    defaultVisible: false,
    source: "special",
  }));
  const at = base.findIndex((c) => c.key === CUSTOM_COLUMNS_BEFORE);
  if (at < 0) return [...base, ...custom];
  return [...base.slice(0, at), ...custom, ...base.slice(at)];
}

const fixedKeys = (defs: readonly ContactColumnDef[]) => defs.filter((c) => !c.hideable).map((c) => c.key);
export const defaultVisibleKeys = (defs: readonly ContactColumnDef[]) => defs.filter((c) => c.defaultVisible || !c.hideable).map((c) => c.key);

/** Lee lo guardado. Nunca lanza: algo roto o vacío vuelve a las de por defecto. */
export function parseColumnPrefs(raw: string | null | undefined, defs: readonly ContactColumnDef[]): string[] {
  const known = new Set(defs.map((c) => c.key));
  let saved: string[] | null = null;
  try {
    const parsed: unknown = raw ? JSON.parse(raw) : null;
    if (Array.isArray(parsed)) {
      saved = [...parsed.filter((c): c is string => typeof c === "string"), ...LEGACY_FIXED];
    } else if (parsed && typeof parsed === "object" && (parsed as { v?: unknown }).v === 2 && Array.isArray((parsed as { visible?: unknown }).visible)) {
      saved = ((parsed as { visible: unknown[] }).visible).filter((c): c is string => typeof c === "string");
    }
  } catch {
    saved = null;
  }
  if (!saved) return defaultVisibleKeys(defs);
  const set = new Set([...saved.filter((k) => known.has(k)), ...fixedKeys(defs)]);
  // En el orden del catálogo, que es el de la tabla.
  return defs.filter((c) => set.has(c.key)).map((c) => c.key);
}

export function serializeColumnPrefs(visible: readonly string[]): string {
  return JSON.stringify({ v: 2, visible });
}

/** Prende o apaga una columna. "Nombre" no se apaga. */
export function toggleColumnKey(visible: readonly string[], key: string, defs: readonly ContactColumnDef[]): string[] {
  const def = defs.find((c) => c.key === key);
  if (!def || !def.hideable) return [...visible];
  const set = new Set(visible);
  if (set.has(key)) set.delete(key);
  else set.add(key);
  return defs.filter((c) => set.has(c.key)).map((c) => c.key);
}

/** "Mostrar todo": todas, de una vez. */
export const allColumnKeys = (defs: readonly ContactColumnDef[]) => defs.map((c) => c.key);

/** ¿La columna coincide con lo escrito? Por su nombre, su grupo y sus palabras extra. */
export function columnMatches(def: ContactColumnDef, query: string): boolean {
  const q = foldText(query.trim());
  if (!q) return true;
  const haystack = foldText([def.label, def.group.label, def.keywords ?? ""].join(" "));
  return q.split(/\s+/).every((word) => haystack.includes(word));
}

/** Lo que dibuja el menú de columnas: los grupos en orden, filtrados por el buscador. Los vacíos no salen. */
export function columnMenuGroups(defs: readonly ContactColumnDef[], query = ""): Array<{ group: ListGroupDef; columns: ContactColumnDef[] }> {
  const out = new Map<string, { group: ListGroupDef; columns: ContactColumnDef[] }>();
  for (const def of defs) {
    if (!columnMatches(def, query)) continue;
    const entry = out.get(def.group.key) ?? { group: def.group, columns: [] };
    entry.columns.push(def);
    out.set(def.group.key, entry);
  }
  return [...out.values()].sort((a, b) => a.group.order - b.group.order);
}

/**
 * Las celdas que salen de la fila del contacto (`source: "contact"`). Son
 * baratas (ya vienen en el `select *`), así que van todas, se vean o no. Una
 * que falla queda en "—": una columna nunca tumba la lista.
 */
export function contactCells(row: ContactRecord, defs: readonly ContactColumnDef[] = CONTACT_COLUMNS): Record<string, CellValue> {
  const out: Record<string, CellValue> = {};
  for (const def of defs) {
    if (def.source !== "contact" || !def.cell) continue;
    try {
      out[def.key] = def.cell(row);
    } catch {
      out[def.key] = null;
    }
  }
  return out;
}
