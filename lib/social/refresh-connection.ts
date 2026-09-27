/**
 * Renovar el token de una conexion OAuth, en un solo lugar (F10, F12, F15).
 *
 * Antes esto vivia adentro del cron semanal. Alcanzaba para LinkedIn y
 * Threads, cuyos tokens duran 60 dias, pero **no para Google**: su access
 * token dura una hora, asi que entre dos corridas del cron vence seis dias y
 * medio. Todo lo que publique o lea metricas de YouTube en el medio falla con
 * un 401.
 *
 * Por eso ahora tambien se llama justo antes de usar el token, si esta por
 * vencer. La renovacion no esconde una conexion rota: si el refresh falla, la
 * conexion queda en `attention` con el motivo, igual que en el cron.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/types/database";
import { readSecret, storeSecret, oauthSecretName } from "@/lib/vault";
import type { OAuthAdapter } from "@/lib/oauth/types";

type Db = SupabaseClient<Database>;

/**
 * Margen con el que se considera que un token "ya vencio".
 *
 * Una publicacion tarda: si el token vence en dos minutos, para cuando el
 * proveedor conteste ya no vale. Cinco minutos cubren una subida normal.
 */
export const FRESH_TOKEN_MARGIN_MINUTES = 5;

/**
 * Si hay que renovar antes de usarlo.
 *
 * Sin fecha de vencimiento se asume que sirve: es el caso de los tokens que
 * no expiran, y renovar por las dudas gastaria una llamada por publicacion.
 */
export function needsFreshToken(
  expiresAt: string | null | undefined,
  now: Date = new Date(),
  marginMinutes: number = FRESH_TOKEN_MARGIN_MINUTES,
): boolean {
  if (!expiresAt) return false;
  const at = new Date(expiresAt);
  if (Number.isNaN(at.getTime())) return false;
  return at.getTime() - now.getTime() < marginMinutes * 60_000;
}

export interface ConnectionRow {
  id: string;
  workspace_id: string;
  vault_secret_prefix: string;
}

/**
 * Renueva la conexion y guarda el token nuevo en Vault. Devuelve el token
 * nuevo, para que quien lo pidio lo use sin volver a leerlo.
 *
 * Lanza con el motivo si no se puede: el llamador decide si eso es un fallo
 * permanente (publicar) o un aviso (el cron).
 */
export async function refreshConnection(
  supabase: Db,
  row: ConnectionRow,
  adapter: OAuthAdapter,
  now: Date = new Date(),
): Promise<string> {
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

  if (!adapter.refresh) throw new Error(`${adapter.label} no sabe renovar su token`);

  const tokens = await adapter.refresh({ refreshToken: credential, clientId, clientSecret });

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

  return tokens.accessToken;
}
