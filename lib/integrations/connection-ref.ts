/**
 * De una fila de `oauth_connections` a lo que `integrationStatus()` necesita
 * (G3).
 *
 * `integrationStatus()` no cambia: ya sabe calcular vencimiento y scopes
 * faltantes. Lo que faltaba era construir bien su `ConnectionRef`, y ahi hay
 * una decision que no es trivial.
 */

import { getOAuthAdapter } from "@/lib/oauth/registry";
import type { OAuthAdapter } from "@/lib/oauth/types";
import type { ConnectionRef } from "./status";

/** La fila de `oauth_connections`, en lo que le importa a esto. */
export interface OAuthConnectionRow {
  status: "active" | "attention" | "revoked" | "error";
  token_expires_at: string | null;
  refresh_expires_at: string | null;
  granted_scopes: string[] | null;
  last_error: string | null;
}

/**
 * Arma el `ConnectionRef`, eligiendo QUE fecha de vencimiento importa.
 *
 * `token_expires_at` es el access token. Para Google dura una hora y se
 * renueva solo antes de cada uso (`needsFreshToken` / `refreshConnection` en
 * lib/social/refresh-connection.ts): pasarselo tal cual pondria "El acceso
 * vencio" en rojo permanente para cualquier conexion que sabe renovarse, y
 * seria mentira.
 *
 * - El adaptador sabe renovar solo (`adapter.refresh` existe: Google, Threads):
 *   se usa `refresh_expires_at`, que normalmente es null (no vence). Lo que
 *   hay que avisar no es que el access token vencio —eso se resuelve solo—
 *   sino que se perdio la CAPACIDAD de renovar.
 * - El adaptador no sabe renovar (LinkedIn, sin refresh token en el plan
 *   gratuito): se usa `token_expires_at`, la fecha real en que hay que
 *   reconectar a mano. Es el mismo criterio que ya usa `planRefresh` en
 *   lib/social/token-refresh.ts (solo avisa lo que no se puede renovar).
 */
export function toConnectionRef(
  row: OAuthConnectionRow,
  adapter: Pick<OAuthAdapter, "refresh">,
): ConnectionRef {
  return {
    status: row.status,
    token_expires_at: adapter.refresh ? row.refresh_expires_at : row.token_expires_at,
    granted_scopes: row.granted_scopes,
    last_error: row.last_error,
  };
}

/**
 * Los scopes imprescindibles del proveedor OAuth de una integracion, o una
 * lista vacia si no se conecta por OAuth (entonces `integrationStatus()`
 * nunca marca scopes faltantes).
 */
export function requiredScopesFor(providerId: string): string[] {
  return getOAuthAdapter(providerId)?.requiredScopes ?? [];
}
