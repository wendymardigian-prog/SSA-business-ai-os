/**
 * La guarda de los cron (migracion 00327, docs/crons.md).
 *
 * pg_cron llama a la app cada 15 segundos o cada minuto. Antes de llamar, la
 * base mira con `private.cron_work_<ruta>` si hay algo que hacer, con las
 * MISMAS condiciones que el handler de `app/api/cron/<ruta>`. Si no hay, no
 * llama. Aunque la guarda diga que no, cada cron llama igual una vez cada
 * `safetyMinutes` (la llamada de seguridad): si la guarda se equivoca, se pierde
 * ese rato, nunca el trabajo.
 *
 * Este archivo es la gemela en TypeScript de la decision
 * (`private.cron_guard_decide`) y el catalogo que los tests comparan con la
 * migracion y con el codigo de cada handler. Si cambia un handler, cambia su
 * guarda: `guards.test.ts` lo avisa.
 */
import guardsConfig from "./guards.json";

/** La guarda mira este rato hacia adelante: la app recibe la llamada un instante despues. */
export const CRON_GUARD_LOOKAHEAD_MS = 5_000;

export interface CronGuard {
  /** La ruta de app/api/cron y el nombre del cron en pg_cron (son iguales). */
  path: string;
  /** La funcion SQL de la guarda. */
  sqlFunction: string;
  /** Cada cuanto llama igual aunque la guarda diga que no hay nada. */
  safetyMinutes: number;
  /** Lo que la guarda NO mira a proposito y queda cubierto por la llamada de seguridad. */
  coveredBySafetyCall?: string;
}

/**
 * Los cron con guarda (guards.json, que tambien lee scripts/verify-cron-guards.mjs).
 * Gemela de la lista de la seccion 5 de la 00327.
 */
export const CRON_GUARDS: readonly CronGuard[] = guardsConfig;

/**
 * Los cron que llaman a la app SIN guarda, con el motivo. Todo cron de
 * `private.call_app_cron` esta en una de las dos listas (lo exige el test).
 */
export const UNGUARDED_CRONS: Readonly<Record<string, string>> = {
  "bg-dispatch": "decide por la hora de cada negocio con planDispatch (TypeScript); 96 llamadas por dia",
  "metrics-sync": "decide por la hora de cada negocio con isSyncHour (TypeScript); 24 llamadas por dia",
  "social-token-refresh": "una vez por semana",
  "content-media-cleanup": "una vez por dia",
};

export interface CronGuardDecisionInput {
  /** Lo que dijo la guarda. null = no hay guarda o fallo: se llama. */
  hasWork: boolean | null;
  /** La ultima llamada a la app por este cron, o null si no hay registro. */
  lastCalledAt: Date | null;
  safetyMs: number | null;
  now: Date;
}

/** Gemela de `private.cron_guard_decide` (casos en guard-decide.cases.json). */
export function shouldCallCron({ hasWork, lastCalledAt, safetyMs, now }: CronGuardDecisionInput): boolean {
  if (hasWork !== false) return true;
  if (!lastCalledAt || safetyMs == null || !Number.isFinite(safetyMs)) return true;
  const last = lastCalledAt.getTime();
  const current = now.getTime();
  if (Number.isNaN(last) || Number.isNaN(current)) return true;
  if (last > current) return true;
  return last <= current - safetyMs;
}
