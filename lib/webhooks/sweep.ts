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
      .lt("received_at", clearBefore)
      .not("payload", "is", null)
      .select("id");
    cleared = (cleared_ ?? []).length;

    const { data: deleted_ } = await db
      .from("inbound_webhooks")
      .delete()
      .lt("received_at", deleteBefore)
      .select("id");
    deleted = (deleted_ ?? []).length;
  } catch (err) {
    console.error("[hooks] fallo la retencion de webhooks:", err instanceof Error ? err.message : String(err));
  }
  return { cleared, deleted };
}
