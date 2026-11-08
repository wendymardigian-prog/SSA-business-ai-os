/**
 * Los cron agrupados (migracion 00349, docs/crons.md).
 *
 * pg_cron abre una conexion y escribe tres veces en cron.job_run_details por
 * cada corrida, haga algo o no. Por eso los cron que corren con la misma
 * frecuencia van en UN trabajo (`private.cron_tick_*`), con cada parte en su
 * propio bloque BEGIN ... EXCEPTION: una que falla no frena a las otras y su
 * error queda en `private.cron_tick_errors`.
 *
 * Una parte es la ruta de la app (pasa por su guarda de CRON_GUARDS) o un cron
 * que corre en la base (TICK_DB_PARTS). El orden de `parts` es el orden en que
 * corren adentro del trabajo. guards.test.ts compara esta lista con la
 * migracion; scripts/verify-cron-guards.mjs, con la base.
 */
import ticksConfig from "./ticks.json";

export interface CronTick {
  /** El nombre del trabajo en pg_cron. */
  job: string;
  /** El horario de pg_cron. */
  schedule: string;
  /** Cada cuantos minutos corre (0.25 = 15 segundos). */
  periodMinutes: number;
  /** La funcion SQL que corre el trabajo. */
  sqlFunction: string;
  /** Las partes, en el orden en que corren. */
  parts: string[];
}

export const CRON_TICKS: readonly CronTick[] = ticksConfig;

/** Las partes que no llaman a la app: corren en la base, con su funcion. */
export const TICK_DB_PARTS: Readonly<Record<string, string>> = {
  "agent-drafts-sweep": "private.sweep_agent_drafts",
  "draft-window-alerts": "private.alert_draft_windows",
};
