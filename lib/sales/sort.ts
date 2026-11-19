/**
 * El orden de la tabla de Ventas: qué columnas se ordenan, cómo viaja en la URL (`?orden=&dir=`) y cómo se comparan dos
 * ventas cuando el orden no lo puede hacer la base. Puro.
 *
 * Fecha y Monto se ordenan en la consulta (son columnas de `sales`). Cobrado, Pendiente y Próximo pago salen de los pagos:
 * se ordenan con la pasada completa que ya arman los totales del pie (`computeSalesTotals`), así ordenan TODAS las ventas
 * del filtro y no solo la página. Lo que no tiene valor (una venta sin próximo pago) queda siempre al final.
 */

export const SALES_SORT_KEYS = ["date", "amount", "paid", "pending", "next_payment"] as const;
export type SalesSortKey = (typeof SALES_SORT_KEYS)[number];
export type SortDir = "asc" | "desc";

export interface SalesSort {
  key: SalesSortKey;
  dir: SortDir;
}

export const DEFAULT_SALES_SORT: SalesSort = { key: "date", dir: "desc" };

/** El sentido con el que arranca cada columna al elegirla: el próximo pago, el más cercano primero; el resto, de mayor a menor. */
export const SALES_SORT_DEFAULT_DIR: Record<SalesSortKey, SortDir> = {
  date: "desc",
  amount: "desc",
  paid: "desc",
  pending: "desc",
  next_payment: "asc",
};

/** Las que ordena la base, con su columna de `sales`. */
export const DB_SORT_COLUMNS: Partial<Record<SalesSortKey, string>> = { date: "sale_date", amount: "final_amount" };

export const isDbSort = (sort: SalesSort): boolean => sort.key in DB_SORT_COLUMNS;

export const isDefaultSalesSort = (sort: SalesSort): boolean => sort.key === DEFAULT_SALES_SORT.key && sort.dir === DEFAULT_SALES_SORT.dir;

const first = (v: string | string[] | undefined): string | null => {
  const raw = Array.isArray(v) ? v[0] : v;
  return raw ? raw.trim() : null;
};

/** El orden desde la URL. Una columna desconocida vuelve al orden normal; un sentido desconocido, al de esa columna. */
export function parseSalesSort(params: Record<string, string | string[] | undefined>): SalesSort {
  const key = first(params.orden);
  if (!key || !(SALES_SORT_KEYS as readonly string[]).includes(key)) return { ...DEFAULT_SALES_SORT };
  const dir = first(params.dir);
  const k = key as SalesSortKey;
  return { key: k, dir: dir === "asc" || dir === "desc" ? dir : SALES_SORT_DEFAULT_DIR[k] };
}

/** Lo que va a la URL (el orden normal no escribe nada). */
export function salesSortToParams(sort: SalesSort, params: URLSearchParams): void {
  if (isDefaultSalesSort(sort)) return;
  params.set("orden", sort.key);
  params.set("dir", sort.dir);
}

/** Lo que se sabe de cada venta en la pasada completa. Plata en dólares; fechas `YYYY-MM-DD`. */
export interface SaleSummary {
  id: string;
  saleDate: string;
  amount: number;
  paid: number;
  pending: number;
  nextDue: string | null;
}

function valueOf(s: SaleSummary, key: SalesSortKey): number | string | null {
  switch (key) {
    case "date":
      return s.saleDate;
    case "amount":
      return s.amount;
    case "paid":
      return s.paid;
    case "pending":
      return s.pending;
    case "next_payment":
      return s.nextDue;
  }
}

/** Compara dos ventas: lo vacío siempre al final, desempate por fecha de venta (la más nueva primero) y por id. */
export function compareSaleSummaries(a: SaleSummary, b: SaleSummary, sort: SalesSort): number {
  const va = valueOf(a, sort.key);
  const vb = valueOf(b, sort.key);
  if (va !== vb) {
    if (va === null) return 1;
    if (vb === null) return -1;
    const cmp = va < vb ? -1 : 1;
    return sort.dir === "asc" ? cmp : -cmp;
  }
  if (a.saleDate !== b.saleDate) return a.saleDate < b.saleDate ? 1 : -1;
  return a.id.localeCompare(b.id);
}

/** Los ids de una página, ya ordenados. */
export function pageOfSortedIds(summaries: readonly SaleSummary[], sort: SalesSort, from: number, size: number): string[] {
  return [...summaries].sort((a, b) => compareSaleSummaries(a, b, sort)).slice(from, from + size).map((s) => s.id);
}
