// @plantilla-quitar(servicios)
/** Clientes › Clientes (F27): una fila por contacto con al menos un servicio visible. Puro. */
import type { ServiceStatus } from "./list";

export interface ClientServiceFact {
  contactId: string;
  status: ServiceStatus;
  saleId: string | null;
}
export interface ClientRow {
  contactId: string;
  servicesLabel: string;
  saleIds: string[];
  total: number;
  active: number;
}

/** «2 · 1 activo». Los cancelados cuentan en el total. */
export function clientRows(services: ClientServiceFact[]): ClientRow[] {
  const by = new Map<string, ClientRow>();
  for (const s of services) {
    const row = by.get(s.contactId) ?? { contactId: s.contactId, servicesLabel: "", saleIds: [], total: 0, active: 0 };
    row.total++;
    if (s.status === "active" || s.status === "paused") row.active++;
    if (s.saleId && !row.saleIds.includes(s.saleId)) row.saleIds.push(s.saleId);
    by.set(s.contactId, row);
  }
  return [...by.values()].map((r) => ({ ...r, servicesLabel: `${r.total} · ${r.active} ${r.active === 1 ? "activo" : "activos"}` }));
}

/** Lo cobrado por contacto: pagos cobrados de sus ventas, menos los reembolsos (que son filas negativas). */
export function paidByContact(rows: ClientRow[], payments: Array<{ saleId: string; amount: number }>): Map<string, number> {
  const bySale = new Map<string, number>();
  for (const p of payments) bySale.set(p.saleId, (bySale.get(p.saleId) ?? 0) + (Number(p.amount) || 0));
  return new Map(rows.map((r) => [r.contactId, Math.round(r.saleIds.reduce((n, s) => n + (bySale.get(s) ?? 0), 0) * 100) / 100]));
}
