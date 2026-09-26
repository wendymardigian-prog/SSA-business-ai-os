import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/types/database";
import { defaultRefresh, type RefreshFn } from "../refresh";
import { refreshHealth, shouldAlertRefreshHealth, ALERT_THRESHOLD_PCT } from "../refresh-health";
import { createNotificationOnce } from "@/lib/notifications/create";

type Db = SupabaseClient<Database>;

/**
 * Salud del refresco de los últimos 7 días (F12). Si más del 5% falla (con
 * volumen), avisa a Owner/Admin una vez por día: sin refresco la verificación
 * antes de responder queda ciega. Se corre desde el job cada 5 minutos, pero la
 * notificación está deduplicada por día.
 */
export async function checkRefreshHealth(service: Db, workspaceId: string): Promise<void> {
  const since = new Date(Date.now() - 7 * 24 * 3_600_000).toISOString();
  const { data, error } = await service
    .from("agent_runs")
    .select("routing")
    .eq("workspace_id", workspaceId)
    .gte("created_at", since)
    .not("routing", "is", null)
    .limit(2000);
  if (error) return;
  const health = refreshHealth((data ?? []).map((r) => (r as { routing?: { refresh?: string } }).routing ?? null));
  if (!shouldAlertRefreshHealth(health)) return;
  await createNotificationOnce({
    supabase: service,
    workspaceId,
    type: "refresh_health",
    title: "El refresco contra Zernio está fallando",
    body: `El ${health.failedPct}% de los refrescos falló en los últimos 7 días (umbral ${ALERT_THRESHOLD_PCT}%). Sin refresco, el agente no ve las respuestas de ManyChat o de la app antes de responder.`,
    withinMinutes: 24 * 60,
  });
}

/**
 * Momento 3 (F6): cada 5 minutos refresca contra Zernio SÓLO las conversaciones
 * con un borrador pendiente o fallido. A este volumen son un puñado. El
 * refresco trae los salientes externos como `external`; el trigger de la base
 * (messages_discard_answered_drafts, 00077) descarta el borrador cuando entra
 * uno posterior a su ráfaga. El job no decide nada: sólo trae datos frescos.
 *
 * Idempotente (correrlo dos veces no hace daño) y con el rate limit de Zernio
 * que ya maneja el refresco. Nunca lanza.
 */
export async function refreshPendingDrafts(
  service: Db,
  opts: { refresh?: RefreshFn } = {},
): Promise<{ conversations: number; refreshed: number; inserted: number }> {
  const refresh = opts.refresh ?? defaultRefresh;

  const { data: drafts, error } = await service
    .from("agent_drafts")
    .select("conversation_id, workspace_id, channel_id, burst_last_inbound_at")
    .in("status", ["pending", "failed"]);
  if (error) {
    console.error("[drafts-refresh] no pude leer los borradores pendientes:", error.message);
    return { conversations: 0, refreshed: 0, inserted: 0 };
  }

  // Una conversación puede tener sólo un borrador vivo, pero deduplicamos por si acaso.
  const seen = new Set<string>();
  const rows = (drafts ?? []) as Array<{
    conversation_id: string;
    workspace_id: string;
    channel_id: string;
    burst_last_inbound_at: string | null;
  }>;

  let refreshed = 0;
  let inserted = 0;
  for (const d of rows) {
    if (seen.has(d.conversation_id)) continue;
    seen.add(d.conversation_id);

    const { data: conv } = await service
      .from("conversations")
      .select("late_conversation_id")
      .eq("id", d.conversation_id)
      .maybeSingle();

    const res = await refresh(service, {
      conversationId: d.conversation_id,
      workspaceId: d.workspace_id,
      channelId: d.channel_id,
      lateConversationId: (conv as { late_conversation_id?: string | null } | null)?.late_conversation_id ?? null,
      sinceIso: d.burst_last_inbound_at ?? new Date(Date.now() - 24 * 3_600_000).toISOString(),
      runId: null,
    });
    refreshed++;
    if (res.inserted > 0) inserted += res.inserted;
  }

  return { conversations: seen.size, refreshed, inserted };
}
