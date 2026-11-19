/**
 * Lee si el número ya gastó su cupo, para el aviso del cuadro de escribir (bandeja y grupos). Solo servidor.
 *
 * Cuenta con `send_lane_counts` (TODO lo que sale por el número, 00420) y el ritmo vigente del número (con el
 * calentamiento). Solo números de WhatsApp del negocio indicado; cualquier otra cosa, sin aviso.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/types/database";
import { startOfZonedDay } from "@/lib/dates";
import { isValidTimeZone } from "@/lib/timezone";
import { effectiveQueuePolicy, parseQueuePolicy } from "./policy";
import { manualQuotaWarning, type ManualQuotaWarning } from "./manual-quota";

export async function loadManualQuotaWarning(
  service: SupabaseClient<Database>,
  scope: { workspaceId: string; channelId: string },
  now: Date = new Date(),
): Promise<ManualQuotaWarning | null> {
  const [{ data: channel }, { data: ws }] = await Promise.all([
    service.from("channels").select("platform, provider, send_policy, created_at").eq("id", scope.channelId).eq("workspace_id", scope.workspaceId).maybeSingle(),
    service.from("workspaces").select("timezone").eq("id", scope.workspaceId).maybeSingle(),
  ]);
  if (!channel || channel.platform !== "whatsapp" || channel.provider !== "evolution") return null;

  const tz = ws?.timezone && isValidTimeZone(ws.timezone) ? ws.timezone : "UTC";
  const { data, error } = await service.rpc("send_lane_counts", {
    p_channel_id: scope.channelId,
    p_day_start: startOfZonedDay(now, tz).toISOString(),
    p_now: now.toISOString(),
  });
  if (error) {
    console.error("[cupo manual] no pude contar el cupo del número:", error.message);
    return null;
  }
  const row = (data ?? [])[0];
  if (!row) return null;
  const policy = effectiveQueuePolicy(parseQueuePolicy(channel.send_policy), channel.created_at ? new Date(channel.created_at) : null, now);
  return manualQuotaWarning(policy, { lastHour: row.last_hour ?? 0, today: row.today ?? 0 });
}
