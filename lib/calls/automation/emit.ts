/**
 * Emitir un evento de automatizacion de Llamadas (F32). Solo servidor.
 *
 * Los eventos van a la cola `automation_events`, que drena el cron
 * `/api/cron/automation-events` y dispara los flujos. Dos reglas:
 *
 *  - NUNCA lanza: emitir es un efecto secundario de analizar o vincular. Si la
 *    cola falla, la llamada queda igual de analizada.
 *  - Una llamada SIN contacto no emite nada (`automation_events.contact_id` es
 *    obligatorio y no hay a quien mandarle el flujo). Cuando despues se vincula,
 *    se emite `call_linked`.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database, Json } from "@/lib/types/database";
import { callEventPayload, type CallTriggerType } from "./triggers";

type Db = SupabaseClient<Database>;

export async function emitCallEvent(db: Db, type: CallTriggerType, callId: string): Promise<boolean> {
  try {
    const { data: call } = await db
      .from("calls")
      .select("id, workspace_id, contact_id, call_type, outcome, closer_score, lead_score, lead_qualification, recorded_by_user_id, booking_id, analysis_run_id")
      .eq("id", callId)
      .is("archived_at", null)
      .maybeSingle();
    if (!call || !call.contact_id) return false;

    const { error } = await db.from("automation_events").insert({
      workspace_id: call.workspace_id,
      event_type: type,
      contact_id: call.contact_id,
      payload: callEventPayload(call) as unknown as Json,
    });
    if (error) {
      console.error(`[llamadas] no pude emitir ${type}:`, error.message);
      return false;
    }
    return true;
  } catch (err) {
    console.error(`[llamadas] no pude emitir ${type}:`, err instanceof Error ? err.message : "error");
    return false;
  }
}
