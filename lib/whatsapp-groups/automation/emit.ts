/**
 * Emitir un evento de automatizacion de un grupo de WhatsApp. Solo servidor.
 *
 * Los eventos van a la cola `automation_events`, que drena el cron y dispara los flujos. NUNCA lanza: emitir es un
 * efecto secundario de guardar la entrada, la reaccion o el voto. Sin contacto no se emite (no hay sobre quien
 * correr el flujo).
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database, Json } from "@/lib/types/database";
import type { GroupEventPayload, GroupTriggerType } from "./payload";

type Db = SupabaseClient<Database>;

export async function emitGroupEvent(
  db: Db,
  args: { workspaceId: string; contactId: string; type: GroupTriggerType; payload: GroupEventPayload },
): Promise<boolean> {
  try {
    const { error } = await db.from("automation_events").insert({
      workspace_id: args.workspaceId,
      event_type: args.type,
      contact_id: args.contactId,
      source_type: "contact",
      source_id: args.contactId,
      payload: args.payload as unknown as Json,
    });
    if (error) {
      console.error(`[grupos] no pude emitir ${args.type}:`, error.message);
      return false;
    }
    return true;
  } catch (err) {
    console.error(`[grupos] no pude emitir ${args.type}:`, err instanceof Error ? err.message : "error");
    return false;
  }
}
