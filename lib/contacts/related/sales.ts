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
import { INACTIVE_SALE_STATUSES, SALE_STATUSES, SALE_STATUS_LABELS, saleStatusLabel } from "@/lib/sales/labels";
import { toCents, totalPaidCents } from "@/lib/shared/money";
import { hasRelatedFilter, relatedMultiFilter } from "../filters/catalog";
import { UUID_RE, byContact, fillCells, isYesNo, plural, type CellValue, type ContactListModule, type ContactRecord, type ListGroupDef } from "../filters/types";

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

interface SaleRow {
  contact_id: string;
  status: string;
  sale_date: string;
  final_amount: unknown;
  product_snapshot: unknown;
  payments: Array<{ amount: unknown; status: string }> | null;
}

const productName = (snapshot: unknown): string | null => {
  const name = snapshot && typeof snapshot === "object" ? (snapshot as { product_name?: unknown }).product_name : null;
  return typeof name === "string" && name.trim() ? name.trim() : null;
};

/** Puro: las celdas a partir de las ventas de la página (la más reciente primero). Lo anulado no suma. */
export function saleCells(contactIds: readonly string[], keys: readonly string[], rows: readonly SaleRow[]) {
  const grouped = byContact(rows);
  return fillCells(contactIds, keys, (id) => {
    const list = grouped.get(id) ?? [];
    const live = list.filter((s) => !(INACTIVE_SALE_STATUSES as readonly string[]).includes(s.status));
    const last = list[0];
    const cells: Record<string, CellValue> = {
      sales_count: list.length > 0 ? { t: "number", n: list.length, ...(live.length !== list.length ? { sub: plural(live.length, "vigente", "vigentes") } : {}) } : null,
      sales_total: live.length > 0 ? { t: "money", cents: live.reduce((sum, s) => sum + toCents(s.final_amount), 0) } : null,
      sales_paid: list.length > 0 ? { t: "money", cents: list.reduce((sum, s) => sum + totalPaidCents(s.payments), 0) } : null,
      last_product: last ? { t: "text", text: productName(last.product_snapshot) ?? "Producto" } : null,
      last_sale_status: last ? { t: "date", at: last.sale_date, mode: "day", sub: saleStatusLabel(last.status) } : null,
    };
    return cells;
  });
}

export const salesModule: ContactListModule = {
  key: "ventas",
  filters: [
    hasRelatedFilter({ param: "venta", label: "Tiene venta", group: SALES_GROUP, relation: "sales", columns: ["id"], keywords: "compro cliente" }),
    relatedMultiFilter({
      param: "estado_venta",
      label: "Estado de la venta",
      group: SALES_GROUP,
      relation: "sales",
      column: "status",
      accepts: (v) => (SALE_STATUSES as readonly string[]).includes(v),
      options: { static: SALE_STATUSES.map((st) => ({ value: st, label: SALE_STATUS_LABELS[st] })) },
      keywords: "pagada reembolsada cancelada",
      hint: "Alguna de sus ventas está en este estado.",
    }),
    {
      param: "producto_comprado",
      label: "Producto comprado",
      group: SALES_GROUP,
      kind: "multi",
      related: true,
      options: { from: "products" },
      keywords: "compro venta",
      accepts: (v) => UUID_RE.test(v),
      plan: (values) => ({
        related: [{ relation: "sales", mode: "has", columns: ["product_variants!inner(product_id)"], clauses: [{ op: "in", column: "product_variants.product_id", values: [...values] }] }],
      }),
    },
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
    { key: "sales_count", label: "Cantidad de ventas", group: SALES_GROUP, hideable: true, defaultVisible: false, source: "related" },
    { key: "sales_total", label: "Total vendido", group: SALES_GROUP, hideable: true, defaultVisible: false, source: "related", keywords: "monto plata" },
    { key: "sales_paid", label: "Total cobrado", group: SALES_GROUP, hideable: true, defaultVisible: false, source: "related", keywords: "pagado plata" },
    { key: "last_product", label: "Último producto comprado", group: SALES_GROUP, hideable: true, defaultVisible: false, source: "related" },
    { key: "last_sale_status", label: "Última venta", group: SALES_GROUP, hideable: true, defaultVisible: false, source: "related", keywords: "estado fecha" },
    { key: "payments", label: "Pagos", group: SALES_GROUP, hideable: true, defaultVisible: false, source: "contact", cell: paymentsCell, keywords: "mora al dia cobrado" },
  ],
  async loadCells(supabase, workspaceId, contactIds, keys) {
    const { data, error } = await supabase
      .from("sales")
      .select("contact_id, status, sale_date, final_amount, product_snapshot, payments(amount, status)")
      .eq("workspace_id", workspaceId)
      .in("contact_id", [...contactIds])
      .order("sale_date", { ascending: false })
      .order("created_at", { ascending: false })
      .limit(1000);
    if (error) throw new Error(error.message);
    return saleCells(contactIds, keys, (data ?? []) as unknown as SaleRow[]);
  },
};
