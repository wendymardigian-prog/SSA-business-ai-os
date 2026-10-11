/**
 * Quien puede iniciar y completar cada conexion OAuth (F6). Un solo lugar para
 * las dos rutas (`start` y `callback`).
 *
 * Tres casos, siempre explicitos (nunca un `else` que adopte un proveedor
 * nuevo sin que nadie lo decida):
 *  - Por persona y para cualquier miembro (`anyMember`: Fathom): el guard de miembro.
 *  - Por persona con permiso (Google Calendar): el permiso del adaptador.
 *  - Del workspace (YouTube, LinkedIn, Threads): Owner o Admin.
 */

import { getAdminContext, getMemberAction, getPermissionAction } from "@/lib/auth/guards";
import type { OAuthAdapter } from "./types";

export type OAuthRouteContext = NonNullable<Awaited<ReturnType<typeof getPermissionAction>>>;

export async function oauthRouteContext(adapter: OAuthAdapter): Promise<OAuthRouteContext | null> {
  if (adapter.perUser && adapter.anyMember) return getMemberAction();
  if (adapter.perUser) return getPermissionAction(adapter.requiredPermission ?? "scheduling.use");
  return getAdminContext() as Promise<OAuthRouteContext | null>;
}

/** El mensaje del 403 de cada caso. */
export function oauthForbiddenMessage(adapter: OAuthAdapter): string {
  if (adapter.perUser && adapter.anyMember) return "Tenés que iniciar sesión para conectar tu cuenta";
  if (adapter.perUser) return "No tenes permiso para conectar tu calendario";
  return "Solo Owner y Admin pueden conectar cuentas";
}

/**
 * A donde vuelve una conexion por persona. Google Calendar sigue volviendo a
 * Agenda; Fathom vuelve a su pantalla (Llamadas > Mi Fathom).
 */
export function perUserLanding(provider: string): string {
  return provider === "fathom" ? "/dashboard/llamadas/mi-fathom" : "/dashboard/agenda/configuracion/calendarios";
}
