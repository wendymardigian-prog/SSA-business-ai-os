/**
 * El job de un recordatorio relativo al vencimiento de un pago (plano F37).
 *
 * Cuando llega la hora, este handler NO ejecuta el flujo: emite el evento de automatización con el
 * nombre del trigger y lo dispara el cron de siempre (`automation-events`). Así los recordatorios pasan
 * por el mismo camino, la misma idempotencia y el mismo registro que los inmediatos.
 *
 * Antes de emitir vuelve a mirar el pago: si ya no está abierto (cobrado, anulado, incobrable), si la
 * venta se cerró o si se REPROGRAMÓ después de agendar el recordatorio (otro `reschedule_count`: el
 * reprogramado ya agendó el suyo), NO emite.
 *
 * El evento lleva solo escalares y NUNCA `booking_id` (el cron lo trataría como una reserva y se
 * saltearía la marca «no contactar»).
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database, Json } from "@/lib/types/database";
import { registerJobHandler, type JobContext } from "@/lib/jobs/registry";
import { SWEEP_SKIPPED_SALE_STATUSES } from "@/lib/sales/overdue";
import { snapshotProductId } from "@/lib/sales/sale-text";
import { PAYMENT_RELATIVE_JOB_TYPE } from "@/lib/sales/automation/relative";
import { isOpenPayment, isRelativeSalesTrigger } from "@/lib/sales/automation/triggers";

type Db = SupabaseClient<Database>;

interface RelativePayload {
  payment_id: string;
  trigger_id: string;
  trigger_type: string;
  reschedule_count?: number;
}

export async function handlePaymentRelativeTrigger(ctx: JobContext): Promise<void> {
  const db = ctx.supabase as Db;
  const payload = ctx.job.payload as unknown as RelativePayload;
  if (!payload?.payment_id || !payload?.trigger_id || !isRelativeSalesTrigger(payload.trigger_type)) return;

  const { data: payment } = await db
    .from("payments")
    .select("id, sale_id, workspace_id, type, status, reschedule_count")
    .eq("id", payload.payment_id)
    .maybeSingle();
  if (!payment || !isOpenPayment(payment)) return;
  if (payment.reschedule_count !== (payload.reschedule_count ?? 0)) return;

  const { data: sale } = await db.from("sales").select("id, contact_id, status, product_snapshot").eq("id", payment.sale_id).maybeSingle();
  if (!sale || (SWEEP_SKIPPED_SALE_STATUSES as readonly string[]).includes(sale.status)) return;

  // El trigger puede haberse apagado o borrado entre medio.
  const { data: trigger } = await db.from("triggers").select("id, is_active, flows!inner(status)").eq("id", payload.trigger_id).maybeSingle();
  if (!trigger || !trigger.is_active) return;

  await db.from("automation_events").insert({
    workspace_id: payment.workspace_id,
    event_type: payload.trigger_type,
    contact_id: sale.contact_id,
    payload: {
      payment_id: payment.id,
      sale_id: sale.id,
      contact_id: sale.contact_id,
      product_id: snapshotProductId(sale.product_snapshot),
      trigger_id: payload.trigger_id,
      reschedule_count: payment.reschedule_count,
    } as unknown as Json,
  });
}

export function registerPaymentRelativeHandler(): void {
  registerJobHandler(PAYMENT_RELATIVE_JOB_TYPE, handlePaymentRelativeTrigger);
}
