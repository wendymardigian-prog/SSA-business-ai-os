// @plantilla-quitar(servicios)
/**
 * La ficha del servicio en modal (Servicios A2, F130.3): las alertas en su orden y las señales del semaforo. Puro.
 * Lo del portal (entregas, ingreso, invitacion, accesos) entra solo si el producto tiene portal.
 */
import { serviceAlerts, type ServiceAlertInput } from "./service";
import type { NextPaymentView } from "./record-figures";

export type RecordTone = "good" | "warn" | "bad" | "neutral";

export interface RecordPortalState {
  hasPortal: boolean;
  accountStatus: string | null;
  lastLoginAt: string | null;
  inviteSentAt: string | null;
  accessExpiringOn: string | null;
}

export interface RecordAlert {
  kind: "reviews" | "payment" | "access" | "invite" | "inactive" | "pending" | "duplicate" | "needs_attention" | "sale_changed";
  tone: RecordTone;
  text: string;
  action: { label: string; href?: string; command?: "review" | "accesses" | "confirm" | "do_item"; itemId?: string } | null;
}

const dayDiff = (from: string, to: string) => Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000);
const ddmm = (d: string) => `${Number(d.slice(8, 10))}/${Number(d.slice(5, 7))}`;
const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

/** Dias desde el ultimo ingreso al portal (en fechas civiles de quien mira). Null si nunca entro. */
export function daysSinceLogin(lastLoginAt: string | null, today: string, toLocalDate: (iso: string) => string): number | null {
  if (!lastLoginAt) return null;
  return Math.max(0, dayDiff(toLocalDate(lastLoginAt), today));
}

/** Desde cuantos dias sin entrar se avisa (F130.3: "No entra al portal hace N días", desde 5). */
export const INACTIVE_ALERT_DAYS = 5;

/**
 * Las alertas de la columna principal, una linea cada una con su boton. Primero las entregas por revisar, despues el
 * pago vencido, los accesos por cortarse, la invitacion sin entrar y "No entra al portal hace N días". Despues las de
 * siempre del servicio (por confirmar, venta repetida, paso que requiere atencion, venta que cambio). Los pasos
 * vencidos NO van aca: los avisa el camino.
 */
export function recordAlerts(i: {
  base: ServiceAlertInput;
  pendingReviews: number;
  payment: NextPaymentView | null;
  saleId: string | null;
  portal: RecordPortalState;
  loginDays: number | null;
  today: string;
}): RecordAlert[] {
  const out: RecordAlert[] = [];
  const active = i.base.status === "active" || i.base.status === "paused";
  if (i.portal.hasPortal && i.pendingReviews > 0) {
    out.push({ kind: "reviews", tone: "warn", text: `${plural(i.pendingReviews, "entrega", "entregas")} por revisar.`, action: { label: "Revisar", command: "review" } });
  }
  if (i.payment?.kind === "overdue") {
    out.push({
      kind: "payment",
      tone: "bad",
      text: `Pago vencido hace ${plural(i.payment.daysLate, "día", "días")} (cuota ${i.payment.index} de ${i.payment.total}).`,
      action: i.saleId ? { label: "Ver venta", href: `/dashboard/ventas/${i.saleId}` } : null,
    });
  }
  if (i.portal.hasPortal && active && i.portal.accessExpiringOn) {
    out.push({ kind: "access", tone: "warn", text: `Un acceso al portal se corta el ${ddmm(i.portal.accessExpiringOn)}.`, action: { label: "Ver accesos", command: "accesses" } });
  }
  if (i.portal.hasPortal && active && i.portal.accountStatus === "invited" && !i.portal.lastLoginAt) {
    out.push({
      kind: "invite",
      tone: "warn",
      text: i.portal.inviteSentAt ? `Lo invitaste al portal hace ${plural(Math.max(0, dayDiff(i.portal.inviteSentAt.slice(0, 10), i.today)), "día", "días")} y todavía no entró.` : "Está invitado al portal y todavía no entró.",
      action: { label: "Ver accesos", command: "accesses" },
    });
  }
  if (i.portal.hasPortal && active && i.loginDays !== null && i.loginDays >= INACTIVE_ALERT_DAYS) {
    out.push({ kind: "inactive", tone: i.loginDays >= 14 ? "bad" : "warn", text: `No entra al portal hace ${plural(i.loginDays, "día", "días")}.`, action: null });
  }
  for (const a of serviceAlerts(i.base)) {
    if (a.kind === "overdue_item" || a.kind === "overdue_payment") continue;
    out.push({
      kind: a.kind,
      tone: a.kind === "pending" ? "neutral" : "warn",
      text: a.text,
      action: a.action.href ? { label: a.action.label, href: a.action.href } : a.action.command ? { label: a.action.label, command: a.action.command, itemId: a.action.itemId } : null,
    });
  }
  return out;
}

export interface LightSignal {
  key: "phase" | "items" | "payments" | "reviews" | "portal";
  label: string;
  tone: RecordTone;
}

/**
 * Las señales del semaforo como chips (fase, pasos vencidos, pagos, entregas y portal), cada una con su color. Las del
 * portal solo si el producto tiene portal.
 */
export function lightSignals(i: {
  phase: { name: string; days: number | null; yellowDay: number | null; redDay: number | null } | null;
  overdueItems: number;
  payment: NextPaymentView | null;
  pendingReviews: number;
  portal: RecordPortalState;
  loginDays: number | null;
}): LightSignal[] {
  const out: LightSignal[] = [];
  if (i.phase) {
    const d = i.phase.days;
    const tone: RecordTone = d === null ? "neutral" : i.phase.redDay && d >= i.phase.redDay ? "bad" : i.phase.yellowDay && d >= i.phase.yellowDay ? "warn" : "good";
    out.push({ key: "phase", label: d === null ? `Fase ${i.phase.name}` : `Fase ${plural(d, "día", "días")}`, tone });
  }
  out.push({ key: "items", label: i.overdueItems > 0 ? `${plural(i.overdueItems, "paso vencido", "pasos vencidos")}` : "Pasos al día", tone: i.overdueItems > 0 ? "bad" : "good" });
  if (i.payment) {
    out.push(
      i.payment.kind === "overdue"
        ? { key: "payments", label: `Pago vencido`, tone: "bad" }
        : { key: "payments", label: i.payment.kind === "paid" ? "Pagado" : "Pagos al día", tone: "good" },
    );
  }
  if (i.portal.hasPortal) {
    out.push({ key: "reviews", label: i.pendingReviews > 0 ? `${plural(i.pendingReviews, "entrega", "entregas")} por revisar` : "Entregas al día", tone: i.pendingReviews > 0 ? "warn" : "good" });
    out.push(
      i.loginDays === null
        ? { key: "portal", label: i.portal.accountStatus ? "Portal: no entró" : "Sin portal", tone: i.portal.accountStatus ? "warn" : "neutral" }
        : { key: "portal", label: i.loginDays === 0 ? "Portal: hoy" : `Portal: hace ${plural(i.loginDays, "día", "días")}`, tone: i.loginDays >= 14 ? "bad" : i.loginDays >= INACTIVE_ALERT_DAYS ? "warn" : "good" },
    );
  }
  return out;
}

/** Los pasos vencidos del camino (avisos de arriba de la columna derecha), del mas viejo al mas nuevo. */
export function overdueSteps<T extends { status: string; dueOn: string | null }>(items: readonly T[], today: string): T[] {
  return items.filter((it) => it.status === "pending" && it.dueOn !== null && it.dueOn < today).sort((a, b) => (a.dueOn as string).localeCompare(b.dueOn as string));
}
