/**
 * Renueva los tokens de las redes antes de que venzan (F12, F15).
 *
 * Semanal. Los tokens largos duran 60 dias y se renuevan faltando 15, asi que
 * una vez por semana sobra. Lo que no se puede renovar se avisa.
 *
 * Recorre TODOS los workspaces: es un cron del sistema, no de una sesion.
 */

import { NextRequest, NextResponse } from "next/server";
import { authorizeCronRequest } from "@/lib/cron-auth";
import { createServiceClient } from "@/lib/supabase/server";
import { getOAuthAdapter } from "@/lib/oauth/registry";
import { planRefresh, warnMessage, type ConnectionToCheck } from "@/lib/social/token-refresh";
import { refreshConnection } from "@/lib/social/refresh-connection";
import { notifyIntegrationAttention } from "@/lib/notifications/integration-alerts";

export async function GET(request: NextRequest) {
  const denied = authorizeCronRequest(request);
  if (denied) return denied;

  const supabase = await createServiceClient();
  const now = new Date();

  // Google Calendar (Etapa 4) no entra: su token se renueva a demanda al
  // usarlo (lib/google-calendar/auth.ts) y sus avisos van a la persona, no a
  // los admins. Un `warn` de aca pisaria el de YouTube con la misma causa.
  const { data: connections, error } = await supabase
    .from("oauth_connections")
    .select("id, workspace_id, provider, status, token_expires_at, vault_secret_prefix")
    .in("status", ["active", "attention"])
    .neq("provider", "google_calendar");

  if (error) {
    console.error("[social-token-refresh] no pude leer las conexiones:", error.message);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  let refreshed = 0;
  let warned = 0;
  let failed = 0;

  for (const row of connections ?? []) {
    const adapter = getOAuthAdapter(row.provider);
    if (!adapter) continue;

    const connection: ConnectionToCheck = {
      id: row.id,
      workspaceId: row.workspace_id,
      provider: row.provider,
      status: row.status,
      tokenExpiresAt: row.token_expires_at,
      canRefresh: Boolean(adapter.refresh),
    };

    const action = planRefresh(connection, now);
    if (action.kind === "skip") continue;

    if (action.kind === "warn") {
      warned++;
      await notifyIntegrationAttention({
        supabase,
        workspaceId: row.workspace_id,
        providerId: row.provider,
        providerLabel: adapter.label,
        cause: "expiring",
        detail: warnMessage(adapter.label, action),
      });
      await supabase
        .from("oauth_connections")
        .update({ status: "attention", last_error: warnMessage(adapter.label, action) })
        .eq("id", row.id);
      continue;
    }

    try {
      await refreshConnection(supabase, row, adapter, now);
      refreshed++;
    } catch (err) {
      failed++;
      const detail = err instanceof Error ? err.message : String(err);
      console.error(`[social-token-refresh] ${row.provider} (${row.workspace_id}):`, detail);

      await supabase
        .from("oauth_connections")
        .update({ status: "attention", last_error: `No pude renovar el acceso: ${detail}` })
        .eq("id", row.id);

      await notifyIntegrationAttention({
        supabase,
        workspaceId: row.workspace_id,
        providerId: row.provider,
        providerLabel: adapter.label,
        cause: "expiring",
        detail: `No pude renovar el acceso a ${adapter.label}. Reconectalo desde Integraciones.`,
      });
    }
  }

  return NextResponse.json({ ok: true, checked: connections?.length ?? 0, refreshed, warned, failed });
}
