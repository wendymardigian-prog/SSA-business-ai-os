/**
 * El access token de una conexion de Google Calendar (F6).
 *
 * Adaptado de Cal.diy (https://github.com/calcom/cal.diy), MIT License,
 * Copyright (c) 2020-present Cal.com, Inc. (CalendarAuth): el token se
 * renueva con el refresh token de Vault y se cachea en memoria hasta un
 * minuto antes de vencer. Ante `invalid_grant` la conexion queda `revoked`,
 * se avisa A LA PERSONA (no a los admins: la cuenta es suya) y se lanza un
 * error `permanent`.
 *
 * Es distinto de `refreshConnection` de la Etapa 2 a proposito: aquella
 * renueva y deja `attention`; aca revocado es revocado, y el aviso va a
 * quien puede reconectar.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/types/database";
import { readSecret, storeSecret, oauthSecretName } from "@/lib/vault";
import { googleRefresh, isRevoked, GoogleAuthError } from "@/lib/social/google";
import { googleCalendarAdapter } from "@/lib/social/google-calendar";
import type { FetchLike } from "@/lib/oauth/types";
import { createNotificationOnce } from "@/lib/notifications/create";
import { alertEntityId } from "@/lib/notifications/integration-alerts";
import { GoogleCalendarError } from "./errors";

type Db = SupabaseClient<Database>;

export interface GoogleDeps {
  supabase: Db;
  fetchImpl?: FetchLike;
  now?: () => Date;
}

/** Cuanto antes de vencer se considera vencido. */
export const TOKEN_MARGIN_MS = 60_000;

interface CachedToken {
  accessToken: string;
  expiresAt: number;
}

const cache = new Map<string, CachedToken>();

/** Para los tests. */
export function resetTokenCache(): void {
  cache.clear();
}

export interface ConnectionForAuth {
  id: string;
  workspace_id: string;
  user_id: string | null;
  status: string;
  vault_secret_prefix: string;
  token_expires_at: string | null;
  account_label: string | null;
}

export async function loadConnection(supabase: Db, connectionId: string): Promise<ConnectionForAuth> {
  const { data, error } = await supabase
    .from("oauth_connections")
    .select("id, workspace_id, user_id, status, vault_secret_prefix, token_expires_at, account_label")
    .eq("id", connectionId)
    .maybeSingle();
  if (error || !data) {
    throw new GoogleCalendarError("No encontre la conexion de Google Calendar", "permanent", null, "no_connection");
  }
  return data as ConnectionForAuth;
}

/** Marca la conexion revocada y avisa a la persona. Una sola vez por dia. */
export async function markRevoked(
  supabase: Db,
  connection: ConnectionForAuth,
  detail: string,
): Promise<void> {
  await supabase
    .from("oauth_connections")
    .update({ status: "revoked", last_error: detail })
    .eq("id", connection.id);

  await createNotificationOnce({
    supabase,
    workspaceId: connection.workspace_id,
    type: "integration_attention",
    title: `Reconectá tu Google Calendar${connection.account_label ? ` (${connection.account_label})` : ""}`,
    body: "Google cortó el acceso a tu calendario. Hasta que lo reconectes, tus eventos no ofrecen horarios.",
    entityType: "integration",
    entityId: alertEntityId(`google_calendar:${connection.id}`, "revoked"),
    recipientId: connection.user_id,
    metadata: { provider: "google_calendar", cause: "revoked", connection_id: connection.id },
    withinMinutes: 24 * 60,
  });
}

/**
 * El access token vigente de la conexion. Renueva si hace falta.
 *
 * Lanza GoogleCalendarError `permanent` si la conexion esta revocada o el
 * refresh devuelve `invalid_grant`; `temporary` si Google no responde.
 */
export async function getAccessToken(deps: GoogleDeps, connectionId: string): Promise<string> {
  const now = (deps.now ?? (() => new Date()))().getTime();

  const cached = cache.get(connectionId);
  if (cached && cached.expiresAt - TOKEN_MARGIN_MS > now) return cached.accessToken;

  const connection = await loadConnection(deps.supabase, connectionId);
  if (connection.status === "revoked") {
    throw new GoogleCalendarError("La conexion de Google Calendar esta revocada", "permanent", null, "revoked");
  }

  const prefix = connection.vault_secret_prefix;
  const ws = connection.workspace_id;

  // Si el guardado sigue vigente, se usa sin pedir nada.
  const expiresAt = connection.token_expires_at ? new Date(connection.token_expires_at).getTime() : 0;
  if (expiresAt - TOKEN_MARGIN_MS > now) {
    const stored = await readSecret(deps.supabase, ws, oauthSecretName(prefix, "access_token")).catch(() => null);
    if (stored) {
      cache.set(connectionId, { accessToken: stored, expiresAt });
      return stored;
    }
  }

  const [refreshToken, clientId, clientSecret] = await Promise.all([
    readSecret(deps.supabase, ws, oauthSecretName(prefix, "refresh_token")).catch(() => null),
    readSecret(deps.supabase, ws, googleCalendarAdapter.clientIdSecretName).catch(() => null),
    readSecret(deps.supabase, ws, googleCalendarAdapter.clientSecretSecretName).catch(() => null),
  ]);
  if (!refreshToken) {
    throw new GoogleCalendarError("La conexion no tiene refresh token: hay que reconectar", "permanent", null, "no_refresh_token");
  }
  if (!clientId || !clientSecret) {
    throw new GoogleCalendarError("Faltan el Client ID o el Secret de Google", "permanent", null, "missing_client");
  }

  let tokens;
  try {
    tokens = await googleRefresh({ refreshToken, clientId, clientSecret, fetchImpl: deps.fetchImpl });
  } catch (err) {
    if (isRevoked(err)) {
      await markRevoked(deps.supabase, connection, "Google respondio invalid_grant: el acceso se revoco");
      throw new GoogleCalendarError("El acceso a Google Calendar se revoco: hay que reconectar", "permanent", 400, "invalid_grant");
    }
    const status = err instanceof GoogleAuthError ? err.status : null;
    const kind = status && status < 500 && status !== 429 ? "permanent" : "temporary";
    throw new GoogleCalendarError(
      err instanceof Error ? err.message : "No pude renovar el token de Google",
      kind,
      status,
      err instanceof GoogleAuthError ? err.code : null,
    );
  }

  const newExpiresAt = now + (tokens.expiresInSeconds ?? 3600) * 1000;
  await storeSecret(deps.supabase, ws, oauthSecretName(prefix, "access_token"), tokens.accessToken);
  await deps.supabase
    .from("oauth_connections")
    .update({
      token_expires_at: new Date(newExpiresAt).toISOString(),
      last_refreshed_at: new Date(now).toISOString(),
      ...(connection.status === "error" ? { status: "active", last_error: null } : {}),
    })
    .eq("id", connectionId);

  cache.set(connectionId, { accessToken: tokens.accessToken, expiresAt: newExpiresAt });
  return tokens.accessToken;
}
