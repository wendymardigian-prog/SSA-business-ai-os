// @plantilla-quitar(servicios)
/**
 * La ficha del servicio (F29), «+ Servicio» (F30), la celda de Ventas (F95) y la actividad del cliente (F28). Puro.
 */
import type { ServiceStatus } from "./list";

// ── Alertas con acción (F29), en orden de gravedad ─────────────────────────
export interface ServiceAlertInput {
  status: ServiceStatus;
  overduePayment: boolean;
  overdueItems: Array<{ id: string; name: string }>;
  possibleDuplicate: boolean;
  needsAttentionItems: Array<{ id: string; name: string }>;
  saleChanged: boolean;
  saleId: string | null;
}
export interface ServiceAlert {
  kind: "overdue_payment" | "overdue_item" | "pending" | "duplicate" | "needs_attention" | "sale_changed";
  severity: number;
  text: string;
  action: { label: string; href?: string; command?: "confirm" | "do_item"; itemId?: string };
}

export function serviceAlerts(s: ServiceAlertInput): ServiceAlert[] {
  const out: ServiceAlert[] = [];
  if (s.overduePayment && s.saleId) out.push({ kind: "overdue_payment", severity: 1, text: "Tiene un pago vencido.", action: { label: "Ver venta", href: `/dashboard/ventas?venta=${s.saleId}` } });
  for (const it of s.overdueItems) out.push({ kind: "overdue_item", severity: 2, text: `Venció «${it.name}».`, action: { label: "Hacer ahora", command: "do_item", itemId: it.id } });
  if (s.status === "pending_confirmation") out.push({ kind: "pending", severity: 3, text: "Está por confirmar.", action: { label: "Confirmar", command: "confirm" } });
  if (s.possibleDuplicate) out.push({ kind: "duplicate", severity: 4, text: "¿Venta repetida? El contacto ya tenía un servicio de este producto.", action: { label: "Revisar", command: "confirm" } });
  for (const it of s.needsAttentionItems) out.push({ kind: "needs_attention", severity: 5, text: `«${it.name}» requiere atención: su formulario o clase ya no está.`, action: { label: "Ver el paso", command: "do_item", itemId: it.id } });
  if (s.saleChanged && s.saleId) out.push({ kind: "sale_changed", severity: 6, text: "La venta cambió: revisá el servicio.", action: { label: "Ver venta", href: `/dashboard/ventas?venta=${s.saleId}` } });
  return out.sort((a, b) => a.severity - b.severity);
}

// ── Acciones según estado y permiso (F29) ──────────────────────────────────
export type ServiceActionKey = "pause" | "resume" | "extend" | "complete" | "cancel" | "change_phase" | "confirm" | "discard" | "change_owner";

export function serviceActions(status: ServiceStatus, can: (key: string) => boolean): ServiceActionKey[] {
  const out: ServiceActionKey[] = [];
  if (status === "pending_confirmation") {
    if (can("services.confirm")) out.push("confirm", "discard");
    return out;
  }
  if (status === "active" && can("services.pause")) out.push("pause");
  if (status === "paused" && can("services.pause")) out.push("resume");
  if ((status === "active" || status === "paused" || status === "completed") && can("services.extend")) out.push("extend");
  if ((status === "active" || status === "paused") && can("services.complete")) out.push("complete");
  if (status !== "cancelled" && status !== "completed" && can("services.cancel")) out.push("cancel");
  if (status === "active" && can("services.change_phase")) out.push("change_phase");
  if (status !== "cancelled" && can("services.change_owner")) out.push("change_owner");
  return out;
}

export const ACTION_LABELS: Record<ServiceActionKey, string> = {
  pause: "Pausar",
  resume: "Reanudar",
  extend: "Extender",
  complete: "Completar",
  cancel: "Cancelar",
  change_phase: "Cambiar de fase a mano…",
  confirm: "Confirmar",
  discard: "Descartar",
  change_owner: "Cambiar responsable",
};

// ── «+ Servicio» (F30) ──────────────────────────────────────────────────────
export interface NewServiceForm {
  origin: "sale" | "courtesy" | "test" | "manual";
  saleId: string;
  contactId: string;
  variantId: string;
  startsOn: string;
  ownerId: string;
  reason: string;
}

export function newServiceFormIssues(f: NewServiceForm): string[] {
  const p: string[] = [];
  if (!f.contactId) p.push("Elegí el contacto.");
  if (!f.variantId) p.push("Elegí el producto y la variante.");
  if (f.origin === "sale" && !f.saleId) p.push("Elegí la venta.");
  if (f.origin !== "sale" && !f.reason.trim()) p.push("Escribí el motivo (es obligatorio sin venta).");
  if (f.startsOn && !/^\d{4}-\d{2}-\d{2}$/.test(f.startsOn)) p.push("La fecha de inicio no es válida.");
  return p;
}

// ── La celda de Ventas (F95) ────────────────────────────────────────────────
export interface SaleServiceInfo {
  serviceId: string | null;
  status: ServiceStatus | null;
  phaseName: string | null;
  light: "green" | "yellow" | "red" | "gray" | null;
  extendsProductName: string | null;
}

export function salesServiceCell(info: SaleServiceInfo | null, canCreate: boolean):
  | { kind: "service"; label: string; light: string; href: string }
  | { kind: "extends"; label: string; href: string | null }
  | { kind: "create" }
  | { kind: "none" } {
  if (info?.extendsProductName) return { kind: "extends", label: `Extiende el servicio de ${info.extendsProductName}`, href: info.serviceId ? `/dashboard/clientes/s/${info.serviceId}` : null };
  if (info?.serviceId && info.status) {
    const st = { pending_confirmation: "Por confirmar", active: "Activo", paused: "Pausado", completed: "Completado", cancelled: "Cancelado" }[info.status];
    return { kind: "service", label: info.phaseName ? `${st} · ${info.phaseName}` : st, light: info.light ?? "gray", href: `/dashboard/clientes/s/${info.serviceId}` };
  }
  return canCreate ? { kind: "create" } : { kind: "none" };
}

/** El motivo de `svc_rule_check` en castellano (el modal sale en rojo con esto). */
export const RULE_REASON_LABELS: Record<string, string> = {
  only_reservation: "Solo se cobró la reserva.",
  below_percent: "Todavía no se cobró el porcentaje de la regla.",
  below_amount: "Todavía no se cobró el monto de la regla.",
  no_rule: "La variante no crea servicios al cobrarse.",
  before_enabled: "El pago es anterior a prender la regla.",
  no_payment: "La venta no tiene pagos cobrados.",
  already_has_service: "La venta ya tiene su servicio.",
};

// ── La actividad del cliente (F28) ─────────────────────────────────────────
export interface TimelineEvent {
  id: string;
  at: string;
  serviceId: string | null;
  kind: string;
}
export type TimelineFilter = { kind: "all" } | { kind: "service"; serviceId: string } | { kind: "before_sale"; firstSaleAt: string | null };

export function clientTimelineFilter<T extends TimelineEvent>(events: T[], filter: TimelineFilter): T[] {
  const sorted = [...events].sort((a, b) => (a.at < b.at ? 1 : a.at > b.at ? -1 : 0));
  if (filter.kind === "all") return sorted;
  if (filter.kind === "service") return sorted.filter((e) => e.serviceId === filter.serviceId);
  if (!filter.firstSaleAt) return sorted.filter((e) => e.serviceId === null);
  return sorted.filter((e) => e.at < filter.firstSaleAt!);
}
