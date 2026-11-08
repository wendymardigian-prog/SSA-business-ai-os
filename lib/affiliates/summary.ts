// @plantilla-quitar(ventas)
/**
 * Afiliados › Resumen (F105): por afiliado (del equipo o un contacto), sus referidos vigentes, cuántos trajo y en
 * cuántos influyó, sus ventas y lo cobrado, y sus comisiones. Puro: la plata en céntimos (`toCents`, D1). Un afiliado
 * sin nada también aparece (para ver quién no está trayendo). Orden: más vendido primero, después por nombre.
 */
import { toCents } from "@/lib/shared/money";

export interface SummaryPerson {
  type: "user" | "contact";
  id: string;
  name: string;
  code: string | null;
  /** Un miembro dado de baja con referidos todavía asignados. */
  departed?: boolean;
}

export interface SummaryLead {
  affiliate_user_id: string | null;
  affiliate_contact_id: string | null;
  affiliate_kind: string | null;
  affiliate_expires_at: string | null;
}

export interface SummarySale {
  affiliate_user_id: string | null;
  affiliate_contact_id: string | null;
  status: string;
  final_amount: number | string | null;
}

export interface SummaryCommission {
  user_id: string | null;
  contact_id: string | null;
  amount: number | string;
  expense_id: string | null;
}

export interface SummaryRow extends SummaryPerson {
  leads: number;
  originated: number;
  influenced: number;
  sales: number;
  salesCents: number;
  commissionsCents: number;
  pendingCents: number;
}

const keyOf = (type: "user" | "contact", id: string | null) => (id ? `${type}:${id}` : null);
const personKey = (userId: string | null, contactId: string | null) => keyOf("user", userId) ?? keyOf("contact", contactId);

export function affiliateSummary(
  people: SummaryPerson[],
  leads: SummaryLead[],
  sales: SummarySale[],
  commissions: SummaryCommission[],
  now: string,
): { rows: SummaryRow[]; totals: Omit<SummaryRow, keyof SummaryPerson> } {
  const rows = new Map<string, SummaryRow>();
  for (const p of people) rows.set(`${p.type}:${p.id}`, { ...p, leads: 0, originated: 0, influenced: 0, sales: 0, salesCents: 0, commissionsCents: 0, pendingCents: 0 });
  const nowMs = Date.parse(now);
  for (const l of leads) {
    const row = rows.get(personKey(l.affiliate_user_id, l.affiliate_contact_id) ?? "");
    if (!row) continue;
    if (l.affiliate_expires_at && Date.parse(l.affiliate_expires_at) < nowMs) continue;
    row.leads += 1;
    if (l.affiliate_kind === "originated") row.originated += 1;
    else row.influenced += 1;
  }
  for (const s of sales) {
    const row = rows.get(personKey(s.affiliate_user_id, s.affiliate_contact_id) ?? "");
    if (!row || s.status === "cancelled") continue;
    row.sales += 1;
    row.salesCents += toCents(Number(s.final_amount ?? 0));
  }
  // Solo las comisiones de quien es afiliado: una persona del equipo cobra también por otros roles, y acá se muestra
  // lo suyo como total (la lista de Comisiones tiene el detalle por rol).
  for (const c of commissions) {
    const row = rows.get(personKey(c.user_id, c.contact_id) ?? "");
    if (!row) continue;
    const cents = toCents(Number(c.amount));
    row.commissionsCents += cents;
    if (!c.expense_id) row.pendingCents += cents;
  }
  const list = [...rows.values()].sort((a, b) => b.salesCents - a.salesCents || b.leads - a.leads || a.name.localeCompare(b.name, "es"));
  const totals = list.reduce(
    (t, r) => ({
      leads: t.leads + r.leads,
      originated: t.originated + r.originated,
      influenced: t.influenced + r.influenced,
      sales: t.sales + r.sales,
      salesCents: t.salesCents + r.salesCents,
      commissionsCents: t.commissionsCents + r.commissionsCents,
      pendingCents: t.pendingCents + r.pendingCents,
    }),
    { leads: 0, originated: 0, influenced: 0, sales: 0, salesCents: 0, commissionsCents: 0, pendingCents: 0 },
  );
  return { rows: list, totals };
}
