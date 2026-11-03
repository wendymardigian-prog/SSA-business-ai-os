/**
 * La lista de contactos: ventas y pagos.
 *
 * La salud de pago sale de `contacts.payment_health` (la recalcula el servidor
 * al cobrar, revertir o pasar a moroso, F31).
 *
 * Es del módulo Ventas: la plantilla de estudiantes no lo lleva y borra este
 * archivo (`scripts/plantilla/perfiles/estudiantes.mjs`).
 */
import { EMPTY_HEALTH, type PaymentHealth } from "@/lib/sales/payment-health";
import { isYesNo, type CellValue, type ContactListModule, type ContactRecord, type ListGroupDef } from "../filters/types";

export const SALES_GROUP: ListGroupDef = { key: "ventas", label: "Ventas y pagos", order: 80 };

const OVERDUE_PATH = "payment_health->>has_active_overdue";

function healthOf(row: ContactRecord): PaymentHealth {
  const raw = row.payment_health;
  return { ...EMPTY_HEALTH, ...(raw && typeof raw === "object" && !Array.isArray(raw) ? (raw as Partial<PaymentHealth>) : {}) };
}

/** "Al día" / "En mora", con cuántos pagos cobrados. Sin pagos ni mora, vacío. */
export function paymentsCell(row: ContactRecord): CellValue {
  const h = healthOf(row);
  if (h.total_paid === 0 && !h.has_active_overdue) return null;
  const sub = h.total_paid > 0 ? `${h.total_paid} ${h.total_paid === 1 ? "pago cobrado" : "pagos cobrados"}` : undefined;
  return h.has_active_overdue ? { t: "badge", text: "En mora", tone: "red", sub } : { t: "badge", text: "Al día", tone: "green", sub };
}

export const salesModule: ContactListModule = {
  key: "ventas",
  filters: [
    {
      param: "mora",
      label: "Pago en mora",
      group: SALES_GROUP,
      kind: "yesno",
      keywords: "pagos atrasado deuda cobranza",
      hint: "Tiene al menos un pago vencido sin cobrar.",
      accepts: isYesNo,
      plan: (values) =>
        values[0] === "si"
          ? { clauses: [{ op: "eq", column: OVERDUE_PATH, value: "true" }] }
          : { clauses: [{ op: "or", filter: `${OVERDUE_PATH}.is.null,${OVERDUE_PATH}.neq.true` }] },
    },
  ],
  columns: [
    { key: "payments", label: "Pagos", group: SALES_GROUP, hideable: true, defaultVisible: false, source: "contact", cell: paymentsCell, keywords: "mora al dia cobrado" },
  ],
};
