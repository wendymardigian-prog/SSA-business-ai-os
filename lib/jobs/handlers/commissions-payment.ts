/**
 * El job `commissions_payment` (Extra I, F53 y F54): genera o revierte las comisiones de UN pago.
 *
 * Lo encola el trigger de `payments` (00235) cuando un pago entra a `paid` (`action: "generate"`) o sale de `paid`
 * (`action: "revert"`). Las dos funciones de la base son idempotentes, así que repetir el job es seguro.
 *
 *   generate → `generate_commissions_for_payment`; con lo creado, avisa a cada persona (una por venta, agrupado).
 *   revert   → `revert_commissions_for_payment`; si alguna comisión ya estaba en un gasto, avisa UNA vez a Owner/Admin.
 *
 * NO lanza por errores de negocio (un pago que ya no existe, una regla sin persona). Lanza SOLO si la base falla al
 * llamar a la función: la cola reintenta. Un aviso que no se pudo crear nunca frena nada.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import { generatedNotice, reviewNeededNotice } from "@/lib/commissions/notices";
import { registerJobHandler, type JobContext } from "@/lib/jobs/registry";
import { createNotification, createNotificationOnce } from "@/lib/notifications/create";
import { toCents } from "@/lib/sales/money";
import type { Database } from "@/lib/types/database";

type Db = SupabaseClient<Database>;

export const COMMISSIONS_PAYMENT_JOB = "commissions_payment";

const isUuid = (v: unknown): v is string => typeof v === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v);

/** Avisa a cada persona (una por venta, agrupado a 10 minutos) lo que se le generó. Nunca lanza. */
async function notifyGenerated(db: Db, createdIds: string[]): Promise<void> {
  try {
    if (createdIds.length === 0) return;
    const { data } = await db.from("commissions").select("id, workspace_id, user_id, amount, sale_id").in("id", createdIds);
    const rows = (data ?? []) as unknown as Array<{ id: string; workspace_id: string; user_id: string | null; amount: unknown; sale_id: string }>;
    const byUser = new Map<string, { workspaceId: string; saleId: string; totalCents: number }>();
    for (const r of rows) {
      if (!r.user_id) continue; // «Sin persona»: no hay a quién avisar
      const slot = byUser.get(r.user_id) ?? { workspaceId: r.workspace_id, saleId: r.sale_id, totalCents: 0 };
      slot.totalCents += toCents(r.amount);
      byUser.set(r.user_id, slot);
    }
    for (const [userId, slot] of byUser) {
      const { data: sale } = await db.from("sales").select("contact_id").eq("id", slot.saleId).maybeSingle();
      const contactId = (sale as { contact_id?: string } | null)?.contact_id;
      let contactName: string | null = null;
      if (contactId) {
        const { data: contact } = await db.from("contacts").select("display_name").eq("id", contactId).maybeSingle();
        contactName = (contact as { display_name?: string | null } | null)?.display_name ?? null;
      }
      const notice = generatedNotice({ totalCents: slot.totalCents, contactName });
      await createNotificationOnce({
        supabase: db, workspaceId: slot.workspaceId, type: "commission_generated", title: notice.title, body: notice.body,
        entityType: "commission", recipientId: userId, perRecipient: true, withinMinutes: 10, metadata: { sale_id: slot.saleId },
      });
    }
  } catch (e) {
    console.error("[commissions_payment] no pude avisar de las comisiones generadas:", e instanceof Error ? e.message : String(e));
  }
}

export async function handleCommissionsPayment(ctx: JobContext): Promise<void> {
  const payload = ctx.job.payload as { payment_id?: unknown; action?: unknown } | null;
  if (!payload || !isUuid(payload.payment_id) || (payload.action !== "generate" && payload.action !== "revert")) return;
  const db = ctx.supabase;

  if (payload.action === "generate") {
    const { data, error } = await db.rpc("generate_commissions_for_payment", { p_payment_id: payload.payment_id });
    if (error) throw new Error(`commissions_payment: no pude generar las comisiones: ${error.message}`);
    const result = (data ?? {}) as { created_ids?: unknown };
    await notifyGenerated(db, Array.isArray(result.created_ids) ? (result.created_ids as unknown[]).filter(isUuid) : []);
    return;
  }

  const { data, error } = await db.rpc("revert_commissions_for_payment", { p_payment_id: payload.payment_id });
  if (error) throw new Error(`commissions_payment: no pude revertir las comisiones: ${error.message}`);
  const review = ((data ?? {}) as { needs_review?: unknown }).needs_review;
  if (Array.isArray(review) && review.length > 0) {
    try {
      const { data: payment } = await db.from("payments").select("workspace_id, sale_id").eq("id", payload.payment_id).maybeSingle();
      const p = payment as { workspace_id?: string; sale_id?: string } | null;
      if (p?.workspace_id) {
        const notice = reviewNeededNotice({ count: review.length });
        await createNotification({
          supabase: db, workspaceId: p.workspace_id, type: "commission_review_needed", title: notice.title, body: notice.body,
          entityType: "commission", metadata: { sale_id: p.sale_id, payment_id: payload.payment_id, count: review.length },
        });
      }
    } catch (e) {
      console.error("[commissions_payment] no pude avisar de la revisión:", e instanceof Error ? e.message : String(e));
    }
  }
}

export function registerCommissionsPaymentHandler(): void {
  registerJobHandler(COMMISSIONS_PAYMENT_JOB, handleCommissionsPayment);
}
