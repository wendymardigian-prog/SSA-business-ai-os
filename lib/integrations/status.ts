/**
 * En que estado esta una integracion (F2).
 *
 * La card tiene que decir de un vistazo si hay algo que hacer. Son cuatro
 * estados y el orden importa: primero lo que ya esta roto, despues lo que se va
 * a romper.
 *
 *   not_connected  todavia no se conecto
 *   error          fallo la ultima vez que se uso
 *   attention      funciona, pero hay que hacer algo pronto
 *   connected      todo en orden
 *
 * Es una funcion pura: recibe lo que ya se leyo de la base y no consulta nada.
 */

import type { UsageSnapshot } from "./usage";

export type IntegrationStatus = "not_connected" | "connected" | "attention" | "error";

/** Con cuantos dias de anticipacion se avisa que un token vence. */
export const EXPIRY_WARNING_DAYS = 7;

/**
 * Cuanto vale un `last_error` guardado.
 *
 * `integration_configs` no guarda cuando fallo, solo el texto del error y el
 * `updated_at` de la fila. Un error de hace meses que nadie limpio no puede
 * dejar la card en rojo para siempre: pasada esta ventana se considera viejo.
 */
export const ERROR_FRESHNESS_DAYS = 7;

const DAY_MS = 24 * 60 * 60 * 1000;

/** La fila de `integration_configs`, en lo que le importa al estado. */
export interface ConfigRef {
  is_active: boolean;
  last_error?: string | null;
  updated_at?: string | null;
}

/** La conexion OAuth de la integracion, cuando usa una (bloque 2). */
export interface ConnectionRef {
  status: "active" | "attention" | "revoked" | "error";
  token_expires_at?: string | null;
  granted_scopes?: string[] | null;
  last_error?: string | null;
}

export interface StatusInput {
  config?: ConfigRef | null;
  connection?: ConnectionRef | null;
  /** Permisos que la integracion necesita para hacer su trabajo. */
  requiredScopes?: string[];
  usage?: UsageSnapshot | null;
  now?: Date;
}

export interface StatusResult {
  status: IntegrationStatus;
  /** Por que, en palabras, para mostrarlo en la card. Vacio si esta todo bien. */
  reasons: string[];
}

function daysUntil(iso: string | null | undefined, now: Date): number | null {
  if (!iso) return null;
  const at = new Date(iso).getTime();
  if (Number.isNaN(at)) return null;
  return (at - now.getTime()) / DAY_MS;
}

function isFresh(iso: string | null | undefined, now: Date, days: number): boolean {
  if (!iso) return true; // sin fecha no se puede descartar: se toma como vigente
  const at = new Date(iso).getTime();
  if (Number.isNaN(at)) return true;
  return now.getTime() - at <= days * DAY_MS;
}

export function integrationStatus(input: StatusInput): StatusResult {
  const now = input.now ?? new Date();
  const { config, connection, usage } = input;

  // Sin fila y sin conexion, o desactivada a mano: no esta conectada. Un error
  // viejo de una integracion desconectada no tiene por que verse en rojo.
  const connected = (config?.is_active ?? false) || Boolean(connection);
  if (!connected) return { status: "not_connected", reasons: [] };

  const reasons: string[] = [];

  // ── Roto ────────────────────────────────────────────────────────────────
  if (connection?.status === "revoked") {
    return { status: "error", reasons: ["Se revoco el acceso. Hay que volver a conectar."] };
  }
  if (connection?.status === "error") {
    return { status: "error", reasons: [connection.last_error || "La ultima conexion fallo."] };
  }
  if (config?.last_error && isFresh(config.updated_at, now, ERROR_FRESHNESS_DAYS)) {
    return { status: "error", reasons: [config.last_error] };
  }

  // ── Anda, pero hay algo que hacer ───────────────────────────────────────
  const remaining = daysUntil(connection?.token_expires_at, now);
  if (remaining !== null && remaining <= 0) {
    return { status: "error", reasons: ["El acceso vencio. Hay que volver a conectar."] };
  }
  if (remaining !== null && remaining <= EXPIRY_WARNING_DAYS) {
    const days = Math.max(0, Math.ceil(remaining));
    reasons.push(days <= 1 ? "El acceso vence hoy." : `El acceso vence en ${days} dias.`);
  }

  const granted = connection?.granted_scopes ?? null;
  const missing = (input.requiredScopes ?? []).filter((scope) => granted !== null && !granted.includes(scope));
  if (missing.length > 0) {
    reasons.push(`Faltan permisos: ${missing.join(", ")}.`);
  }

  if (connection?.status === "attention") {
    reasons.push(connection.last_error || "Necesita una revision.");
  }

  if (usage?.needsAttention) {
    reasons.push(usage.atLimit ? `Llegaste al tope: ${usage.text}.` : `Estas cerca del tope: ${usage.text}.`);
  }

  return reasons.length > 0 ? { status: "attention", reasons } : { status: "connected", reasons: [] };
}

/** Las que el filtro "Requiere atencion" tiene que mostrar. */
export function needsAttention(status: IntegrationStatus): boolean {
  return status === "attention" || status === "error";
}

export const STATUS_LABELS: Record<IntegrationStatus, string> = {
  not_connected: "Sin conectar",
  connected: "Conectada",
  attention: "Requiere atencion",
  error: "Con error",
};
