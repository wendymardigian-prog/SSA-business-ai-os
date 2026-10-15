/**
 * Las listas de comisiones que se ven DENTRO de otras fichas (F62): la sección «Comisiones» de una venta y la de un
 * gasto de liquidación. Puro: el servidor lee las filas (`related-load.ts`), esta función las ordena, les pone
 * nombre y arma el total. Los componentes solo la dibujan.
 */
import type { StatusTone } from "@/lib/finance/expense-status";
import type { ClassifiedRow } from "./list-model";
import type { CommissionStatusKey } from "./status";

export interface RelatedNames {
  /** Id de persona → nombre. */
  people: ReadonlyMap<string, string>;
  /** Clave de rol → nombre. */
  roles: ReadonlyMap<string, string>;
  /** Id de contacto → nombre. */
  contacts?: ReadonlyMap<string, string>;
}

export interface RelatedCommissionItem {
  id: string;
  kind: "earned" | "adjustment";
  /** `null` = sin persona todavía. */
  personName: string | null;
  roleName: string | null;
  contactName: string | null;
  saleId: string | null;
  amountCents: number;
  statusKey: CommissionStatusKey;
  statusLabel: string;
  /** «Programado 5/11», «Pagada 6/11», o «». */
  statusDetail: string;
  tone: StatusTone;
  voided: boolean;
}

export interface RelatedCommissionList {
  items: RelatedCommissionItem[];
  /** Lo que suman las que no están anuladas, en céntimos. */
  totalCents: number;
  /** Cuántas no están anuladas. */
  liveCount: number;
}

/** Primero las vivas en el orden en que se generaron; las anuladas, al final. */
export function buildRelatedCommissions(rows: readonly ClassifiedRow[], names: RelatedNames): RelatedCommissionList {
  const items = [...rows]
    .sort((a, b) => {
      const va = a.status.key === "anulada" ? 1 : 0;
      const vb = b.status.key === "anulada" ? 1 : 0;
      if (va !== vb) return va - vb;
      const ca = a.commission.created_at;
      const cb = b.commission.created_at;
      if (ca !== cb) return ca < cb ? -1 : 1;
      return a.commission.id < b.commission.id ? -1 : a.commission.id > b.commission.id ? 1 : 0;
    })
    .map<RelatedCommissionItem>((row) => {
      const c = row.commission;
      return {
        id: c.id,
        kind: c.kind,
        personName: c.user_id ? names.people.get(c.user_id) ?? null : null,
        roleName: c.role ? names.roles.get(c.role) ?? c.role : null,
        contactName: row.contactId ? names.contacts?.get(row.contactId) ?? null : null,
        saleId: c.sale_id,
        amountCents: row.amountCents,
        statusKey: row.status.key,
        statusLabel: row.status.label,
        statusDetail: row.status.detail,
        tone: row.status.tone,
        voided: row.status.key === "anulada",
      };
    });
  const live = items.filter((i) => !i.voided);
  return { items, totalCents: live.reduce((sum, i) => sum + i.amountCents, 0), liveCount: live.length };
}

/** El título de una línea: «Ana — Vendedor», «Ana — Ajuste», «Sin persona — Contenido». */
export function relatedTitle(item: Pick<RelatedCommissionItem, "personName" | "roleName" | "kind">): string {
  const who = item.personName ?? "Sin persona";
  const what = item.kind === "adjustment" ? "Ajuste" : item.roleName;
  return what ? `${who} — ${what}` : who;
}
