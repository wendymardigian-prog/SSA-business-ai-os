/**
 * La cola le hace lugar a lo que sale en el momento (decision del 7/11/2026, docs/broadcasts.md).
 *
 * WhatsApp bloquea por NUMERO: un aviso al equipo, una respuesta de la bandeja o un mensaje del agente que salen por el
 * mismo numero que un broadcast cuentan para WhatsApp igual que el broadcast. Esos envios no esperan su turno (salen ya),
 * pero despues de cada uno el proximo turno de la cola de ese numero (`channel_send_lanes.next_send_at`) se corre a
 * ahora + la espera minima del numero. Solo si eso lo atrasa: nunca lo adelanta (el UPDATE lleva la misma guarda).
 *
 * La llaman los dos tramos finales de Evolution (`sendEvolutionDirect` y `sendToGroup`), nunca los envios de la propia
 * cola (`lib/send-queue/dispatch.ts`, que ya corre su turno con `claim_lane_slot`).
 *
 * SOLO servidor, con el cliente de servicio (la tabla no tiene politicas de escritura). Nunca lanza: un fallo aca no
 * puede frenar ni hacer fallar un envio que ya salio.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/types/database";
import { DEFAULT_WHATSAPP_POLICY, laneTurnAfterLiveSend, parsePolicy } from "./pace";

/** Donde correr el turno: el canal del envio y el cliente de servicio. null = el envio es de la cola misma. */
export interface LiveSendLane {
  client: SupabaseClient<Database>;
  channelId: string;
}

export async function makeRoomForLiveSend(lane: LiveSendLane | null, now: Date = new Date()): Promise<void> {
  if (!lane) return;
  try {
    const { client, channelId } = lane;
    // Casi siempre no hay fila (el numero nunca mando un broadcast): una sola lectura y listo.
    const { data: row, error } = await client.from("channel_send_lanes").select("next_send_at").eq("channel_id", channelId).maybeSingle();
    if (error) throw new Error(error.message);
    if (!row) return;

    const { data: channel, error: channelError } = await client.from("channels").select("send_policy").eq("id", channelId).maybeSingle();
    if (channelError) throw new Error(channelError.message);
    const policy = parsePolicy(channel?.send_policy ?? null, DEFAULT_WHATSAPP_POLICY);

    const target = laneTurnAfterLiveSend(policy, new Date(row.next_send_at), now);
    if (!target) return;
    // La guarda va tambien en la base: si el despachador corrio el turno mas lejos entre la lectura y esto, no se pisa.
    const { error: updateError } = await client
      .from("channel_send_lanes")
      .update({ next_send_at: target.toISOString() })
      .eq("channel_id", channelId)
      .lt("next_send_at", target.toISOString());
    if (updateError) throw new Error(updateError.message);
  } catch (err) {
    console.error("[send-queue] no pude correr el turno de la cola después de un envío:", err instanceof Error ? err.message : "error");
  }
}
