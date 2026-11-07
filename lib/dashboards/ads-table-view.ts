/**
 * Cómo se mira la tabla «Meta vs CRM»: el orden por una columna, las columnas FIJAS a la izquierda (junto al nombre) y si se
 * ven los colores del semáforo (`ads-tone.ts`).
 *
 * - **Orden**: una columna y una dirección. Lo vacío («—») va siempre al final, en las dos direcciones: un «—» no es el más
 *   barato ni el más caro. Sin orden elegido, la tabla queda como la arma `buildCrmRows` (por gasto).
 * - **Columnas fijas**: se acumulan en el orden en que se fijaron y se dibujan justo después del nombre, así quedan pegadas
 *   al desplazar la tabla de costado y se pueden comparar lado a lado. Se guardan POR PERSONA y POR PESTAÑA en
 *   `localStorage` (`ssa:ads-pinned:<nivel>`), aparte de las columnas elegidas (`ads-columns.ts`), que no cambian.
 * - **Colores**: prendidos por defecto; una sola preferencia para todas las pestañas (`ssa:ads-colors`).
 *
 * Todo acceso a `localStorage` va en `try/catch` (lo hace quien llama, como en `use-column-prefs.ts`): es una comodidad, no un dato.
 *
 * Modulo puro: lo prueba `ads-table-view.test.ts`.
 */

import { COLUMN_BY_ID, type ColumnDef, type ColumnId } from "./ads-crm-columns";
import type { CrmLevel, CrmRow } from "./ads-crm";
import { normalizeSearch } from "./ads-columns";

export type SortDir = "asc" | "desc";

/** «name» es la primera columna (el nombre de la campaña, el conjunto o el anuncio). */
export type SortKey = ColumnId | "name";

export interface SortState {
  key: SortKey;
  dir: SortDir;
}

const isColumnId = (value: unknown): value is ColumnId => typeof value === "string" && value in COLUMN_BY_ID;
const isSortKey = (value: unknown): value is SortKey => value === "name" || isColumnId(value);

/** `orden=cplTotal:asc` de la URL. Lo que no se entiende, sin orden. */
export function parseSort(raw: string | null | undefined): SortState | null {
  if (!raw) return null;
  const [key, dir] = raw.split(":");
  if (!isSortKey(key)) return null;
  return { key, dir: dir === "asc" ? "asc" : "desc" };
}

export function serializeSort(sort: SortState | null): string | null {
  return sort ? `${sort.key}:${sort.dir}` : null;
}

/** El valor por el que se ordena una fila: número, texto o null (va al final). */
function sortValue(row: CrmRow, key: SortKey): number | string | null {
  if (key === "name") return row.name || row.objectId;
  const def = COLUMN_BY_ID[key];
  if (def.kind === "text" || def.kind === "status" || def.kind === "link") {
    const text = def.text?.(row) ?? null;
    return text ? normalizeSearch(text) : null;
  }
  const value = def.value(row);
  return value === null || !Number.isFinite(value) ? null : value;
}

/** Ordena por la columna elegida. Estable: a igual valor, se respeta el orden que ya tenían. */
export function sortByColumn(rows: CrmRow[], sort: SortState | null): CrmRow[] {
  if (!sort) return rows;
  const factor = sort.dir === "asc" ? 1 : -1;
  return rows
    .map((row, index) => ({ row, index, value: sortValue(row, sort.key) }))
    .sort((a, b) => {
      if (a.value === null || b.value === null) {
        if (a.value === b.value) return a.index - b.index;
        return a.value === null ? 1 : -1;
      }
      const cmp = typeof a.value === "number" && typeof b.value === "number" ? a.value - b.value : String(a.value).localeCompare(String(b.value), "es");
      return cmp !== 0 ? cmp * factor : a.index - b.index;
    })
    .map(({ row }) => row);
}

// ── Columnas fijas ──────────────────────────────────────────────────────────

export const pinnedStorageKey = (level: CrmLevel) => `ssa:ads-pinned:${level}`;
export const COLORS_STORAGE_KEY = "ssa:ads-colors";

/** Lo guardado, sin confiar en el: solo ids de columnas que existen, sin repetidos. */
export function parsePinned(raw: string | null | undefined): ColumnId[] {
  if (!raw) return [];
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return [...new Set(parsed.filter(isColumnId))];
  } catch {
    return [];
  }
}

export const serializePinned = (pinned: ColumnId[]): string => JSON.stringify(pinned);

/** Fijar o soltar una columna. Fijar la agrega al final de las fijas (se acumulan en el orden en que se eligen). */
export function togglePinned(pinned: ColumnId[], id: ColumnId): ColumnId[] {
  return pinned.includes(id) ? pinned.filter((p) => p !== id) : [...pinned, id];
}

/** Prendidos salvo que se hayan apagado a propósito. */
export const parseColors = (raw: string | null | undefined): boolean => raw !== "off";
export const serializeColors = (on: boolean): string => (on ? "on" : "off");

/**
 * Las columnas a la vista, partidas en fijas (en el orden en que se fijaron, solo las que se ven) y el resto (en su orden
 * de siempre). Una columna fijada que se ocultó no aparece: fijar no la vuelve a mostrar.
 */
export function splitPinned(columns: ColumnDef[], pinned: ColumnId[]): { pinned: ColumnDef[]; rest: ColumnDef[] } {
  const byId = new Map(columns.map((c) => [c.id, c]));
  const fixed = pinned.map((id) => byId.get(id)).filter((c): c is ColumnDef => !!c);
  const fixedIds = new Set(fixed.map((c) => c.id));
  return { pinned: fixed, rest: columns.filter((c) => !fixedIds.has(c.id)) };
}

/** Donde empieza cada columna fija, a partir del ancho del nombre y de las fijas anteriores (en px). */
export function stickyOffsets(firstWidth: number, pinnedWidths: number[]): number[] {
  const out: number[] = [];
  let left = firstWidth;
  for (const width of pinnedWidths) {
    out.push(left);
    left += width;
  }
  return out;
}
