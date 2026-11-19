/**
 * Alerta si un número deja de entregar. PURO.
 *
 * Dos maneras de detectarlo, cualquiera de las dos pausa la cola del número y avisa:
 *   - 5 fallos seguidos (ya existía: `send_policy.pauseAfterFailures`, configurable por número).
 *   - 30 minutos con envíos pendientes sin que se entregue ninguno (`workspaces.send_lane_alert.stalledMinutes`).
 *     Solo cuenta el tiempo en que el número PODÍA enviar: fuera de horario o con el cupo lleno la espera es legítima y
 *     el reloj vuelve a cero (`undelivered_since` = null).
 * Los mensajes guardados no se pierden: siguen en la cola (caducan a su hora, si la tienen) y salen al reanudar.
 */

export const DEFAULT_STALLED_MINUTES = 30;
const MIN_STALLED = 5;
const MAX_STALLED = 24 * 60;

export interface LaneAlertSettings {
  /** Minutos con pendientes y ninguna entrega antes de pausar y avisar. */
  stalledMinutes: number;
}

export function parseLaneAlert(raw: unknown): LaneAlertSettings {
  const r = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
  const n = typeof r.stalledMinutes === "number" && Number.isFinite(r.stalledMinutes) ? Math.round(r.stalledMinutes) : DEFAULT_STALLED_MINUTES;
  return { stalledMinutes: Math.min(MAX_STALLED, Math.max(MIN_STALLED, n)) };
}

/** Lo que llega de la pantalla: un número de minutos entre 5 y 1440. */
export function laneAlertInput(input: unknown): { ok: true; value: LaneAlertSettings } | { ok: false; error: string } {
  const n = typeof input === "number" ? input : typeof input === "string" && input.trim() !== "" ? Number(input) : NaN;
  if (!Number.isInteger(n) || n < MIN_STALLED || n > MAX_STALLED) {
    return { ok: false, error: `Los minutos sin entregar tienen que ser un número entero entre ${MIN_STALLED} y ${MAX_STALLED}.` };
  }
  return { ok: true, value: { stalledMinutes: n } };
}

export type LaneWaitState =
  /** Podía enviar y tenía pendientes: el reloj sigue (o arranca). */
  | "pending"
  /** Entregó algo: el reloj vuelve a cero. */
  | "delivered"
  /** Espera legítima (fuera de horario, cupo lleno) o nada pendiente: el reloj vuelve a cero. */
  | "idle";

/** El nuevo `undelivered_since` del carril. */
export function nextUndeliveredSince(current: string | null, state: LaneWaitState, now: Date): string | null {
  if (state !== "pending") return null;
  return current ?? now.toISOString();
}

/** ¿Hay que pausar y avisar? */
export function isLaneStalled(undeliveredSince: string | null, now: Date, settings: LaneAlertSettings): boolean {
  if (!undeliveredSince) return false;
  const since = new Date(undeliveredSince).getTime();
  if (!Number.isFinite(since)) return false;
  return now.getTime() - since >= settings.stalledMinutes * 60_000;
}

export function stalledReason(settings: LaneAlertSettings): string {
  return `Lleva ${settings.stalledMinutes} minutos con envíos pendientes sin entregar ninguno. Los mensajes siguen guardados en la cola.`;
}
