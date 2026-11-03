/**
 * Las piezas con las que se arman los filtros y las columnas de la lista de
 * contactos. Solo tipos y ayudas puras: el catálogo (`catalog.ts`), las
 * columnas (`../columns.ts`) y cada área (`../related/*`) las usan.
 *
 * Un área (Agenda, Ventas, Formularios…) es un `ContactListModule`: trae sus
 * filtros, sus columnas, cómo cargar las opciones de sus filtros y cómo cargar
 * sus columnas para la página que se ve. Sumar un área es un archivo y una
 * línea en `../list-modules.ts`; la pantalla no cambia.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/types/database";
import type { MultiFilterOption } from "@/lib/ui/multi-filter";
import type { DatePreset } from "./dates";

export type ListClient = SupabaseClient<Database>;

// ---------------------------------------------------------------------------
// Las condiciones
// ---------------------------------------------------------------------------

export type ListClause =
  | { op: "eq" | "neq"; column: string; value: string | number | boolean }
  | { op: "in"; column: string; values: string[] }
  | { op: "is_null"; column: string }
  | { op: "not_null"; column: string }
  | { op: "ilike"; column: string; value: string }
  | { op: "gt" | "lt" | "gte" | "lte"; column: string; value: string | number }
  /**
   * Un `or` de PostgREST, ya armado. Solo con valores validados (uuid, claves,
   * listas cerradas). `table`: el alias del join cuando el `or` es sobre una
   * tabla relacionada (lo pone `relatedPlan`).
   */
  | { op: "or"; filter: string; table?: string };

/**
 * Una condición sobre una tabla relacionada (agendas, ventas…). Las de "tiene"
 * de la misma tabla van juntas en UN join: "una agenda confirmada de este
 * tipo" es una sola agenda que cumple las dos cosas. Cada "no tiene" va en su
 * propio anti-join.
 */
export interface RelatedCondition {
  /** La relación de PostgREST desde `contacts` (el nombre de la tabla). */
  relation: string;
  mode: "has" | "none";
  /** Las columnas que usan las condiciones (el join las pide). */
  columns: readonly string[];
  /** Condiciones sobre columnas de ESA tabla, sin prefijo. */
  clauses: readonly ListClause[];
}

export interface FilterPlanPart {
  clauses?: ListClause[];
  embeds?: string[];
  related?: RelatedCondition[];
}

/** Lo que el plan necesita saber del momento: los atajos de fecha se cuentan en la zona de quien mira. */
export interface PlanContext {
  now: Date;
  timeZone: string;
}

// ---------------------------------------------------------------------------
// Los filtros
// ---------------------------------------------------------------------------

export interface ListGroupDef {
  key: string;
  label: string;
  /** El orden en el panel y en el menú de columnas. */
  order: number;
}

/**
 * multi: varias opciones ("cualquiera de"), se repite el parámetro.
 * yesno: "si" o "no".
 * date: un atajo o un rango (`./dates.ts`).
 * choice: una sola opción de una lista cerrada, con un valor por defecto que no va en la URL.
 */
export type FilterKind = "multi" | "yesno" | "date" | "choice";

export type FilterOptions =
  /** Una lista fija (estados de una tabla, temperaturas…). */
  | { static: readonly MultiFilterOption[]; none?: string }
  /** Una lista que trae la página (`loadFilterOptions`): personas, etiquetas, productos… `none` suma "ninguno" arriba con esa etiqueta. */
  | { from: string; none?: string };

export interface ContactFilterDef {
  /** El parámetro de la URL. También es el id del filtro. */
  param: string;
  label: string;
  group: ListGroupDef;
  kind: FilterKind;
  /** ¿Este valor de la URL sirve? Lo inventado se ignora. */
  accepts(value: string): boolean;
  /** La parte de la consulta para los valores ya validados (nunca vacíos). */
  plan(values: readonly string[], ctx: PlanContext): FilterPlanPart;
  options?: FilterOptions;
  /** date: qué atajos ofrece y si se puede elegir un rango. */
  datePresets?: readonly DatePreset[];
  dateRange?: boolean;
  /** choice: cómo se llama el valor por defecto (sin parámetro). */
  defaultLabel?: string;
  /** El nombre en el chip cuando el del panel no alcanza solo ("Fuente (último toque)"). */
  chipLabel?: string;
  /** Palabras extra para el buscador del panel ("utm", "fecha"…). */
  keywords?: string;
  /** Una línea de ayuda debajo del nombre. */
  hint?: string;
  /** Los que no son de la tabla `contacts` se apoyan en otra: lo dice el panel. */
  related?: boolean;
}

export const YES_NO_VALUES = ["si", "no"] as const;
export type YesNo = (typeof YES_NO_VALUES)[number];
export const YES_NO_OPTIONS: MultiFilterOption[] = [
  { value: "si", label: "Sí" },
  { value: "no", label: "No" },
];

// ---------------------------------------------------------------------------
// Las columnas
// ---------------------------------------------------------------------------

/**
 * Lo que muestra una celda. Viaja del servidor al navegador, así que es solo
 * datos: el navegador lo dibuja con `components/contacts/contact-cell.tsx`
 * (las fechas en la zona y el idioma de quien mira).
 */
export type CellValue =
  | null
  | { t: "text"; text: string; sub?: string; title?: string; href?: string }
  | { t: "date"; at: string; mode: "relative" | "day" | "datetime"; sub?: string }
  | { t: "member"; userId: string }
  | { t: "badge"; text: string; tone: CellTone; sub?: string }
  | { t: "number"; n: number; sub?: string }
  | { t: "money"; cents: number; sub?: string }
  | { t: "list"; items: string[] };

export type CellTone = "green" | "red" | "amber" | "blue" | "muted";

/** id del contacto → clave de la columna → celda. */
export type CellMap = Record<string, Record<string, CellValue>>;

/** La fila cruda del contacto (`select *`). */
export type ContactRecord = Record<string, unknown>;

export interface ContactColumnDef {
  /** Lo que se guarda en las preferencias. Nunca cambia. */
  key: string;
  label: string;
  group: ListGroupDef;
  /** "Nombre" es la única fija. */
  hideable: boolean;
  /** Las que se veían antes del catálogo arrancan visibles; las nuevas, ocultas. */
  defaultVisible: boolean;
  /**
   * contact: sale de la fila del contacto (`cell`, en el servidor).
   * related: la carga su área solo para la página que se ve y solo si está visible.
   * special: la dibuja la tabla a mano (nombre, etiquetas, estado, producto…).
   */
  source: "contact" | "related" | "special";
  cell?: (row: ContactRecord) => CellValue;
  keywords?: string;
}

// ---------------------------------------------------------------------------
// Un área
// ---------------------------------------------------------------------------

export interface ContactListModule {
  key: string;
  filters: readonly ContactFilterDef[];
  columns: readonly ContactColumnDef[];
  /** Las opciones de sus filtros (`FilterOptions.from`). Con el cliente del usuario: la RLS decide. */
  loadOptions?(supabase: ListClient, workspaceId: string): Promise<Record<string, MultiFilterOption[]>>;
  /** Sus columnas para estos contactos. Solo se llama con columnas suyas que estén visibles. */
  loadCells?(supabase: ListClient, workspaceId: string, contactIds: readonly string[], keys: readonly string[]): Promise<CellMap>;
}

// ---------------------------------------------------------------------------
// Ayudas para armar filtros
// ---------------------------------------------------------------------------

export const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** "ninguno" en un filtro: sin estado, sin producto, sin asignar. */
export const NONE = "ninguno";

/**
 * Un texto libre (una campaña, un país): sin comillas, barras ni caracteres de
 * control, y con tope. Va siempre por `.in()`, nunca adentro de un `or` armado a mano.
 */
export function isSafeText(value: string): boolean {
  return value.length > 0 && value.length <= 150 && !/["\\\u0000-\u001f]/.test(value);
}

export const isYesNo = (v: string) => v === "si" || v === "no";

/**
 * Una columna filtrada por una lista que puede traer "ninguno": solo "ninguno"
 * es `is null`, solo valores es `in`, y los dos juntos un `or` (solo con
 * valores ya validados como uuid o clave).
 */
export function noneOrIn(column: string, values: readonly string[]): ListClause | null {
  if (values.length === 0) return null;
  const hasNone = values.includes(NONE);
  const rest = values.filter((v) => v !== NONE);
  if (hasNone && rest.length === 0) return { op: "is_null", column };
  if (!hasNone) return { op: "in", column, values: rest };
  return { op: "or", filter: `${column}.is.null,${column}.in.(${rest.join(",")})` };
}

/** Las condiciones de un rango de fechas sobre una columna. */
export function boundsClauses(column: string, b: { gte?: string; lte?: string; lt?: string; isNull?: boolean; notNull?: boolean }): ListClause[] {
  const out: ListClause[] = [];
  if (b.isNull) out.push({ op: "is_null", column });
  if (b.notNull) out.push({ op: "not_null", column });
  if (b.gte) out.push({ op: "gte", column, value: b.gte });
  if (b.lte) out.push({ op: "lte", column, value: b.lte });
  if (b.lt) out.push({ op: "lt", column, value: b.lt });
  return out;
}

/** Agrupa filas por contacto (para cargar columnas por página). */
export function byContact<T extends { contact_id: string | null }>(rows: readonly T[] | null | undefined): Map<string, T[]> {
  const out = new Map<string, T[]>();
  for (const r of rows ?? []) {
    if (!r.contact_id) continue;
    const list = out.get(r.contact_id) ?? [];
    list.push(r);
    out.set(r.contact_id, list);
  }
  return out;
}

/** Las celdas de un área para estos contactos, con todas las columnas pedidas (vacías si no hay nada). */
export function fillCells(contactIds: readonly string[], keys: readonly string[], build: (id: string) => Record<string, CellValue>): CellMap {
  const out: CellMap = {};
  for (const id of contactIds) {
    const built = build(id);
    const row: Record<string, CellValue> = {};
    for (const k of keys) row[k] = built[k] ?? null;
    out[id] = row;
  }
  return out;
}

export const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;
