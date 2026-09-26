/**
 * Renovacion de los tokens largos (F12, F15).
 *
 * Corre una vez por semana. Para cada conexion mira cuanto le queda:
 *   - Mas de 15 dias: no se toca.
 *   - Menos, y el proveedor permite renovar (Threads, Google): se renueva.
 *   - Menos, y NO se puede renovar (LinkedIn): se avisa, porque lo unico que
 *     arregla eso es que una persona vuelva a conectar.
 *   - Revocado: se marca y se avisa una vez, sin reintentar.
 *
 * La decision de que hacer con cada conexion es una funcion pura
 * (`planRefresh`), asi se prueba sin base y sin proveedor.
 */

import type { OAuthConnectionStatus } from "@/lib/types/database";

/** Cuando empieza a preocupar que un token venza. */
export const REFRESH_WHEN_DAYS_LEFT = 15;
/** Cuando se avisa que hay que reconectar a mano. */
export const WARN_WHEN_DAYS_LEFT = 7;

export interface ConnectionToCheck {
  id: string;
  workspaceId: string;
  provider: string;
  status: OAuthConnectionStatus;
  tokenExpiresAt: string | null;
  /** El proveedor permite renovar sin volver a pedir permiso. */
  canRefresh: boolean;
}

export type RefreshAction =
  | { kind: "skip"; reason: "not_due" | "no_expiry" | "revoked" }
  | { kind: "refresh" }
  | { kind: "warn"; daysLeft: number; expired: boolean };

export function daysLeft(expiresAt: string | null, now: Date): number | null {
  if (!expiresAt) return null;
  const at = new Date(expiresAt).getTime();
  if (Number.isNaN(at)) return null;
  return (at - now.getTime()) / (24 * 60 * 60 * 1000);
}

export function planRefresh(connection: ConnectionToCheck, now: Date): RefreshAction {
  // Revocado no se renueva ni se avisa de nuevo cada semana: ya se aviso
  // cuando paso, y la conexion muestra el estado en su card.
  if (connection.status === "revoked") return { kind: "skip", reason: "revoked" };

  const left = daysLeft(connection.tokenExpiresAt, now);
  // Sin vencimiento conocido no hay nada que planificar (un token de system
  // user, por ejemplo, no vence).
  if (left === null) return { kind: "skip", reason: "no_expiry" };

  if (left >= REFRESH_WHEN_DAYS_LEFT) return { kind: "skip", reason: "not_due" };

  if (connection.canRefresh) return { kind: "refresh" };

  // No se puede renovar: se avisa, pero recien cuando esta cerca de verdad.
  // Avisar con 15 dias de un token que no se puede renovar es ruido; con 7 es
  // tiempo suficiente para reconectar sin apuro.
  if (left <= WARN_WHEN_DAYS_LEFT) {
    return { kind: "warn", daysLeft: Math.max(0, Math.ceil(left)), expired: left <= 0 };
  }

  return { kind: "skip", reason: "not_due" };
}

/** El texto del aviso, en palabras y con lo que hay que hacer. */
export function warnMessage(providerLabel: string, action: Extract<RefreshAction, { kind: "warn" }>): string {
  if (action.expired) {
    return `El acceso a ${providerLabel} vencio. Hasta que lo reconectes, lo que este programado en esa red va a fallar.`;
  }
  if (action.daysLeft <= 1) {
    return `El acceso a ${providerLabel} vence hoy. Reconectalo desde Integraciones.`;
  }
  return `El acceso a ${providerLabel} vence en ${action.daysLeft} dias. Reconectalo desde Integraciones.`;
}
