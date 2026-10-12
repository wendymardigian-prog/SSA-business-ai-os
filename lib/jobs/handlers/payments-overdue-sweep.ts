/**
 * El job `payments_overdue_sweep` (plano F30): pasa a moroso lo que venció.
 *
 * Lo encola `private.enqueue_payments_overdue_sweep()` (00167, pg_cron cada hora) UNA vez por
 * workspace y por día local, desde las 03:00 de su zona y solo si hay candidatos. Acá, para ese
 * workspace y ESE día (`local_date` del payload, no "hoy"):
 *
 *  - marca `overdue` todo pago `scheduled` con `due_date < local_date − overdue_grace_days`;
 *  - NO toca `paid`, `cancelled`, `uncollectible` ni `refunded`, ni los pagos de una venta
 *    cancelled, refunded, disputed o subscription_cancelled;
 *  - el `UPDATE ... WHERE status = 'scheduled'` es lo que hace la transición UNA sola vez por pago
 *    (dos corridas a la vez: la segunda no encuentra filas). El trigger de la base emite UN
 *    `payment_status_changed` (scheduled → overdue) por pago y recalcula la venta (→ overdue, con su
 *    `sale_status_changed`); acá solo se audita (actor sistema, «Job de mora») y se actualiza la salud
 *    de pago de cada contacto.
 *
 * Un error de la base lanza (la cola reintenta): no hay proveedores externos.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/types/database";
import { auditAsSystem } from "@/lib/audit";
import { registerJobHandler, type JobContext } from "@/lib/jobs/registry";
import { overdueCutoff, SWEEP_SKIPPED_SALE_STATUSES } from "@/lib/sales/overdue";
import { refreshContactPaymentHealth } from "@/lib/sales/payment-health-run";
import { isDateOnly } from "@/lib/sales/dates";

type Db = SupabaseClient<Database>;

export const PAYMENTS_OVERDUE_SWEEP_JOB = "payments_overdue_sweep";
export const OVERDUE_AUDIT_LABEL = "Job de mora";

const PAGE = 500;
/** Tope de páginas por corrida: 100.000 pagos. Lo que quede lo agarra la corrida de la hora siguiente. */
const MAX_PAGES = 200;

interface SweepPayload {
  workspace_id: string;
  local_date: string;
}

export interface SweepResult {
  marked: number;
  paymentIds: string[];
}

export async function runOverdueSweep(db: Db, workspaceId: string, localDate: string): Promise<SweepResult> {
  const { data: workspace, error: wsError } = await db.from("workspaces").select("id, overdue_grace_days").eq("id", workspaceId).maybeSingle();
  if (wsError) throw new Error(`no pude leer el workspace: ${wsError.message}`);
  if (!workspace) return { marked: 0, paymentIds: [] };

  const cutoff = overdueCutoff(localDate, Number((workspace as { overdue_grace_days?: number | null }).overdue_grace_days) || 0);
  const skipped = new Set<string>(SWEEP_SKIPPED_SALE_STATUSES);
  const marked: Array<{ id: string; sale_id: string }> = [];
  let lastId: string | null = null;

  for (let page = 0; page < MAX_PAGES; page++) {
    let query = db
      .from("payments")
      .select("id, sale_id")
      .eq("workspace_id", workspaceId)
      .eq("status", "scheduled")
      .lt("due_date", cutoff)
      .order("id", { ascending: true })
      .limit(PAGE);
    if (lastId) query = query.gt("id", lastId);
    const { data: candidates, error } = await query;
    if (error) throw new Error(`no pude leer los pagos a vencer: ${error.message}`);
    if (!candidates || candidates.length === 0) break;
    lastId = candidates[candidates.length - 1].id;

    const saleIds = [...new Set(candidates.map((c) => c.sale_id))];
    const { data: sales, error: salesError } = await db.from("sales").select("id, status").in("id", saleIds);
    if (salesError) throw new Error(`no pude leer las ventas: ${salesError.message}`);
    const live = new Set((sales ?? []).filter((s) => !skipped.has(s.status)).map((s) => s.id));
    const ids = candidates.filter((c) => live.has(c.sale_id)).map((c) => c.id);
    if (ids.length > 0) {
      // Condicional sobre el estado: lo que otro proceso ya movió no se vuelve a marcar.
      const { data: updated, error: updateError } = await db
        .from("payments")
        .update({ status: "overdue" } as never)
        .in("id", ids)
        .eq("workspace_id", workspaceId)
        .eq("status", "scheduled")
        .select("id, sale_id");
      if (updateError) throw new Error(`no pude marcar los pagos morosos: ${updateError.message}`);
      marked.push(...((updated ?? []) as Array<{ id: string; sale_id: string }>));
    }
    if (candidates.length < PAGE) break;
  }

  if (marked.length > 0) {
    for (const p of marked) {
      await auditAsSystem({
        supabase: db,
        workspaceId,
        entityType: "payment",
        entityId: p.id,
        action: "payment.overdue",
        changes: { status: { old: "scheduled", new: "overdue" } },
        metadata: { sale_id: p.sale_id, local_date: localDate },
        label: OVERDUE_AUDIT_LABEL,
      });
    }
    const saleIds = [...new Set(marked.map((p) => p.sale_id))];
    const { data: sales } = await db.from("sales").select("contact_id").in("id", saleIds);
    for (const contactId of new Set((sales ?? []).map((s) => s.contact_id))) {
      await refreshContactPaymentHealth(db, workspaceId, contactId);
    }
  }
  return { marked: marked.length, paymentIds: marked.map((p) => p.id) };
}

export async function handlePaymentsOverdueSweep(ctx: JobContext): Promise<void> {
  const payload = ctx.job.payload as unknown as SweepPayload;
  if (!payload?.workspace_id || !isDateOnly(payload.local_date)) return;
  await runOverdueSweep(ctx.supabase, payload.workspace_id, payload.local_date);
}

export function registerPaymentsOverdueSweepHandler(): void {
  registerJobHandler(PAYMENTS_OVERDUE_SWEEP_JOB, handlePaymentsOverdueSweep);
}
