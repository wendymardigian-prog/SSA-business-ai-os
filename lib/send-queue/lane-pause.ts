/**
 * La pausa de un carril (un número) tras N fallos seguidos, un fallo que impide seguir o un rato sin entregar nada, con
 * su aviso a Owner y Admin. Es la de siempre de la cola de broadcasts (00285); la usa también la cola de WhatsApp de las
 * automatizaciones (00420). Va en su propio archivo para que la cola no importe el despachador de broadcasts.
 *
 * Pausar el carril frena TODO lo que va por la cola de ese número (broadcasts y automatizaciones). Lo que sale al
 * instante (la bandeja, las respuestas a quien escribió) no pasa por el carril y sigue saliendo.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/types/database";
import { notifyWorkspaceAdmins } from "@/lib/notifications";

type Client = SupabaseClient<Database>;

export async function pauseLane(service: Client, channelId: string, workspaceId: string, reason: string, label: string | null): Promise<void> {
  const { data } = await service
    .from("channel_send_lanes")
    .update({ paused_at: new Date().toISOString(), paused_reason: reason.slice(0, 500) })
    .eq("channel_id", channelId)
    .is("paused_at", null)
    .select("channel_id");
  if (!data || data.length === 0) return; // ya estaba pausado: no se avisa dos veces
  await notifyWorkspaceAdmins({
    supabase: service,
    workspaceId,
    kind: "channel_error",
    title: "Se pausaron los envíos por la cola",
    body: `${label ?? "Un canal"}: ${reason} Revisá el número y reanudalo desde la cola de mensajes o desde el broadcast.`,
    entityId: channelId,
    metadata: { source: "send_queue" },
  });
}
