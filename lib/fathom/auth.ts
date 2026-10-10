/**
 * El access token vigente de una conexion de Fathom (F7).
 *
 * Modelado sobre `lib/google-calendar/auth.ts`, con tres diferencias que no
 * son un detalle:
 *
 * 1. **Siempre guarda el refresh token nuevo**, ANTES de usar el access token.
 *    El refresh token de Fathom es de UN SOLO USO: cada renovacion devuelve
 *    uno nuevo que reemplaza al anterior. Si no se guarda, la proxima
 *    renovacion falla y la conexion queda muerta. Si Fathom no devuelve uno,
 *    se conserva el anterior.
 * 2. **Serializa la renovacion** con un candado en la base
 *    (`claim_oauth_refresh`). Dos procesos renovando a la vez con el mismo
 *    refresh token dejan la conexion muerta. Quien no toma el candado espera
 *    y relee: si otro ya renovo, usa lo que dejo.
 * 3. **Sin cache entre procesos para el refresh.** El access token vigente si
 *    se cachea en memoria hasta un minuto antes de vencer.
 *
 * Fallas: un 400/401/403 del endpoint de token (`invalid_grant`) deja la
 * conexion en `error` y avisa A LA PERSONA (la cuenta es suya); un 5xx, un 429
 * o la red son `temporary` y la conexion sigue activa.
 *
 * Ningun mensaje, log ni error lleva un token.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/types/database";
import { readSecret, storeSecret, oauthSecretName } from "@/lib/vault";
import { SECRET_NAMES } from "@/lib/secret-names";
import type { FetchLike } from "@/lib/oauth/types";
import { createNotificationOnce } from "@/lib/notifications/create";
import { FathomAuthError, fathomRefresh } from "./oauth-adapter";
import { FathomError } from "./errors";

type Db = SupabaseClient<Database>;

export interface FathomDeps {
  /** Cliente de servicio: leer secretos de Vault exige service role (00143). */
  supabase: Db;
  fetchImpl?: FetchLike;
  now?: () => Date;
  /** Para esperar al otro proceso; los tests lo reemplazan. */
  sleep?: (ms: number) => Promise<void>;
}

/** Cuanto antes de vencer se considera vencido. */
export const TOKEN_MARGIN_MS = 60_000;
/** Cuanto dura el candado de renovacion. */
export const REFRESH_LOCK_SECONDS = 60;
/** Cuantas veces se espera a que otro proceso termine de renovar, y cuanto cada vez. */
export const LOCK_WAIT_ATTEMPTS = 3;
export const LOCK_WAIT_MS = 2_000;

interface CachedToken {
  accessToken: string;
  expiresAt: number;
}
const cache = new Map<string, CachedToken>();

/** Para los tests. */
export function resetFathomTokenCache(): void {
  cache.clear();
}

export interface FathomConnection {
  id: string;
  workspace_id: string;
  user_id: string | null;
  status: string;
  vault_secret_prefix: string;
  token_expires_at: string | null;
  account_label: string | null;
}

const COLUMNS = "id, workspace_id, user_id, status, vault_secret_prefix, token_expires_at, account_label";

export async function loadFathomConnection(supabase: Db, connectionId: string): Promise<FathomConnection> {
  const { data, error } = await supabase
    .from("oauth_connections")
    .select(COLUMNS)
    .eq("id", connectionId)
    .eq("provider", "fathom")
    .maybeSingle();
  if (error || !data) throw new FathomError("No encontré la conexión de Fathom", "permanent", null, "no_connection");
  return data as FathomConnection;
}

/** El aviso a LA PERSONA (no a los admins), una vez por dia. */
export async function notifyFathomConnectionError(supabase: Db, connection: FathomConnection): Promise<void> {
  await createNotificationOnce({
    supabase,
    workspaceId: connection.workspace_id,
    type: "fathom_connection_error",
    title: "Reconectá tu Fathom",
    body: "Fathom dejó de dar acceso. Tus llamadas no se pierden: al reconectar se traen las pendientes.",
    entityType: "fathom",
    entityId: connection.id,
    recipientId: connection.user_id,
    perRecipient: true,
    withinMinutes: 24 * 60,
    metadata: { provider: "fathom", connection_id: connection.id },
  });
}

/** La conexion queda en `error` con el motivo en palabras, y se avisa a la persona. */
async function markError(supabase: Db, connection: FathomConnection, reason: string): Promise<void> {
  await supabase.from("oauth_connections").update({ status: "error", last_error: reason }).eq("id", connection.id);
  await notifyFathomConnectionError(supabase, connection);
}

function isFresh(expiresAt: string | null, nowMs: number): boolean {
  return !!expiresAt && new Date(expiresAt).getTime() - TOKEN_MARGIN_MS > nowMs;
}

async function readStoredAccessToken(deps: FathomDeps, connection: FathomConnection, nowMs: number): Promise<string | null> {
  if (!isFresh(connection.token_expires_at, nowMs)) return null;
  const stored = await readSecret(deps.supabase, connection.workspace_id, oauthSecretName(connection.vault_secret_prefix, "access_token")).catch(() => null);
  if (!stored) return null;
  cache.set(connection.id, { accessToken: stored, expiresAt: new Date(connection.token_expires_at as string).getTime() });
  return stored;
}

/**
 * El access token vigente de la conexion. Renueva si hace falta.
 *
 * Lanza `FathomError` `permanent` si la conexion esta caida o Fathom corto el
 * acceso; `temporary` si Fathom no responde o hay que esperar a otro proceso.
 */
export async function getFathomAccessToken(deps: FathomDeps, connectionId: string): Promise<string> {
  const clock = deps.now ?? (() => new Date());
  const sleep = deps.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  const nowMs = () => clock().getTime();

  const cached = cache.get(connectionId);
  if (cached && cached.expiresAt - TOKEN_MARGIN_MS > nowMs()) return cached.accessToken;

  let connection = await loadFathomConnection(deps.supabase, connectionId);
  if (connection.status === "revoked" || connection.status === "error") {
    throw new FathomError("La conexión de Fathom está caída: hay que reconectar", "permanent", null, connection.status);
  }

  // Si lo guardado sigue vigente, se usa sin pedir nada.
  const fresh = await readStoredAccessToken(deps, connection, nowMs());
  if (fresh) return fresh;

  // Hay que renovar: UN solo proceso a la vez.
  let claimed = false;
  for (let attempt = 0; ; attempt++) {
    const { data } = await deps.supabase.rpc("claim_oauth_refresh", { p_connection_id: connectionId, p_seconds: REFRESH_LOCK_SECONDS });
    claimed = data === true;
    if (claimed) break;
    if (attempt >= LOCK_WAIT_ATTEMPTS) {
      throw new FathomError("Otro proceso está renovando el acceso a Fathom; se reintenta en la próxima vuelta", "temporary", null, "refresh_locked");
    }
    // Otro proceso esta renovando: se espera y se relee lo que dejo.
    await sleep(LOCK_WAIT_MS);
    connection = await loadFathomConnection(deps.supabase, connectionId);
    const theirs = await readStoredAccessToken(deps, connection, nowMs());
    if (theirs) return theirs;
  }

  try {
    // El candado ya es nuestro: pudo haber renovado otro entre que leimos y lo tomamos.
    connection = await loadFathomConnection(deps.supabase, connectionId);
    if (connection.status === "revoked" || connection.status === "error") {
      throw new FathomError("La conexión de Fathom está caída: hay que reconectar", "permanent", null, connection.status);
    }
    const already = await readStoredAccessToken(deps, connection, nowMs());
    if (already) return already;

    return await refreshAndStore(deps, connection, nowMs());
  } finally {
    await deps.supabase.rpc("release_oauth_refresh", { p_connection_id: connectionId });
  }
}

async function refreshAndStore(deps: FathomDeps, connection: FathomConnection, now: number): Promise<string> {
  const ws = connection.workspace_id;
  const prefix = connection.vault_secret_prefix;

  const [refreshToken, clientId, clientSecret] = await Promise.all([
    readSecret(deps.supabase, ws, oauthSecretName(prefix, "refresh_token")).catch(() => null),
    readSecret(deps.supabase, ws, SECRET_NAMES.fathomClientId).catch(() => null),
    readSecret(deps.supabase, ws, SECRET_NAMES.fathomClientSecret).catch(() => null),
  ]);
  if (!refreshToken) {
    await markError(deps.supabase, connection, "Falta el token de renovación: hay que reconectar");
    throw new FathomError("La conexión no tiene token de renovación: hay que reconectar", "permanent", null, "no_refresh_token");
  }
  if (!clientId || !clientSecret) {
    // La app OAuth no esta cargada: es del admin, no de la persona. No se rompe la conexion.
    throw new FathomError("Falta cargar la app de Fathom (Client ID y Secret) en Integraciones", "temporary", null, "missing_client");
  }

  let tokens;
  try {
    tokens = await fathomRefresh({ refreshToken, clientId, clientSecret, fetchImpl: deps.fetchImpl });
  } catch (err) {
    if (err instanceof FathomAuthError && err.isPermanent) {
      await markError(deps.supabase, connection, "Fathom cortó el acceso (el permiso se revocó o venció): hay que reconectar");
      throw new FathomError("El acceso a Fathom se cortó: hay que reconectar", "permanent", err.status, err.code);
    }
    const status = err instanceof FathomAuthError ? err.status : null;
    throw new FathomError(status ? `Fathom respondió ${status} al renovar el acceso` : "No pude comunicarme con Fathom para renovar el acceso", "temporary", status);
  }

  // 1) El refresh token nuevo, ANTES que nada: si no se guarda, la proxima renovacion falla.
  //    Si Fathom no devolvio uno, se conserva el anterior (no se toca).
  if (tokens.refreshToken) {
    const stored = await storeSecret(deps.supabase, ws, oauthSecretName(prefix, "refresh_token"), tokens.refreshToken);
    if (!stored.ok) {
      console.error("[fathom] no pude guardar el token de renovación nuevo");
      await markError(deps.supabase, connection, "no se pudo guardar el token nuevo");
      throw new FathomError("No pude guardar el token nuevo de Fathom", "permanent", null, "vault_write_failed");
    }
  }
  // 2) Despues, el access token.
  const access = await storeSecret(deps.supabase, ws, oauthSecretName(prefix, "access_token"), tokens.accessToken);
  if (!access.ok) {
    console.error("[fathom] no pude guardar el access token nuevo");
    await markError(deps.supabase, connection, "no se pudo guardar el token nuevo");
    throw new FathomError("No pude guardar el token nuevo de Fathom", "permanent", null, "vault_write_failed");
  }

  const expiresAt = now + (tokens.expiresInSeconds ?? 3600) * 1000;
  await deps.supabase
    .from("oauth_connections")
    .update({
      token_expires_at: new Date(expiresAt).toISOString(),
      last_refreshed_at: new Date(now).toISOString(),
    })
    .eq("id", connection.id);

  cache.set(connection.id, { accessToken: tokens.accessToken, expiresAt });
  return tokens.accessToken;
}
