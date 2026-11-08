"use server";

import { getPermissionAction } from "@/lib/auth/guards";
import { createServiceClient } from "@/lib/supabase/server";
import { resolveViewerTimezone } from "@/lib/user-timezone";
import { dailySeries, dailySince, withProjection, type DailyPoint, type DailyRow } from "@/lib/whatsapp-stats/daily";
import { loadProjection } from "@/lib/whatsapp-stats/projection-load";

/**
 * El grafico diario de un numero de WhatsApp (00348/00349), en su tarjeta de canal, con la proyeccion de los proximos
 * 7 dias (`lib/whatsapp-stats/projection-load.ts`). Pide `channels.manage`, como el resto de
 * la tarjeta. Cuenta en la base (`whatsapp_channel_daily_messages`, solo `service_role`) con el workspace de la sesion
 * y solo devuelve cuentas por dia: ningun mensaje ni dato de contacto.
 */

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

type Result<T = object> = ({ ok: true } & T) | { ok: false; error: string };

export async function loadWhatsappDailyMessages(channelId: string): Promise<Result<{ series: DailyPoint[]; timeZone: string }>> {
  if (!UUID.test(channelId ?? "")) return { ok: false, error: "Pedido inválido." };
  const ctx = await getPermissionAction("channels.manage");
  if (!ctx) return { ok: false, error: "Tu rol no puede ver los números de WhatsApp." };
  const service = await createServiceClient();
  const { data: channel } = await service
    .from("channels")
    .select("id, provider")
    .eq("id", channelId)
    .eq("workspace_id", ctx.workspace.id)
    .maybeSingle();
  if (!channel || channel.provider !== "evolution") return { ok: false, error: "Ese número de WhatsApp no existe." };

  const timeZone = await resolveViewerTimezone(ctx.workspace.timezone);
  const now = new Date();
  const { data, error } = await service.rpc("whatsapp_channel_daily_messages", {
    p_workspace_id: ctx.workspace.id,
    p_channel_id: channelId,
    p_since: dailySince(now, timeZone).toISOString(),
    p_time_zone: timeZone,
  });
  if (error) {
    console.error("[whatsapp] no pude contar los mensajes por dia:", error.message);
    return { ok: false, error: "No pude leer los mensajes de este número. Probá de nuevo." };
  }
  const past = dailySeries((data ?? []) as DailyRow[], now, timeZone);
  // Lo que viene: broadcasts en cola, pasos de secuencias y automatizaciones programadas a grupos. Nunca frena.
  const projection = await loadProjection(service, {
    workspaceId: ctx.workspace.id,
    channelId,
    now,
    viewerTimeZone: timeZone,
    laneTimeZone: ctx.workspace.timezone || "UTC",
    broadcastsSentToday: past[past.length - 1]?.broadcast ?? 0,
  });
  return { ok: true, series: withProjection(past, projection), timeZone };
}
