/**
 * La retencion de los envios (F7), una vez por dia: el payload se vacia a los 90 dias y la fila
 * se borra a los 12 meses. Con el cliente de servicio (las tablas no tienen policy de borrado).
 * Nunca lanza.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/types/database";
import { retentionCutoffs } from "./retention";

type Db = SupabaseClient<Database>;

export async function sweepInboundRetention(db: Db, now: Date = new Date()): Promise<{ cleared: number; deleted: number }> {
  const { clearBefore, deleteBefore } = retentionCutoffs(now);
  let cleared = 0;
  let deleted = 0;
  try {
    const { data: cleared_ } = await db
      .from("inbound_webhooks")
      .update({ payload: null, query: null } as never)
      .lte("received_at", clearBefore)
      .not("payload", "is", null)
      .select("id");
    cleared = (cleared_ ?? []).length;

    // Los envios de mas de 12 meses, de a 500. Una sesion de flujo que quedo SIN contacto (arranco por
    // este envio y nunca consiguio uno) no puede sobrevivir al envio: su FK es SET NULL y el CHECK
    // `flow_sessions_contact_or_member` (00187) la rechazaria. Se borra antes; las que tienen contacto
    // se conservan (pierden solo el vinculo al envio).
    const { data: old } = await db.from("inbound_webhooks").select("id").lte("received_at", deleteBefore).limit(500);
    const ids = ((old ?? []) as { id: string }[]).map((r) => r.id);
    if (ids.length > 0) {
      await db.from("flow_sessions").delete().in("inbound_webhook_id" as never, ids).is("contact_id", null).is("member_user_id", null);
      const { data: deleted_ } = await db.from("inbound_webhooks").delete().in("id", ids).select("id");
      deleted = (deleted_ ?? []).length;
    }
  } catch (err) {
    console.error("[hooks] fallo la retencion de webhooks:", err instanceof Error ? err.message : String(err));
  }
  return { cleared, deleted };
}
