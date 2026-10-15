/**
 * Aplica las condiciones del filtro de gastos a una consulta de supabase-js (SOLO servidor). Una sola función
 * para la lista, los totales, las pastillas y el CSV: así «lo que se exporta» es exactamente «lo que se ve».
 */
import { sanitizeSearch } from "@/lib/url-params";
import type { ExpenseCondition } from "./expense-filters";

type Builder = {
  eq: (column: string, value: string) => Builder;
  in: (column: string, values: readonly string[]) => Builder;
  gte: (column: string, value: string) => Builder;
  lte: (column: string, value: string) => Builder;
  ilike: (column: string, pattern: string) => Builder;
};

export function applyExpenseConditions<T>(query: T, conditions: readonly ExpenseCondition[]): T {
  let q = query as unknown as Builder;
  for (const c of conditions) {
    if (c.kind === "eq") q = q.eq(c.column, c.value);
    else if (c.kind === "in") q = q.in(c.column, c.values);
    else if (c.kind === "gte") q = q.gte(c.column, c.value);
    else if (c.kind === "lte") q = q.lte(c.column, c.value);
    else {
      const text = sanitizeSearch(c.value, 60);
      if (text) q = q.ilike(c.column, `%${text}%`);
    }
  }
  return q as unknown as T;
}
