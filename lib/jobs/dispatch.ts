/**
 * Las decisiones de la cola de jobs, extraidas del runner (F30).
 *
 * El runner (`app/api/cron/jobs/route.ts`) hace dos cosas mezcladas: decide
 * (que job se toma, cuanto se espera para reintentar, cuando se da por
 * perdido) y ejecuta. Lo que decide vive aca, puro, porque es lo que no se
 * puede probar contra la base sin esperar minutos reales.
 *
 * Este modulo NO cambia el comportamiento: fija el de hoy, para que sumar
 * tipos nuevos en la etapa 2 no lo mueva sin querer.
 */

/** Cuantas veces se intenta un job antes de darlo por perdido. */
export const MAX_ATTEMPTS = 3;

/** Cuantos jobs toma cada corrida. */
export const BATCH_SIZE = 20;

/** Un job "processing" se considera colgado pasado esto. */
export const STALE_CLAIM_MS = 5 * 60 * 1000;

/**
 * Los turnos del agente NO los toma este runner.
 *
 * Tienen su propia ruta (cada 15 s, sin reintentos). Si este los tomara,
 * caerian en el default y se marcarian completados sin haber respondido.
 */
export const EXCLUDED_TYPES = ["agent_burst"] as const;

export function isExcludedFromRunner(type: string): boolean {
  return (EXCLUDED_TYPES as readonly string[]).includes(type);
}

/**
 * Cuanto se espera antes de reintentar.
 *
 * `2^(intento+1) · 5 s`: 10 s el primero, 20 s el segundo. Corto a proposito:
 * la mayoria de las fallas son de red y se resuelven solas enseguida.
 */
export function retryDelayMs(attempts: number): number {
  return Math.pow(2, attempts + 1) * 5000;
}

export interface JobSnapshot {
  id: string;
  type: string;
  status: string;
  attempts: number;
  claimed_at: string | null;
}

export type ClaimDecision =
  /** Sin claimed_at no se puede saber si esta colgado: se le pone la hora y se espera. */
  | { action: "stamp_only"; reason: string }
  /** Se paso de intentos: se da por perdido sin volver a correrlo. */
  | { action: "fail_exhausted"; reason: string }
  | { action: "claim" };

/**
 * Que hacer con un job antes de ejecutarlo.
 *
 * El caso raro, y el que importa: un job "processing" SIN `claimed_at` puede
 * ser uno de una version vieja que todavia esta corriendo. Tomarlo seria
 * ejecutarlo dos veces en paralelo, que en una publicacion significa publicar
 * dos veces. Se le pone la hora y se lo reclama en la corrida siguiente,
 * cuando ya se pueda demostrar que esta colgado.
 */
export function decideClaim(job: JobSnapshot): ClaimDecision {
  if (job.status === "processing" && !job.claimed_at) {
    return {
      action: "stamp_only",
      reason: "sin claimed_at no se puede probar que esta colgado",
    };
  }

  if (job.attempts >= MAX_ATTEMPTS) {
    return {
      action: "fail_exhausted",
      reason: `Exceeded ${MAX_ATTEMPTS} attempts (stale claim reclaimed)`,
    };
  }

  return { action: "claim" };
}

export type FailureKind = "recheck" | "cancel" | "error";

export type FailureDecision =
  /** No es una falla: se vuelve a encolar mas adelante sin gastar intento. */
  | { action: "requeue"; delayMs: number; keepAttempts: true }
  /** Se termino: se marca fallido y se cierra lo que dependa de el. */
  | { action: "fail" }
  /** Se reintenta con espera. */
  | { action: "retry"; delayMs: number };

/**
 * Que hacer cuando un job falla.
 *
 * Una "revision" no es una falla: el job se fija si algo sigue vivo y, si la
 * respuesta no es concluyente, vuelve a preguntar mas tarde. Gastarle un
 * intento terminaria cancelando una sesion que estaba bien.
 */
export function decideFailure(
  job: Pick<JobSnapshot, "attempts">,
  kind: FailureKind,
  staleInvocationMs: number,
): FailureDecision {
  if (kind === "recheck") {
    return { action: "requeue", delayMs: staleInvocationMs, keepAttempts: true };
  }
  if (kind === "cancel" || job.attempts + 1 >= MAX_ATTEMPTS) {
    return { action: "fail" };
  }
  return { action: "retry", delayMs: retryDelayMs(job.attempts) };
}
