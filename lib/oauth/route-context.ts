/**
 * Quien puede iniciar y completar cada conexion OAuth (F6). Un solo lugar para
 * las dos rutas (`start` y `callback`).
 *
 * Dos casos, siempre explicitos (nunca un `else` que adopte un proveedor
 * nuevo sin que nadie lo decida):
 *  - Por persona (Google Calendar, Fathom): el permiso del adaptador.
 *  - Del workspace (YouTube, LinkedIn, Threads): `integrations.manage` (Equipo y roles, F18).
 */

import { getPermissionAction } from "@/lib/auth/guards";
import type { OAuthAdapter } from "./types";

export type OAuthRouteContext = NonNullable<Awaited<ReturnType<typeof getPermissionAction>>>;

export async function oauthRouteContext(adapter: OAuthAdapter): Promise<OAuthRouteContext | null> {
  if (adapter.perUser) return getPermissionAction(adapter.requiredPermission ?? "scheduling.use");
  return getPermissionAction("integrations.manage");
}

/** El mensaje del 403 de cada caso. */
export function oauthForbiddenMessage(adapter: OAuthAdapter): string {
  if (adapter.provider === "fathom") return "Tu rol no tiene permiso para ver grabaciones, así que no puede conectar Fathom"; // @plantilla-quitar(llamadas)
  if (adapter.perUser) return "No tenes permiso para conectar tu calendario";
  return "No tenés permiso para conectar las cuentas del negocio";
}

/**
 * A donde vuelve una conexion por persona: Google Calendar vuelve a Agenda.
 * Fathom vuelve a su pantalla (Llamadas > Mi Fathom).  @plantilla-quitar(llamadas)
 */
export function perUserLanding(provider: string): string {
  return provider === "fathom" ? "/dashboard/llamadas/mi-fathom" : "/dashboard/agenda/configuracion/calendarios"; // @plantilla-quitar(llamadas)
  // @plantilla-sin(llamadas): return "/dashboard/agenda/configuracion/calendarios";
}
