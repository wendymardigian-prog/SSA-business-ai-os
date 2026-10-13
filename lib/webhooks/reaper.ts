/**
 * El reaper de webhooks entrantes (F2 paso 10), colgado del cron de jobs (cada minuto).
 *
 * - `received` de hace mas de 2 minutos: el `after()` del receptor no llego a correr (reinicio,
 *   deploy). Se procesan; el claim `received -> processing` evita procesarlos dos veces.
 * - `processing` de hace mas de 15 minutos: el proceso murio a mitad. Se marcan `error` para que
 *   una persona los vea y pueda reprocesar (NO se vuelven a correr solos: ya pudieron haber
 *   mandado mensajes).
 *
 * Casi siempre vacio: usa el indice parcial de pendientes. Nunca lanza.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/types/database";
import { processInbound, alertIfFailing } from "./process";

type Db = SupabaseClient<Database>;

export const RECEIVED_STALE_MS = 2 * 60 * 1000;
export const PROCESSING_STALE_MS = 15 * 60 * 1000;
const BATCH = 25;

export async function reapInboundWebhooks(db: Db, now: Date = new Date()): Promise<{ processed: number; recovered: number }> {
  let processed = 0;
  let recovered = 0;
  try {
    const { data: stale } = await db
      .from("inbound_webhooks")
      .select("id")
      .eq("status", "received")
      .lt("received_at", new Date(now.getTime() - RECEIVED_STALE_MS).toISOString())
      .order("received_at", { ascending: true })
      .limit(BATCH);
    for (const row of stale ?? []) {
      const outcome = await processInbound(db, (row as { id: string }).id);
      if (outcome.kind === "processed") processed++;
    }

    const { data: stuck } = await db
      .from("inbound_webhooks")
      .select("id, workspace_id, endpoint_id")
      .eq("status", "processing")
      .lt("processing_started_at", new Date(now.getTime() - PROCESSING_STALE_MS).toISOString())
      .limit(BATCH);
    for (const row of (stuck ?? []) as { id: string; workspace_id: string; endpoint_id: string }[]) {
      const { data: updated } = await db
        .from("inbound_webhooks")
        .update({
          status: "error",
          error_message: "Se cortó el procesamiento. Revisá el historial y reprocesá el envío.",
          processed_at: now.toISOString(),
        } as never)
        .eq("id", row.id)
        .eq("status", "processing")
        .select("id");
      if ((updated ?? []).length > 0) {
        recovered++;
        await alertIfFailing(db, row.workspace_id, row.endpoint_id, now);
      }
    }
  } catch (err) {
    console.error("[hooks] fallo el reaper de webhooks:", err instanceof Error ? err.message : String(err));
  }
  return { processed, recovered };
}
