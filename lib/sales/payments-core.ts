/**
 * El núcleo de cobrar, reprogramar y cancelar (plano F29, F32, F37), compartido por las Server
 * Actions (una PERSONA) y por las acciones de un flujo (el SISTEMA, con el nombre del flujo). Así
 * las dos hacen exactamente lo mismo: la misma regla pura, el mismo recálculo de la salud de pago, de
 * los recordatorios y de la venta (lo hace el trigger de la base), y la misma auditoría; solo cambia el
 * actor. SOLO servidor, con el cliente de servicio, DESPUÉS de comprobar permisos y visibilidad.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/types/database";
import { auditAsSystem, diffFields, logAudit } from "@/lib/audit";
import { localToday } from "@/lib/shared/dates";
import { planMarkPaid, planReschedule, type PartialOffer } from "./payments-rules";
import type { PaymentMethodDef } from "./payment-methods";
import { refreshContactPaymentHealth } from "./payment-health-run";
import { syncPaymentRelativeJobs } from "./automation/relative";

type Db = SupabaseClient<Database>;

export type Actor = { kind: "user"; userId: string } | { kind: "system"; label: string };

export interface PaymentRow {
  id: string;
  workspace_id: string;
  sale_id: string;
  type: string;
  status: string;
  amount: number;
  due_date: string | null;
  original_due_date: string | null;
  reschedule_count: number;
  paid_on: string | null;
  payment_method: string | null;
}

export interface SaleRow {
  id: string;
  contact_id: string;
  sale_date: string;
  status: string;
  financing_type?: string;
}

export interface CoreContext {
  service: Db;
  workspaceId: string;
  payment: PaymentRow;
  sale: SaleRow;
  tz: string;
  graceDays: number;
  enabledMethods: readonly string[];
  /** Los métodos del negocio con su comisión; sin esto, el catálogo de arranque. */
  methods?: readonly PaymentMethodDef[];
  actor: Actor;
}

export type CoreResult<T extends object = object> = ({ ok: true } & T) | { ok: false; error: string };
const fail = (error: string): { ok: false; error: string } => ({ ok: false, error });

export const CLOSED_SALE_STATUSES = ["cancelled", "refunded", "subscription_cancelled"] as const;

/** La auditoría con el actor que corresponde: una persona (`'user'`) o el sistema con un nombre legible. */
export async function auditFor(c: Pick<CoreContext, "service" | "workspaceId" | "actor">, args: Omit<Parameters<typeof logAudit>[0], "supabase" | "workspaceId" | "performedBy" | "actorType" | "actorLabel" | "performedByAgentId">) {
  if (c.actor.kind === "user") return logAudit({ ...args, supabase: c.service, workspaceId: c.workspaceId, performedBy: c.actor.userId });
  return auditAsSystem({ ...args, supabase: c.service, workspaceId: c.workspaceId, label: c.actor.label });
}

const actorId = (a: Actor): string | null => (a.kind === "user" ? a.userId : null);

/** Escribe el pago con un UPDATE condicional sobre el estado leído: dos pedidos a la vez no escriben dos veces. */
async function writePayment(c: CoreContext, patch: object): Promise<boolean> {
  const { data, error } = await c.service
    .from("payments")
    .update({ ...patch, updated_by: actorId(c.actor) } as never)
    .eq("id", c.payment.id)
    .eq("workspace_id", c.workspaceId)
    .eq("status", c.payment.status as "scheduled")
    .select("id");
  if (error) {
    console.error("[payments] no pude escribir el pago:", error.message);
    return false;
  }
  return (data ?? []).length > 0;
}

export interface MarkPaidCoreInput {
  amount?: number;
  paidOn?: string;
  method: string;
  notes?: string | null;
}

export async function markPaidCore(c: CoreContext, input: MarkPaidCoreInput): Promise<CoreResult<{ partial: PartialOffer | null; overpaidBy: number }>> {
  if ((CLOSED_SALE_STATUSES as readonly string[]).includes(c.sale.status)) return fail("Esta venta ya no admite cambios en sus pagos");
  const now = new Date();
  const today = localToday(now, c.tz);
  const planned = planMarkPaid(
    { amount: input.amount ?? c.payment.amount, paidOn: input.paidOn ?? today, method: input.method, notes: input.notes },
    { payment: c.payment, saleDate: c.sale.sale_date, todayLocal: today, timeZone: c.tz, now, enabledMethods: c.enabledMethods, methods: c.methods },
  );
  if (!planned.ok) return fail(planned.error);

  if (!(await writePayment(c, planned.patch))) return fail("Este pago cambió mientras lo cobrabas. Recargá para verlo.");

  await refreshContactPaymentHealth(c.service, c.workspaceId, c.sale.contact_id);
  await syncPaymentRelativeJobs(c.service, { paymentId: c.payment.id });
  await auditFor(c, {
    entityType: "payment", entityId: c.payment.id, action: "payment.paid",
    changes: diffFields({ status: c.payment.status, amount: c.payment.amount, payment_method: c.payment.payment_method }, { status: "paid", amount: planned.patch.amount, payment_method: planned.patch.payment_method }),
    metadata: { sale_id: c.sale.id, amount: planned.patch.amount, payment_method: planned.patch.payment_method, paid_on: planned.patch.paid_on, provider_fee_amount: planned.patch.provider_fee_amount },
  });
  return { ok: true, partial: planned.partial, overpaidBy: planned.overpaidBy };
}

export async function rescheduleCore(c: CoreContext, input: { newDate: string; reason: string }): Promise<CoreResult<{ status: "scheduled" | "overdue" }>> {
  if ((CLOSED_SALE_STATUSES as readonly string[]).includes(c.sale.status)) return fail("Esta venta ya no admite cambios en sus pagos");
  const planned = planReschedule(c.payment, input, localToday(new Date(), c.tz), c.graceDays);
  if (!planned.ok) return fail(planned.error);

  // `original_due_date` NO se toca: el desfase futuro se mide contra la original.
  const written = await writePayment(c, { due_date: input.newDate, status: planned.status, reschedule_count: c.payment.reschedule_count + 1, reschedule_reason: input.reason.trim() });
  if (!written) return fail("Este pago cambió mientras lo reprogramabas. Recargá para verlo.");

  await refreshContactPaymentHealth(c.service, c.workspaceId, c.sale.contact_id);
  await syncPaymentRelativeJobs(c.service, { paymentId: c.payment.id });
  await auditFor(c, {
    entityType: "payment", entityId: c.payment.id, action: "payment.rescheduled",
    changes: diffFields({ due_date: c.payment.due_date, status: c.payment.status }, { due_date: input.newDate, status: planned.status }),
    metadata: { sale_id: c.sale.id, reason: input.reason.trim(), original_due_date: c.payment.original_due_date },
  });
  return { ok: true, status: planned.status };
}

/**
 * Cancelar una venta o dar de baja una suscripción COMO SISTEMA (la acción de un flujo). Misma secuencia
 * que `cancel_sale` (la venta primero: `cancelled` es un estado escrito que el recálculo de cada pago
 * respeta) pero con actor sistema y el nombre del flujo, que el RPC no puede escribir.
 */
export async function cancelSaleAsSystem(c: Omit<CoreContext, "payment" | "actor"> & { actor: Extract<Actor, { kind: "system" }> }, input: { to: "cancelled" | "subscription_cancelled"; reason: string }): Promise<CoreResult> {
  const reason = input.reason.trim();
  if (!reason) return fail("Falta el motivo");
  const blocked = input.to === "cancelled" ? ["cancelled", "refunded", "disputed"] : ["cancelled", "refunded", "disputed", "subscription_cancelled"];
  if (blocked.includes(c.sale.status)) return fail("Esta venta ya no se puede cambiar");
  if (input.to === "subscription_cancelled" && c.sale.financing_type !== "subscription") return fail("Solo una suscripción se puede dar de baja");

  const patch = input.to === "cancelled"
    ? { status: "cancelled", cancelled_at: new Date().toISOString(), cancellation_reason: reason }
    : { status: "subscription_cancelled", subscription_cancelled_at: new Date().toISOString(), subscription_cancel_reason: reason };
  const { data, error } = await c.service.from("sales").update(patch as never).eq("id", c.sale.id).eq("workspace_id", c.workspaceId).eq("status", c.sale.status as "paid").select("id");
  if (error || (data ?? []).length === 0) return fail("La venta cambió mientras tanto");

  let cancelled = 0;
  if (input.to === "cancelled") {
    const { data: payments } = await c.service.from("payments").update({ status: "cancelled" } as never).eq("sale_id", c.sale.id).in("status", ["scheduled", "overdue"]).select("id");
    cancelled = (payments ?? []).length;
  }
  await syncPaymentRelativeJobs(c.service, { saleId: c.sale.id });
  await auditFor({ ...c }, {
    entityType: "sale", entityId: c.sale.id, action: input.to === "cancelled" ? "sale.cancelled" : "sale.subscription_cancelled",
    changes: diffFields({ status: c.sale.status }, { status: input.to }),
    metadata: { reason, payments_cancelled: cancelled },
  });
  return { ok: true };
}
