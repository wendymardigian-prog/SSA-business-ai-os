/**
 * Todo el estado de la lista de gastos vive en la URL (GF12): `parseExpenseFilters` y
 * `serializeExpenseFilters` son puras y `serialize(parse(x)) === x` para una URL canónica. Copiar el link
 * muestra lo mismo en otra pestaña.
 */
import { CATEGORY_GROUPS, type CategoryGroup, type ExpenseCategory } from "./categories";
import { isDateOnly, monthEnd, monthKey, monthStart, weekEnd, type CivilDate } from "./dates";
import { EXPENSE_ORIGINS, EXPENSE_STATUS_KEYS, type ExpenseOrigin, type ExpenseStatus } from "./expense-status";

export const EXPENSES_PAGE_SIZE = 50;

export const EXPENSE_PILLS = ["por_pagar_semana", "vencidos", "pagados_mes", "por_revisar"] as const;
export type ExpensePill = (typeof EXPENSE_PILLS)[number];

export const EXPENSE_PILL_LABELS: Record<ExpensePill, string> = {
  por_pagar_semana: "Por pagar esta semana",
  vencidos: "Vencidos",
  pagados_mes: "Pagados este mes",
  por_revisar: "Por revisar",
};

export const GROUP_BY_OPTIONS = ["categoria", "proveedor"] as const;
export type GroupBy = (typeof GROUP_BY_OPTIONS)[number];

/** Sobre qué fecha se aplica el rango. */
export const DATE_FIELDS = ["programada", "pago"] as const;
export type DateField = (typeof DATE_FIELDS)[number];

export interface ExpenseFilters {
  pill: ExpensePill | null;
  statuses: ExpenseStatus[];
  categories: string[];
  group: CategoryGroup | null;
  vendors: string[];
  origins: ExpenseOrigin[];
  dateField: DateField;
  from: CivilDate | null;
  to: CivilDate | null;
  responsibleId: string | null;
  q: string;
  groupBy: GroupBy | null;
  page: number;
}

type Params = Record<string, string | string[] | undefined> | URLSearchParams;

function get(params: Params, key: string): string | undefined {
  if (params instanceof URLSearchParams) return params.get(key) ?? undefined;
  const v = params[key];
  return Array.isArray(v) ? v[0] : v;
}

const csv = (raw: string | undefined): string[] => (raw ?? "").split(",").map((s) => s.trim()).filter(Boolean);
const only = <T extends string>(values: readonly T[], list: string[]): T[] => list.filter((v): v is T => (values as readonly string[]).includes(v));
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const KEY = /^[a-z0-9_]{2,40}$/;

export function emptyExpenseFilters(): ExpenseFilters {
  return { pill: null, statuses: [], categories: [], group: null, vendors: [], origins: [], dateField: "programada", from: null, to: null, responsibleId: null, q: "", groupBy: null, page: 1 };
}

export function parseExpenseFilters(params: Params): ExpenseFilters {
  const pill = get(params, "pastilla");
  const group = get(params, "grupo");
  const groupBy = get(params, "agrupar");
  const dateField = get(params, "fecha");
  const from = get(params, "desde");
  const to = get(params, "hasta");
  const responsible = get(params, "responsable");
  const page = Number(get(params, "pagina"));
  return {
    pill: (EXPENSE_PILLS as readonly string[]).includes(pill ?? "") ? (pill as ExpensePill) : null,
    statuses: only(EXPENSE_STATUS_KEYS, csv(get(params, "estado"))),
    categories: csv(get(params, "categoria")).filter((k) => KEY.test(k)),
    group: (CATEGORY_GROUPS as readonly string[]).includes(group ?? "") ? (group as CategoryGroup) : null,
    vendors: csv(get(params, "proveedor")).filter((v) => UUID.test(v)),
    origins: only(EXPENSE_ORIGINS, csv(get(params, "origen"))),
    dateField: dateField === "pago" ? "pago" : "programada",
    from: from && isDateOnly(from) ? from : null,
    to: to && isDateOnly(to) ? to : null,
    responsibleId: responsible && UUID.test(responsible) ? responsible : null,
    q: (get(params, "q") ?? "").trim().slice(0, 60),
    groupBy: (GROUP_BY_OPTIONS as readonly string[]).includes(groupBy ?? "") ? (groupBy as GroupBy) : null,
    page: Number.isInteger(page) && page > 1 ? page : 1,
  };
}

/** A la forma canónica: claves en un orden fijo y sin los valores por defecto. */
export function serializeExpenseFilters(f: ExpenseFilters): string {
  const out = new URLSearchParams();
  if (f.pill) out.set("pastilla", f.pill);
  if (f.statuses.length) out.set("estado", f.statuses.join(","));
  if (f.categories.length) out.set("categoria", f.categories.join(","));
  if (f.group) out.set("grupo", f.group);
  if (f.vendors.length) out.set("proveedor", f.vendors.join(","));
  if (f.origins.length) out.set("origen", f.origins.join(","));
  if (f.dateField !== "programada") out.set("fecha", f.dateField);
  if (f.from) out.set("desde", f.from);
  if (f.to) out.set("hasta", f.to);
  if (f.responsibleId) out.set("responsable", f.responsibleId);
  if (f.q) out.set("q", f.q);
  if (f.groupBy) out.set("agrupar", f.groupBy);
  if (f.page > 1) out.set("pagina", String(f.page));
  return out.toString();
}

export function countActiveExpenseFilters(f: ExpenseFilters): number {
  return (
    (f.pill ? 1 : 0) + (f.statuses.length ? 1 : 0) + (f.categories.length ? 1 : 0) + (f.group ? 1 : 0) + (f.vendors.length ? 1 : 0) +
    (f.origins.length ? 1 : 0) + (f.from || f.to ? 1 : 0) + (f.responsibleId ? 1 : 0) + (f.q ? 1 : 0)
  );
}

/** Una condición sobre la columna de la tabla, lista para aplicar con supabase-js. */
export type ExpenseCondition =
  | { kind: "in"; column: string; values: readonly string[] }
  | { kind: "eq"; column: string; value: string }
  | { kind: "gte"; column: string; value: string }
  | { kind: "lte"; column: string; value: string }
  | { kind: "ilike"; column: string; value: string };

/** La traducción de una pastilla a condiciones. */
export function pillConditions(pill: ExpensePill, todayLocal: CivilDate): ExpenseCondition[] {
  switch (pill) {
    case "por_pagar_semana":
      return [
        { kind: "eq", column: "status", value: "programado" },
        { kind: "gte", column: "scheduled_date", value: todayLocal },
        { kind: "lte", column: "scheduled_date", value: weekEnd(todayLocal) },
      ];
    case "vencidos":
      return [{ kind: "eq", column: "status", value: "vencido" }];
    case "pagados_mes":
      return [
        { kind: "eq", column: "status", value: "pagado" },
        { kind: "gte", column: "paid_date", value: monthStart(monthKey(todayLocal)) },
        { kind: "lte", column: "paid_date", value: monthEnd(monthKey(todayLocal)) },
      ];
    case "por_revisar":
      return [{ kind: "eq", column: "status", value: "por_revisar" }];
  }
}

/** Las categorías de un grupo (HOY: el grupo se lee de la categoría, no se copia al gasto). */
export function categoryKeysOfGroup(categories: readonly ExpenseCategory[], group: CategoryGroup): string[] {
  return categories.filter((c) => c.group === group).map((c) => c.key);
}

/** Todas las condiciones del filtro. Una consulta nunca ve más ni menos que `exportRows`. */
export function expenseConditions(f: ExpenseFilters, todayLocal: CivilDate, categories: readonly ExpenseCategory[]): ExpenseCondition[] {
  const out: ExpenseCondition[] = f.pill ? pillConditions(f.pill, todayLocal) : [];
  if (f.statuses.length) out.push({ kind: "in", column: "status", values: f.statuses });
  let keys = f.categories;
  if (f.group) {
    const inGroup = categoryKeysOfGroup(categories, f.group);
    keys = keys.length ? keys.filter((k) => inGroup.includes(k)) : inGroup;
  }
  if (f.group || f.categories.length) out.push({ kind: "in", column: "category_key", values: keys.length ? keys : ["__ninguna__"] });
  if (f.vendors.length) out.push({ kind: "in", column: "vendor_id", values: f.vendors });
  if (f.origins.length) out.push({ kind: "in", column: "origin", values: f.origins });
  const dateColumn = f.dateField === "pago" ? "paid_date" : "scheduled_date";
  if (f.from) out.push({ kind: "gte", column: dateColumn, value: f.from });
  if (f.to) out.push({ kind: "lte", column: dateColumn, value: f.to });
  if (f.responsibleId) out.push({ kind: "eq", column: "responsible_id", value: f.responsibleId });
  if (f.q) out.push({ kind: "ilike", column: "concept", value: f.q });
  return out;
}

/** Link de la lista con un filtro puesto (lo usan el panel y las fichas). */
export function expensesHref(patch: Partial<ExpenseFilters>): string {
  const qs = serializeExpenseFilters({ ...emptyExpenseFilters(), ...patch });
  return `/dashboard/finanzas/gastos${qs ? `?${qs}` : ""}`;
}
