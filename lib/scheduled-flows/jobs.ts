/**
 * Agendar y anular las veces de «En una fecha y hora» en la cola (`scheduled_jobs`). SOLO servidor, con el cliente de
 * servicio (la cola es interna, 00046).
 *
 * Una automatización programada tiene a lo sumo UN trabajo pendiente: el de la próxima vez. Al publicar se anulan los
 * pendientes y se agenda la próxima; al correr, el trabajo agenda la siguiente (si se repite). Despublicar los anula.
 *
 * Tres cosas impiden que una misma vez corra dos veces o que corra algo viejo:
 *   - el trabajo lleva la VERSIÓN publicada: si se volvió a publicar, no corre (el de la versión nueva es el que vale);
 *   - el trabajo vuelve a mirar que esa vez siga siendo de la config (`isOccurrenceOf`);
 *   - el disparo se reclama en `trigger_fires` (`schedule:<vez>`), con su índice único.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/types/database";
import { isValidTimeZone } from "@/lib/timezone";
import { nextOccurrence, scheduledRunKey, SCHEDULED_RUN_JOB, type ScheduledRunPayload } from "./schedule";

type Db = SupabaseClient<Database>;

/** La zona del negocio. Sin poder leerla se lanza: adivinar mandaría la encuesta a otra hora. */
export async function businessTimeZone(db: Db, workspaceId: string): Promise<string> {
  const { data, error } = await db.from("workspaces").select("timezone").eq("id", workspaceId).maybeSingle();
  if (error) throw new Error(`no pude leer la zona horaria del negocio: ${error.message}`);
  const tz = (data as { timezone?: string | null } | null)?.timezone;
  return tz && isValidTimeZone(tz) ? tz : "UTC";
}

/** Anula los trabajos pendientes de una automatización. Nunca lanza. */
export async function cancelScheduledRuns(service: Db, flowId: string): Promise<void> {
  const { error } = await service
    .from("scheduled_jobs")
    .update({ status: "cancelled" })
    .eq("type", SCHEDULED_RUN_JOB)
    .eq("payload->>flowId", flowId)
    .eq("status", "pending");
  if (error) console.error("[programadas] no pude anular las veces pendientes:", error.message);
}

/**
 * Agenda la próxima vez después de `after` (si hay). Devuelve el instante agendado, o null. Lanza solo si no puede
 * escribir en la cola (quien llama decide qué hacer).
 */
export async function scheduleNextRun(
  service: Db,
  args: { workspaceId: string; flowId: string; version: number; config: unknown; timeZone: string; after: Date },
): Promise<Date | null> {
  const next = nextOccurrence(args.config, args.after, args.timeZone);
  if (!next) return null;
  const payload: ScheduledRunPayload = { workspaceId: args.workspaceId, flowId: args.flowId, version: args.version, occurrence: next.toISOString() };
  const { error } = await service.from("scheduled_jobs").insert({
    type: SCHEDULED_RUN_JOB,
    status: "pending",
    payload: payload as never,
    run_at: next.toISOString(),
    dedupe_key: scheduledRunKey(args.flowId, next),
  });
  // 23505 = esa vez ya estaba agendada (dos publicaciones a la vez): no es un error.
  if (error && error.code !== "23505") throw new Error(`no pude agendar la próxima vez: ${error.message}`);
  return next;
}

/**
 * Lo que hace publicar con una automatización programada: anula lo pendiente y agenda la próxima vez de la versión
 * nueva. Sin el disparador programado, solo anula (pudo haber tenido uno antes). Nunca lanza: publicar ya quedó hecho.
 */
export async function syncScheduledRuns(
  service: Db,
  args: { workspaceId: string; flowId: string; version: number; config: unknown | null; now?: Date },
): Promise<{ next: Date | null; error: string | null }> {
  await cancelScheduledRuns(service, args.flowId);
  if (args.config === null) return { next: null, error: null };
  try {
    const timeZone = await businessTimeZone(service, args.workspaceId);
    const next = await scheduleNextRun(service, { ...args, config: args.config, timeZone, after: args.now ?? new Date() });
    return { next, error: null };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("[programadas] no pude agendar la automatización:", message);
    return { next: null, error: message };
  }
}
