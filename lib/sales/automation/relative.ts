/**
 * Los recordatorios relativos al vencimiento de un pago (plano F37): «X días antes» y «X días
 * después si sigue impago». Solo servidor. Mismo patrón que `lib/scheduling/automation/relative.ts`.
 *
 * Un trigger «3 días antes» no puede evaluarse cuando pasa algo: hay que AGENDARLO. Cada vez que un
 * pago nace, se mueve, se cobra o se anula, se recalculan sus recordatorios: los pendientes viejos se
 * anulan (`status = 'cancelled'`; queda el rastro) y se agendan los nuevos.
 *
 *  - `run_at` se calcula en la zona del workspace (`due_date ± offset_days` a la hora configurada).
 *  - `dedupe_key = rel:<trigger_id>:<payment_id>:<reschedule_count>`: reprogramar vuelve a habilitar el
 *    recordatorio. Se inserta de a uno y se TOLERA el duplicado (23505): el índice único de la cola
 *    vale entre los pendientes y un duplicado no puede tumbar el lote.
 *  - Si el momento ya pasó cuando el pago nace, no se crea.
 *
 * Nunca lanza por un fallo de la base: un recordatorio que no se agenda no puede deshacer lo que lo
 * originó (un cobro, una venta). Se loguea.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database, Json } from "@/lib/types/database";
import { SWEEP_SKIPPED_SALE_STATUSES } from "../overdue";
import { snapshotProductId } from "../sale-text";
import { isOpenPayment, planPaymentRelativeJobs, RELATIVE_SALES_TRIGGERS, type TriggerForPlanning } from "./triggers";

type Db = SupabaseClient<Database>;

export const PAYMENT_RELATIVE_JOB_TYPE = "payment_relative_trigger";

/** Los triggers relativos activos de un negocio, con su flujo publicado. */
export async function activePaymentRelativeTriggers(db: Db, workspaceId: string): Promise<TriggerForPlanning[]> {
  const { data } = await db
    .from("triggers")
    .select("id, type, config, flows!inner(status)")
    .eq("workspace_id", workspaceId)
    .in("type", [...RELATIVE_SALES_TRIGGERS])
    .eq("is_active", true)
    .eq("flows.status", "published");
  return (data ?? []).map((t) => ({ id: t.id, type: t.type, config: t.config }));
}

interface PaymentRow {
  id: string;
  sale_id: string;
  workspace_id: string;
  type: string;
  status: string;
  due_date: string | null;
  reschedule_count: number;
}

/** Recalcula los recordatorios de un pago (o de todos los de una venta). Devuelve cuántos quedaron agendados. */
export async function syncPaymentRelativeJobs(db: Db, target: { saleId?: string; paymentId?: string }, now: Date = new Date()): Promise<number> {
  try {
    let query = db.from("payments").select("id, sale_id, workspace_id, type, status, due_date, reschedule_count");
    if (target.paymentId) query = query.eq("id", target.paymentId);
    else if (target.saleId) query = query.eq("sale_id", target.saleId);
    else return 0;
    const { data: payments } = await query;
    const rows = (payments ?? []) as unknown as PaymentRow[];
    if (rows.length === 0) return 0;

    const workspaceId = rows[0].workspace_id;
    const saleIds = [...new Set(rows.map((p) => p.sale_id))];
    const [{ data: sales }, { data: workspace }, triggers] = await Promise.all([
      db.from("sales").select("id, status, product_snapshot").in("id", saleIds),
      db.from("workspaces").select("timezone").eq("id", workspaceId).maybeSingle(),
      activePaymentRelativeTriggers(db, workspaceId),
    ]);
    const saleById = new Map((sales ?? []).map((s) => [s.id, s]));
    const tz = workspace?.timezone ?? "UTC";
    const skipped = new Set<string>(SWEEP_SKIPPED_SALE_STATUSES);

    let scheduled = 0;
    for (const payment of rows) {
      // Primero se anulan los pendientes: si se movió, cobró o anuló, los viejos ya no corresponden.
      const { error: cancelError } = await db
        .from("scheduled_jobs")
        .update({ status: "cancelled" })
        .eq("type", PAYMENT_RELATIVE_JOB_TYPE)
        .eq("payload->>payment_id", payment.id)
        .eq("status", "pending");
      if (cancelError) console.error("[ventas] no pude anular los recordatorios viejos:", cancelError.message);

      const sale = saleById.get(payment.sale_id);
      if (!sale || skipped.has(sale.status) || !isOpenPayment(payment) || triggers.length === 0) continue;

      const planned = planPaymentRelativeJobs(
        { ...payment, product_id: snapshotProductId(sale.product_snapshot) },
        triggers,
        tz,
        now,
      );
      for (const job of planned) {
        const { error } = await db.from("scheduled_jobs").insert({
          type: PAYMENT_RELATIVE_JOB_TYPE,
          payload: {
            payment_id: payment.id,
            sale_id: payment.sale_id,
            trigger_id: job.triggerId,
            trigger_type: job.triggerType,
            reschedule_count: payment.reschedule_count,
            dedupe_key: job.dedupeKey,
          } as unknown as Json,
          run_at: job.runAt,
          status: "pending" as const,
          dedupe_key: job.dedupeKey,
        });
        if (error) {
          // Un duplicado pendiente es el caso normal (el mismo recordatorio planificado dos veces): no es un error.
          if ((error as { code?: string }).code !== "23505") console.error("[ventas] no pude agendar un recordatorio:", error.message);
          continue;
        }
        scheduled++;
      }
    }
    return scheduled;
  } catch (error) {
    console.error("[ventas] los recordatorios de pagos fallaron:", error instanceof Error ? error.message : "error");
    return 0;
  }
}

/**
 * Vuelve a planificar los recordatorios de los pagos abiertos de un negocio. Se llama al publicar un
 * flujo con un trigger relativo: si no, el recordatorio empezaría a valer solo para los pagos nuevos y la
 * persona que lo prendió esperaba que valiera para los que ya tiene.
 */
export async function backfillPaymentRelativeJobs(db: Db, workspaceId: string, now: Date = new Date()): Promise<number> {
  const { data: payments } = await db
    .from("payments")
    .select("id")
    .eq("workspace_id", workspaceId)
    .in("status", ["scheduled", "overdue"])
    .neq("type", "refund")
    .gte("due_date", new Date(now.getTime() - 86_400_000).toISOString().slice(0, 10))
    .limit(1000);
  let total = 0;
  for (const p of payments ?? []) total += await syncPaymentRelativeJobs(db, { paymentId: p.id }, now);
  return total;
}
