/**
 * Registro de tipos de job (F30).
 *
 * El runner tenia un `switch` con cuatro casos y un `default` que marcaba
 * cualquier otro tipo como completado con un `console.warn`. Eso fue
 * suficiente mientras los tipos los escribia la misma persona que el runner;
 * con contenido, metricas y anuncios sumando tipos, un tipo mal escrito
 * pasaria por completado sin hacer nada y nadie se enteraria.
 *
 * Ahora: un tipo registrado corre su handler; uno desconocido queda FALLIDO.
 * Fallido se ve; completado no.
 *
 * Los tipos que ya existian conservan exactamente su comportamiento, incluido
 * `bg_task`, que hoy no hace nada y sigue sin hacerlo (con un handler
 * explicito que lo dice, en vez de caer en el default).
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/types/database";

export interface JobContext {
  supabase: SupabaseClient<Database>;
  job: {
    id: string;
    type: string;
    payload: unknown;
    attempts: number;
  };
}

export type JobHandler = (context: JobContext) => Promise<void>;

const handlers = new Map<string, JobHandler>();

export function registerJobHandler(type: string, handler: JobHandler): void {
  handlers.set(type, handler);
}

export function getJobHandler(type: string): JobHandler | undefined {
  return handlers.get(type);
}

export function registeredJobTypes(): string[] {
  return [...handlers.keys()].sort();
}

/** Error de un tipo que nadie sabe ejecutar. Termina el job en fallido. */
export class UnknownJobTypeError extends Error {
  constructor(readonly type: string) {
    super(`No hay quien ejecute un job de tipo "${type}"`);
    this.name = "UnknownJobTypeError";
  }
}

/** Para los tests: deja el registro como estaba. */
export function resetJobHandlers(): void {
  handlers.clear();
}
