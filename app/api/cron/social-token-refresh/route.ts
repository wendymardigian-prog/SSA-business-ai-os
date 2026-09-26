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
import { readSecret, storeSecret, oauthSecretName } from "@/lib/vault";
import { getOAuthAdapter } from "@/lib/oauth/registry";
import { planRefresh, warnMessage, type ConnectionToCheck } from "@/lib/social/token-refresh";
import { notifyIntegrationAttention } from "@/lib/notifications/integration-alerts";

export async function GET(request: NextRequest) {
  const denied = authorizeCronRequest(request);
  if (denied) return denied;

  const supabase = await createServiceClient();
  const now = new Date();

  const { data: connections, error } = await supabase
    .from("oauth_connections")
    .select("id, workspace_id, provider, status, token_expires_at, vault_secret_prefix")
    .in("status", ["active", "attention"]);

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
      await refreshOne(supabase, row, adapter, now);
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

/** Renueva una conexion y guarda el token nuevo en Vault. */
async function refreshOne(
  supabase: Awaited<ReturnType<typeof createServiceClient>>,
  row: { id: string; workspace_id: string; vault_secret_prefix: string },
  adapter: NonNullable<ReturnType<typeof getOAuthAdapter>>,
  now: Date,
) {
  const prefix = row.vault_secret_prefix;

  // Threads renueva con el propio token largo; Google, con el refresh token.
  // Por eso se intenta el refresh y, si no hay, se usa el de acceso.
  const [refreshToken, accessToken] = await Promise.all([
    readSecret(supabase, row.workspace_id, oauthSecretName(prefix, "refresh_token")).catch(() => null),
    readSecret(supabase, row.workspace_id, oauthSecretName(prefix, "access_token")).catch(() => null),
  ]);

  const credential = refreshToken || accessToken;
  if (!credential) throw new Error("no hay token guardado en Vault");

  const [clientId, clientSecret] = await Promise.all([
    readSecret(supabase, row.workspace_id, adapter.clientIdSecretName).catch(() => null),
    readSecret(supabase, row.workspace_id, adapter.clientSecretSecretName).catch(() => null),
  ]);
  if (!clientId || !clientSecret) throw new Error("faltan el Client ID o el Secret");

  const tokens = await adapter.refresh!({
    refreshToken: credential,
    clientId,
    clientSecret,
  });

  const stored = await storeSecret(
    supabase,
    row.workspace_id,
    oauthSecretName(prefix, "access_token"),
    tokens.accessToken,
  );
  if (!stored.ok) throw new Error(stored.error);

  // Google no devuelve un refresh nuevo: el que habia sigue valiendo.
  if (tokens.refreshToken) {
    await storeSecret(
      supabase,
      row.workspace_id,
      oauthSecretName(prefix, "refresh_token"),
      tokens.refreshToken,
    );
  }

  await supabase
    .from("oauth_connections")
    .update({
      status: "active",
      last_error: null,
      last_refreshed_at: now.toISOString(),
      token_expires_at: tokens.expiresInSeconds
        ? new Date(now.getTime() + tokens.expiresInSeconds * 1000).toISOString()
        : null,
    })
    .eq("id", row.id);
}
