/**
 * Los filtros de la lista de contactos y la consulta que arman: UN solo lugar.
 *
 * Lo usan la tabla, el Kanban y "cargar más" de una columna del Kanban. Así lo
 * que se filtra en una vista es exactamente lo que se ve en la otra.
 *
 * Dos pasos, los dos puros:
 *
 * 1. `parseContactListFilters` lee la URL. Todo lo que viene de ahí lo escribe
 *    cualquiera, así que se valida antes de llegar a la consulta: un id tiene que
 *    tener forma de uuid, un estado la forma de una clave, un valor de una lista
 *    cerrada tiene que estar en la lista. Lo inventado se ignora en vez de romper.
 * 2. `contactListPlan` devuelve los joins (embeds) y las condiciones. La página
 *    los aplica con `contactListSelect` y `applyListClauses`.
 *
 * Multiselección: un filtro de varias opciones se escribe repitiendo el
 * parámetro (`?setter=a&setter=b`) y significa "cualquiera de". Un link viejo
 * con un solo valor (`?setter=a`) sigue funcionando igual. "ninguno" junto con
 * otros valores = "sin asignar O alguno de estos".
 *
 * No importa nada de `next/*` ni de Supabase: se prueba sin base.
 */

import { firstParam, listParam, pickEnum, type SearchParams } from "@/lib/url-params";
import { LEAD_TEMPERATURES } from "./fields";
import { MEDIUMS, SOURCES, type KnownMedium, type KnownSource } from "./taxonomy";
import { STATUS_KEY_RE, parseLastStatusParam, type StatusRole } from "./statuses";
import { NONE, customFilterPlan, parseCustomFilter, type CustomFieldRef, type CustomFilter } from "./list-filters";
import { EMAIL_STATUSES, type EmailStatus } from "@/lib/email/subscription";
import { isSupportedPlatform } from "@/lib/platforms";
import type { LeadTemperature } from "@/lib/types/database";

export { NONE };

/** "" oculta los anónimos (default), "1" los suma, "solo" muestra solo esos. */
export const ANON_FILTER_VALUES = ["", "1", "solo"] as const;
export type AnonFilter = (typeof ANON_FILTER_VALUES)[number];

/** Cada filtro y su parámetro de la URL. "Limpiar filtros" y el contador salen de acá. */
export const CONTACT_FILTER_PARAMS = {
  tagIds: "tag",
  setterIds: "setter",
  vendedorIds: "vendedor",
  temperatures: "temp",
  platforms: "canal",
  anon: "anon",
  sources: "fuente",
  mediums: "medio",
  lastStatuses: "estado",
  setterStatuses: "estado_setter",
  closerStatuses: "estado_vendedor",
  productIds: "producto",
  emailStatuses: "email",
} as const;

/** Los del filtro por campo personalizado: tres parámetros que van juntos. */
export const CUSTOM_FILTER_PARAMS = ["campo", "op", "valor"] as const;

/** Todo lo que vive adentro del menú de filtros (la búsqueda y el orden no). */
export const MENU_FILTER_PARAMS: readonly string[] = [...Object.values(CONTACT_FILTER_PARAMS), ...CUSTOM_FILTER_PARAMS];

export interface ContactListFilters {
  search: string;
  /** Tiene alguna de estas etiquetas. */
  tagIds: string[];
  /** Ids de personas, o "ninguno" (sin asignar). */
  setterIds: string[];
  vendedorIds: string[];
  temperatures: LeadTemperature[];
  /** Tiene una conversación por alguno de estos canales. */
  platforms: string[];
  anon: AnonFilter;
  /** Fuente y medio del PRIMER toque (F88). */
  sources: KnownSource[];
  mediums: KnownMedium[];
  /** El ÚLTIMO estado, como pares rol + clave. */
  lastStatuses: Array<{ role: StatusRole; key: string }>;
  /** Claves de estado, o "ninguno" (sin estado). */
  setterStatuses: string[];
  closerStatuses: string[];
  /** Ids de producto de interés, o "ninguno". */
  productIds: string[];
  emailStatuses: EmailStatus[];
  custom: CustomFilter | null;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Una lista que se queda solo con lo que pasa la prueba. */
function keep(value: SearchParams[string], test: (v: string) => boolean): string[] {
  return listParam(value).filter(test);
}

function enumList<T extends string>(value: SearchParams[string], allowed: readonly T[]): T[] {
  return keep(value, (v) => (allowed as readonly string[]).includes(v)) as T[];
}

const idOrNone = (v: string) => v === NONE || UUID.test(v);
const statusOrNone = (v: string) => v === NONE || STATUS_KEY_RE.test(v);

export function parseContactListFilters(
  params: SearchParams,
  customFields: readonly CustomFieldRef[],
  search = "",
): ContactListFilters {
  const p = CONTACT_FILTER_PARAMS;
  const lastStatuses: ContactListFilters["lastStatuses"] = [];
  for (const raw of listParam(params[p.lastStatuses])) {
    const parsed = parseLastStatusParam(raw);
    if (parsed) lastStatuses.push(parsed);
  }
  return {
    search,
    tagIds: keep(params[p.tagIds], (v) => UUID.test(v)),
    setterIds: keep(params[p.setterIds], idOrNone),
    vendedorIds: keep(params[p.vendedorIds], idOrNone),
    temperatures: enumList(params[p.temperatures], LEAD_TEMPERATURES),
    platforms: keep(params[p.platforms], isSupportedPlatform),
    anon: pickEnum(params[p.anon], ANON_FILTER_VALUES),
    sources: enumList(params[p.sources], SOURCES),
    mediums: enumList(params[p.mediums], MEDIUMS),
    lastStatuses,
    setterStatuses: keep(params[p.setterStatuses], statusOrNone),
    closerStatuses: keep(params[p.closerStatuses], statusOrNone),
    productIds: keep(params[p.productIds], idOrNone),
    emailStatuses: enumList(params[p.emailStatuses], EMAIL_STATUSES),
    custom: parseCustomFilter(params, customFields),
  };
}

/** El valor crudo del filtro por campo personalizado, para volver a dibujar el control. */
export function customFilterRawValue(params: SearchParams): string {
  return firstParam(params.valor);
}

/**
 * Cuántos filtros del menú hay puestos (cada filtro cuenta uno, tenga una o
 * varias opciones). La búsqueda no cuenta: tiene su propio indicador en la lupa.
 */
export function countMenuFilters(f: ContactListFilters): number {
  const lists = [
    f.tagIds, f.setterIds, f.vendedorIds, f.temperatures, f.platforms, f.sources, f.mediums,
    f.lastStatuses, f.setterStatuses, f.closerStatuses, f.productIds, f.emailStatuses,
  ];
  return lists.filter((l) => l.length > 0).length + (f.anon ? 1 : 0) + (f.custom ? 1 : 0);
}

export const countActiveFilters = (f: ContactListFilters) => countMenuFilters(f) + (f.search ? 1 : 0);

// ---------------------------------------------------------------------------
// La consulta
// ---------------------------------------------------------------------------

export type ListClause =
  | { op: "eq"; column: string; value: string | number | boolean }
  | { op: "in"; column: string; values: string[] }
  | { op: "is_null"; column: string }
  | { op: "not_null"; column: string }
  | { op: "ilike"; column: string; value: string }
  | { op: "gt" | "lt"; column: string; value: string | number }
  /** Un `or` de PostgREST, ya armado. Solo con valores validados (uuid, claves, listas cerradas). */
  | { op: "or"; filter: string };

export interface ContactListPlan {
  /** Los joins extra del select, ya con su alias. */
  embeds: string[];
  clauses: ListClause[];
}

/** Las primeras rutas de atribución: las mismas de los índices de la 00114. */
export const FIRST_TOUCH_SOURCE_PATH = "attribution->first_touch->>source";
export const FIRST_TOUCH_MEDIUM_PATH = "attribution->first_touch->>medium";

/**
 * Una columna filtrada por una lista que puede traer "ninguno": solo "ninguno"
 * es `is null`, solo valores es `in`, y los dos juntos un `or`.
 */
function noneOrIn(column: string, values: readonly string[]): ListClause | null {
  if (values.length === 0) return null;
  const hasNone = values.includes(NONE);
  const rest = values.filter((v) => v !== NONE);
  if (hasNone && rest.length === 0) return { op: "is_null", column };
  if (!hasNone) return { op: "in", column, values: rest };
  return { op: "or", filter: `${column}.is.null,${column}.in.(${rest.join(",")})` };
}

/**
 * Los joins y las condiciones de la lista.
 *
 * Los joins con alias (`tag_match`, `channel_match`, `cf_match`) recortan QUÉ
 * contactos vuelven sin tocar el `contact_tags` que trae todas las etiquetas
 * de cada uno. `searchFilter` es el `or` ya armado de la búsqueda
 * (`contactSearchFilter`), que necesita una consulta previa y por eso no se
 * arma acá.
 */
export function contactListPlan(f: ContactListFilters, searchFilter?: string | null): ContactListPlan {
  const embeds: string[] = [];
  const clauses: ListClause[] = [];
  const push = (c: ListClause | null) => {
    if (c) clauses.push(c);
  };

  if (searchFilter) clauses.push({ op: "or", filter: searchFilter });

  if (f.tagIds.length > 0) {
    embeds.push("tag_match:contact_tags!inner(tag_id)");
    clauses.push({ op: "in", column: "tag_match.tag_id", values: f.tagIds });
  }
  if (f.platforms.length > 0) {
    embeds.push("channel_match:contact_channels!inner(channels!inner(platform))");
    clauses.push({ op: "in", column: "channel_match.channels.platform", values: f.platforms });
  }

  push(noneOrIn("setter_id", f.setterIds));
  push(noneOrIn("vendedor_id", f.vendedorIds));
  if (f.temperatures.length > 0) clauses.push({ op: "in", column: "lead_temperature", values: f.temperatures });
  if (f.sources.length > 0) clauses.push({ op: "in", column: FIRST_TOUCH_SOURCE_PATH, values: f.sources });
  if (f.mediums.length > 0) clauses.push({ op: "in", column: FIRST_TOUCH_MEDIUM_PATH, values: f.mediums });

  if (f.lastStatuses.length === 1) {
    const [only] = f.lastStatuses;
    clauses.push({ op: "eq", column: "last_status_role", value: only.role });
    clauses.push({ op: "eq", column: "last_status", value: only.key });
  } else if (f.lastStatuses.length > 1) {
    const parts = f.lastStatuses.map((s) => `and(last_status_role.eq.${s.role},last_status.eq.${s.key})`);
    clauses.push({ op: "or", filter: parts.join(",") });
  }
  push(noneOrIn("setter_status", f.setterStatuses));
  push(noneOrIn("closer_status", f.closerStatuses));
  push(noneOrIn("interest_product_id", f.productIds));
  if (f.emailStatuses.length > 0) clauses.push({ op: "in", column: "email_status", values: f.emailStatuses });

  // Por campo personalizado (00244): un join interno con la condición, o un
  // anti-join para "está vacío" (el contacto no tiene fila para ese campo).
  if (f.custom) {
    const plan = customFilterPlan(f.custom);
    embeds.push(plan.join === "anti" ? "cf_match:contact_custom_fields(field_id)" : "cf_match:contact_custom_fields!inner(field_id)");
    clauses.push({ op: "eq", column: "cf_match.field_id", value: plan.fieldId });
    if (plan.join === "anti") clauses.push({ op: "is_null", column: "cf_match" });
    else {
      const column = `cf_match.${plan.column}`;
      if (plan.op === "not_null") clauses.push({ op: "not_null", column });
      else if (plan.op === "ilike") clauses.push({ op: "ilike", column, value: String(plan.value) });
      else if (plan.op === "gt" || plan.op === "lt") clauses.push({ op: plan.op, column, value: plan.value as string | number });
      else clauses.push({ op: "eq", column, value: plan.value as string | number });
    }
  }

  // Los contactos sin datos se ocultan por defecto: son más de la mitad de la
  // tabla y no se puede trabajar con ellos hasta que la persona responda.
  if (f.anon === "solo") clauses.push({ op: "eq", column: "is_anonymous", value: true });
  else if (f.anon !== "1") clauses.push({ op: "eq", column: "is_anonymous", value: false });

  return { embeds, clauses };
}

/** El select completo: la base de la vista más los joins del plan. */
export function contactListSelect(base: string, plan: ContactListPlan): string {
  return [base, ...plan.embeds].join(", ");
}

/** Lo mínimo del constructor de PostgREST que usan las condiciones. */
interface Filterable {
  eq(column: string, value: unknown): Filterable;
  in(column: string, values: readonly unknown[]): Filterable;
  is(column: string, value: null): Filterable;
  not(column: string, operator: string, value: unknown): Filterable;
  ilike(column: string, pattern: string): Filterable;
  gt(column: string, value: unknown): Filterable;
  lt(column: string, value: unknown): Filterable;
  or(filter: string): Filterable;
}

/** Aplica las condiciones a una consulta de Supabase y la devuelve con su mismo tipo. */
export function applyListClauses<Q>(query: Q, clauses: readonly ListClause[]): Q {
  let q = query as unknown as Filterable;
  for (const c of clauses) {
    switch (c.op) {
      case "eq":
        q = q.eq(c.column, c.value);
        break;
      case "in":
        q = q.in(c.column, c.values);
        break;
      case "is_null":
        q = q.is(c.column, null);
        break;
      case "not_null":
        q = q.not(c.column, "is", null);
        break;
      case "ilike":
        q = q.ilike(c.column, c.value);
        break;
      case "gt":
        q = q.gt(c.column, c.value);
        break;
      case "lt":
        q = q.lt(c.column, c.value);
        break;
      case "or":
        q = q.or(c.filter);
        break;
    }
  }
  return q as unknown as Q;
}
