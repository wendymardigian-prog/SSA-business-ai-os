/**
 * Todo el estado de la lista de comisiones vive en la URL (F59): `parseCommissionFilters` y
 * `serializeCommissionFilters` son puras y `serialize(parse(x)) === x` para una URL canónica. Mismo patrón que
 * `lib/finance/expense-filters.ts`.
 *
 * Los estados (`estado`) son los DERIVADOS de `status.ts`; la traducción a condiciones de la consulta es de
 * quien arma la lectura (el estado no se guarda).
 */
import { isDateOnly, monthEnd, monthStart, type CivilDate } from "@/lib/finance/dates";
import { COMMISSION_STATUS_KEYS, type CommissionStatusKey } from "./status";

export const COMMISSIONS_PAGE_SIZE = 50;

export const COMMISSION_PILLS = ["pendientes", "en_gasto", "pagadas_mes", "sin_persona", "anuladas"] as const;
export type CommissionPill = (typeof COMMISSION_PILLS)[number];

export const COMMISSION_PILL_LABELS: Record<CommissionPill, string> = {
  pendientes: "Pendientes",
  en_gasto: "En gasto",
  pagadas_mes: "Pagadas este mes",
  sin_persona: "Sin persona",
  anuladas: "Anuladas",
};

/** Los estados que cuenta cada pastilla («Pendientes» incluye a las retenidas). */
export const COMMISSION_PILL_STATUSES: Record<CommissionPill, readonly CommissionStatusKey[]> = {
  pendientes: ["pendiente", "retenida"],
  en_gasto: ["en_gasto"],
  pagadas_mes: ["pagada"],
  sin_persona: ["sin_persona"],
  anuladas: ["anulada"],
};

export const COMMISSION_GROUP_BY = ["persona", "rol", "mes", "producto", "estado", "gasto"] as const;
export type CommissionGroupBy = (typeof COMMISSION_GROUP_BY)[number];

export const COMMISSION_GROUP_BY_LABELS: Record<CommissionGroupBy, string> = {
  persona: "Persona",
  rol: "Rol",
  mes: "Mes del cobro",
  producto: "Producto",
  estado: "Estado",
  gasto: "Gasto",
};

export interface CommissionFilters {
  pill: CommissionPill | null;
  /** Personas a las que se les paga (varias). */
  users: string[];
  /** Claves de rol (varias). */
  roles: string[];
  statuses: CommissionStatusKey[];
  /** Mes del cobro `AAAA-MM`; si está, `from`/`to` no se usan. */
  month: string | null;
  from: CivilDate | null;
  to: CivilDate | null;
  products: string[];
  saleId: string | null;
  contactId: string | null;
  expenseId: string | null;
  ruleId: string | null;
  groupBy: CommissionGroupBy | null;
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
const MONTH = /^\d{4}-(0[1-9]|1[0-2])$/;
const uniq = <T>(list: T[]): T[] => [...new Set(list)];
const uuidOrNull = (raw: string | undefined): string | null => (raw && UUID.test(raw) ? raw : null);

export function emptyCommissionFilters(): CommissionFilters {
  return { pill: null, users: [], roles: [], statuses: [], month: null, from: null, to: null, products: [], saleId: null, contactId: null, expenseId: null, ruleId: null, groupBy: null, page: 1 };
}

export function parseCommissionFilters(params: Params): CommissionFilters {
  const pill = get(params, "pastilla");
  const groupBy = get(params, "agrupar");
  const month = get(params, "mes");
  const from = get(params, "desde");
  const to = get(params, "hasta");
  const page = Number(get(params, "pagina"));
  const monthOk = month && MONTH.test(month) ? month : null;
  return {
    pill: (COMMISSION_PILLS as readonly string[]).includes(pill ?? "") ? (pill as CommissionPill) : null,
    users: uniq(csv(get(params, "persona")).filter((v) => UUID.test(v))),
    roles: uniq(csv(get(params, "rol")).filter((k) => KEY.test(k))),
    statuses: uniq(only(COMMISSION_STATUS_KEYS, csv(get(params, "estado")))),
    month: monthOk,
    from: !monthOk && from && isDateOnly(from) ? from : null,
    to: !monthOk && to && isDateOnly(to) ? to : null,
    products: uniq(csv(get(params, "producto")).filter((v) => UUID.test(v))),
    saleId: uuidOrNull(get(params, "venta")),
    contactId: uuidOrNull(get(params, "contacto")),
    expenseId: uuidOrNull(get(params, "gasto")),
    ruleId: uuidOrNull(get(params, "regla")),
    groupBy: (COMMISSION_GROUP_BY as readonly string[]).includes(groupBy ?? "") ? (groupBy as CommissionGroupBy) : null,
    page: Number.isInteger(page) && page > 1 ? page : 1,
  };
}

/** A la forma canónica: claves en un orden fijo y sin los valores por defecto. */
export function serializeCommissionFilters(f: CommissionFilters): string {
  const out = new URLSearchParams();
  if (f.pill) out.set("pastilla", f.pill);
  if (f.users.length) out.set("persona", f.users.join(","));
  if (f.roles.length) out.set("rol", f.roles.join(","));
  if (f.statuses.length) out.set("estado", f.statuses.join(","));
  if (f.month) out.set("mes", f.month);
  else {
    if (f.from) out.set("desde", f.from);
    if (f.to) out.set("hasta", f.to);
  }
  if (f.products.length) out.set("producto", f.products.join(","));
  if (f.saleId) out.set("venta", f.saleId);
  if (f.contactId) out.set("contacto", f.contactId);
  if (f.expenseId) out.set("gasto", f.expenseId);
  if (f.ruleId) out.set("regla", f.ruleId);
  if (f.groupBy) out.set("agrupar", f.groupBy);
  if (f.page > 1) out.set("pagina", String(f.page));
  return out.toString();
}

export function countActiveCommissionFilters(f: CommissionFilters): number {
  return (
    (f.pill ? 1 : 0) + (f.users.length ? 1 : 0) + (f.roles.length ? 1 : 0) + (f.statuses.length ? 1 : 0) + (f.month || f.from || f.to ? 1 : 0) +
    (f.products.length ? 1 : 0) + (f.saleId ? 1 : 0) + (f.contactId ? 1 : 0) + (f.expenseId ? 1 : 0) + (f.ruleId ? 1 : 0)
  );
}

/** El rango de fechas de cobro del filtro (inclusivo), o null en cada extremo sin límite. */
export function paidRange(f: Pick<CommissionFilters, "month" | "from" | "to">): { from: CivilDate | null; to: CivilDate | null } {
  if (f.month) return { from: monthStart(f.month), to: monthEnd(f.month) };
  return { from: f.from, to: f.to };
}

/** Link de la lista con un filtro puesto (lo usan la venta, el gasto y el aviso de reversión). */
export function commissionsHref(patch: Partial<CommissionFilters>): string {
  const qs = serializeCommissionFilters({ ...emptyCommissionFilters(), ...patch });
  return `/dashboard/finanzas/comisiones${qs ? `?${qs}` : ""}`;
}

// ---------------------------------------------------------------------------------------------------------
// Totales
// ---------------------------------------------------------------------------------------------------------

export interface TotalsRow {
  status: CommissionStatusKey;
  /** Céntimos (negativo en un ajuste que resta). */
  amountCents: number;
}

export interface StatusTotals {
  byStatus: Record<CommissionStatusKey, { count: number; cents: number }>;
  /** Todo el filtro SIN las anuladas. */
  total: { count: number; cents: number };
}

/** Cuenta y suma en céntimos por estado, y el total sin anuladas. Recibe TODAS las filas del filtro, no la página. */
export function totalsByStatus(rows: readonly TotalsRow[]): StatusTotals {
  const byStatus = Object.fromEntries(COMMISSION_STATUS_KEYS.map((k) => [k, { count: 0, cents: 0 }])) as StatusTotals["byStatus"];
  const total = { count: 0, cents: 0 };
  for (const row of rows) {
    const bucket = byStatus[row.status];
    if (!bucket) continue;
    const cents = Math.round(Number(row.amountCents) || 0);
    bucket.count += 1;
    bucket.cents += cents;
    if (row.status !== "anulada") {
      total.count += 1;
      total.cents += cents;
    }
  }
  return { byStatus, total };
}
