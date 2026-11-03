/**
 * Los filtros de la lista de contactos y la consulta que arman: UN solo lugar.
 *
 * Lo usan la tabla, el Kanban y "cargar más" de una columna del Kanban. Así lo
 * que se filtra en una vista es exactamente lo que se ve en la otra.
 *
 * Qué filtros existen lo dice el catálogo (`filters/catalog.ts` y las áreas de
 * `list-modules.ts`). Acá hay dos pasos, los dos puros:
 *
 * 1. `parseContactListFilters` lee la URL. Todo lo que viene de ahí lo escribe
 *    cualquiera, así que cada valor pasa por el `accepts` de su filtro: un id
 *    tiene que tener forma de uuid, un estado la forma de una clave, un valor de
 *    una lista cerrada tiene que estar en la lista. Lo inventado se ignora.
 * 2. `contactListPlan` devuelve los joins (embeds) y las condiciones. La página
 *    los aplica con `contactListSelect` y `applyListClauses`.
 *
 * Multiselección: un filtro de varias opciones se escribe repitiendo el
 * parámetro (`?setter=a&setter=b`) y significa "cualquiera de". Un link viejo
 * con un solo valor (`?setter=a`) sigue funcionando igual. "ninguno" junto con
 * otros valores = "sin asignar O alguno de estos".
 *
 * Registros relacionados (agendas, ventas…): "tiene" es un join interno
 * (`tabla!inner`) y todas las condiciones de "tiene" sobre la misma tabla van
 * en el mismo join, así "agenda confirmada + de este tipo" es UNA agenda que
 * cumple las dos. "No tiene" es un anti-join (un join sin `!inner` y
 * `is null`). Los dos respetan la RLS de la tabla relacionada.
 *
 * No importa nada de `next/*` ni de Supabase: se prueba sin base.
 */

import { firstParam, listParam, type SearchParams } from "@/lib/url-params";
import { customFilterPlan, parseCustomFilter, type CustomFieldRef, type CustomFilter } from "./list-filters";
import { ANON_FILTER_VALUES, CUSTOM_FILTER_PARAMS, type AnonFilter } from "./filters/catalog";
import { CONTACT_FILTERS } from "./list-modules";
import { NONE, type ContactFilterDef, type ListClause, type PlanContext, type RelatedCondition } from "./filters/types";

export { NONE, ANON_FILTER_VALUES, CUSTOM_FILTER_PARAMS };
export type { AnonFilter, ListClause, PlanContext };
export { FIRST_TOUCH_MEDIUM_PATH, FIRST_TOUCH_SOURCE_PATH } from "./filters/catalog";

/** Todo lo que vive adentro del menú de filtros (la búsqueda, el orden y la vista no). */
export const MENU_FILTER_PARAMS: readonly string[] = [...CONTACT_FILTERS.map((f) => f.param), ...CUSTOM_FILTER_PARAMS];

export interface ContactListFilters {
  search: string;
  /** Parámetro del filtro → valores ya validados. Solo están los que tienen algo. */
  values: Readonly<Record<string, readonly string[]>>;
  /** "" oculta los contactos sin datos (el default). */
  anon: AnonFilter;
  custom: CustomFilter | null;
}

/** Los valores puestos de un filtro (vacío si no está). */
export function filterValues(f: ContactListFilters, param: string): readonly string[] {
  return f.values[param] ?? [];
}

function readFilter(def: ContactFilterDef, raw: SearchParams[string]): string[] {
  if (def.kind === "multi") return listParam(raw).filter((v) => def.accepts(v));
  const one = firstParam(raw);
  return one && def.accepts(one) ? [one] : [];
}

export function parseContactListFilters(
  params: SearchParams,
  customFields: readonly CustomFieldRef[],
  search = "",
  defs: readonly ContactFilterDef[] = CONTACT_FILTERS,
): ContactListFilters {
  const values: Record<string, string[]> = {};
  for (const def of defs) {
    const read = readFilter(def, params[def.param]);
    if (read.length > 0) values[def.param] = read;
  }
  const anon = (values.anon?.[0] ?? "") as AnonFilter;
  return { search, values, anon: ANON_FILTER_VALUES.includes(anon) ? anon : "", custom: parseCustomFilter(params, customFields) };
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
  return Object.values(f.values).filter((v) => v.length > 0).length + (f.custom ? 1 : 0);
}

export const countActiveFilters = (f: ContactListFilters) => countMenuFilters(f) + (f.search ? 1 : 0);

// ---------------------------------------------------------------------------
// La consulta
// ---------------------------------------------------------------------------

export interface ContactListPlan {
  /** Los joins extra del select, ya con su alias. */
  embeds: string[];
  clauses: ListClause[];
}

const prefixed = (alias: string, c: ListClause): ListClause => ("column" in c ? { ...c, column: `${alias}.${c.column}` } : c);

/**
 * Los joins de las condiciones sobre tablas relacionadas. Las "tiene" de una
 * misma tabla se juntan en un solo join; cada "no tiene" lleva el suyo.
 */
export function relatedPlan(conditions: readonly RelatedCondition[]): ContactListPlan {
  const embeds: string[] = [];
  const clauses: ListClause[] = [];
  const has = new Map<string, { columns: Set<string>; clauses: ListClause[] }>();
  let none = 0;
  for (const cond of conditions) {
    if (cond.mode === "has") {
      const entry = has.get(cond.relation) ?? { columns: new Set<string>(), clauses: [] };
      for (const col of cond.columns) entry.columns.add(col);
      entry.clauses.push(...cond.clauses);
      has.set(cond.relation, entry);
      continue;
    }
    none += 1;
    const alias = `sin_${cond.relation}_${none}`;
    embeds.push(`${alias}:${cond.relation}(${[...new Set(cond.columns)].join(",")})`);
    clauses.push(...cond.clauses.map((c) => prefixed(alias, c)), { op: "is_null", column: alias });
  }
  for (const [relation, entry] of has) {
    const alias = `con_${relation}`;
    embeds.push(`${alias}:${relation}!inner(${[...entry.columns].join(",")})`);
    clauses.push(...entry.clauses.map((c) => prefixed(alias, c)));
  }
  return { embeds, clauses };
}

/**
 * Los joins y las condiciones de la lista.
 *
 * `searchFilter` es el `or` ya armado de la búsqueda (`contactSearchFilter`),
 * que necesita una consulta previa y por eso no se arma acá.
 */
export function contactListPlan(
  f: ContactListFilters,
  searchFilter?: string | null,
  ctx: PlanContext = { now: new Date(), timeZone: "UTC" },
  defs: readonly ContactFilterDef[] = CONTACT_FILTERS,
): ContactListPlan {
  const embeds: string[] = [];
  const clauses: ListClause[] = [];
  const related: RelatedCondition[] = [];

  if (searchFilter) clauses.push({ op: "or", filter: searchFilter });

  for (const def of defs) {
    const values = f.values[def.param];
    if (!values || values.length === 0) continue;
    const part = def.plan(values, ctx);
    if (part.embeds) embeds.push(...part.embeds);
    if (part.clauses) clauses.push(...part.clauses);
    if (part.related) related.push(...part.related);
  }

  const rel = relatedPlan(related);
  embeds.push(...rel.embeds);
  clauses.push(...rel.clauses);

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
  neq(column: string, value: unknown): Filterable;
  in(column: string, values: readonly unknown[]): Filterable;
  is(column: string, value: null): Filterable;
  not(column: string, operator: string, value: unknown): Filterable;
  ilike(column: string, pattern: string): Filterable;
  gt(column: string, value: unknown): Filterable;
  lt(column: string, value: unknown): Filterable;
  gte(column: string, value: unknown): Filterable;
  lte(column: string, value: unknown): Filterable;
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
      case "neq":
        q = q.neq(c.column, c.value);
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
      case "gte":
        q = q.gte(c.column, c.value);
        break;
      case "lte":
        q = q.lte(c.column, c.value);
        break;
      case "or":
        q = q.or(c.filter);
        break;
    }
  }
  return q as unknown as Q;
}
