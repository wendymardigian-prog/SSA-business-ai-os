import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/types/database";
import { DECIDABLE_DRAFT_STATUSES } from "./types";

/**
 * Lo que le pasa a un borrador vivo cuando algo cambia afuera de la cola.
 *
 * Estados que tocan las dos funciones: pending y failed. NUNCA sending: un
 * borrador en sending esta saliendo en este instante y lo termina el service
 * role (sent o failed). Si el lead escribio mientras salia, el mensaje sale
 * igual (el mismo caso que sent_early_new_message en envio directo) y el turno
 * del mensaje nuevo deja el borrador siguiente. Si se encuentra uno en sending,
 * no se hace nada y queda anotado en el log.
 *
 * Nunca lanzan: guardar un mensaje o cerrar una conversacion no puede fallar
 * por un borrador. Aceptan el cliente del usuario (la RLS exige decided_by =
 * auth.uid()) o el service role.
 */

type Db = SupabaseClient<Database>;

async function noteInFlight(client: Db, conversationId: string, what: string): Promise<void> {
  const { count } = await client
    .from("agent_drafts")
    .select("id", { count: "exact", head: true })
    .eq("conversation_id", conversationId)
    .eq("status", "sending");
  if (count && count > 0) {
    console.info(`[drafts] ${what}: hay un borrador saliendo en este instante; se deja terminar.`);
  }
}

/**
 * El lead escribio antes de que alguien aprobara: el borrador quedo viejo
 * (aprobarlo mandaria una respuesta que ignora lo ultimo que dijo). El turno
 * del mensaje nuevo genera otro sobre la rafaga completa.
 */
export async function supersedePendingDrafts(client: Db, conversationId: string): Promise<number> {
  try {
    const { data, error } = await client
      .from("agent_drafts")
      .update({ status: "superseded" })
      .eq("conversation_id", conversationId)
      .in("status", DECIDABLE_DRAFT_STATUSES)
      .select("id");
    if (error) {
      console.error("[drafts] no pude marcar el borrador como reemplazado:", error.message);
      return 0;
    }
    await noteInFlight(client, conversationId, "entrante nuevo");
    return data?.length ?? 0;
  } catch (err) {
    console.error("[drafts] no pude marcar el borrador como reemplazado:", err instanceof Error ? err.message : "error desconocido");
    return 0;
  }
}

/**
 * Hubo una salida real por otro lado (una respuesta a mano, un mensaje desde
 * el celular, un cierre): el borrador ya no tiene que salir. Los motivos
 * automaticos llevan el prefijo auto: (AUTO_DISCARD).
 */
export async function discardPendingDrafts(
  client: Db,
  conversationId: string,
  args: { reason: string; decidedBy: string | null; now?: Date },
): Promise<number> {
  try {
    const { data, error } = await client
      .from("agent_drafts")
      .update({
        status: "discarded",
        discard_reason: args.reason,
        decided_by: args.decidedBy,
        decided_at: (args.now ?? new Date()).toISOString(),
      })
      .eq("conversation_id", conversationId)
      .in("status", DECIDABLE_DRAFT_STATUSES)
      .select("id");
    if (error) {
      console.error("[drafts] no pude descartar el borrador:", error.message);
      return 0;
    }
    await noteInFlight(client, conversationId, args.reason);
    return data?.length ?? 0;
  } catch (err) {
    console.error("[drafts] no pude descartar el borrador:", err instanceof Error ? err.message : "error desconocido");
    return 0;
  }
}
