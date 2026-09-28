/**
 * Los avisos relativos a la hora de la reunión (F44). Solo servidor.
 *
 * Un trigger "24 horas antes" no puede evaluarse cuando pasa algo: hay que
 * agendarlo. Cada vez que una agenda nace o se mueve, se recalculan sus
 * avisos: los viejos se anulan (`status = 'cancelled'`, migración 00099) y se
 * agendan los nuevos.
 *
 * Anular en vez de borrar deja el rastro: se puede ver que ese aviso existía y
 * por qué ya no corre.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database, Json } from "@/lib/types/database";
import {
  planRelativeJobs,
  RELATIVE_TRIGGER_TYPES,
  type BookingForFilter,
  type BookingTriggerConfig,
  type PlannedJob,
  type TriggerForPlanning,
} from "./triggers";

type Db = SupabaseClient<Database>;

export const RELATIVE_JOB_TYPE = "booking_relative_trigger";

/** Los triggers relativos activos de un negocio, con su flow publicado. */
export async function activeRelativeTriggers(supabase: Db, workspaceId: string): Promise<TriggerForPlanning[]> {
  const { data } = await supabase
    .from("triggers")
    .select("id, type, is_active, config, flows!inner(status)")
    .eq("workspace_id", workspaceId)
    .in("type", RELATIVE_TRIGGER_TYPES)
    .eq("is_active", true)
    .eq("flows.status", "published");

  return (data ?? []).map((t) => ({
    id: t.id,
    type: t.type,
    is_active: t.is_active,
    config: (t.config ?? {}) as BookingTriggerConfig,
  }));
}

export interface BookingForSync extends BookingForFilter {
  id: string;
  workspace_id: string;
  start_at: string;
  end_at: string;
  created_at: string;
  reschedule_count?: number;
}

/**
 * Recalcula los avisos de una agenda.
 *
 * Devuelve cuántos quedaron agendados. Un aviso cuya hora ya pasó no se
 * agenda: mandar "te recuerdo la reunión de mañana" cuando la reunión fue ayer
 * es peor que no mandar nada.
 */
export async function syncRelativeJobs(supabase: Db, booking: BookingForSync, now: Date = new Date()): Promise<number> {
  const triggers = await activeRelativeTriggers(supabase, booking.workspace_id);
  const planned = planRelativeJobs(booking, triggers, now);

  // Primero se anulan los pendientes: si la reunión se movió, los de la fecha
  // vieja ya no corresponden.
  const { error: cancelError } = await supabase
    .from("scheduled_jobs")
    .update({ status: "cancelled" })
    .eq("type", RELATIVE_JOB_TYPE)
    .eq("payload->>booking_id", booking.id)
    .eq("status", "pending");
  if (cancelError) console.error("[agenda] no pude anular los avisos viejos:", cancelError.message);

  if (planned.length === 0) return 0;

  const { error } = await supabase.from("scheduled_jobs").insert(
    planned.map((job) => ({
      type: RELATIVE_JOB_TYPE,
      payload: {
        booking_id: job.bookingId,
        trigger_id: job.triggerId,
        trigger_type: job.triggerType,
        dedupe_key: job.dedupeKey,
      } as unknown as Json,
      run_at: job.runAt,
      status: "pending" as const,
      // La cola ya tiene su propia idempotencia por clave: si el mismo aviso
      // se planifica dos veces, queda uno.
      dedupe_key: job.dedupeKey,
    })),
  );
  if (error) {
    console.error("[agenda] no pude agendar los avisos:", error.message);
    return 0;
  }
  return planned.length;
}

/**
 * Vuelve a planificar los avisos de las agendas futuras de un negocio.
 *
 * Se llama al prender un flujo con trigger relativo: si no, el recordatorio
 * empezaría a valer recién para las reuniones que se agenden desde ahora, y la
 * persona que lo prendió esperaba que valiera para las que ya tiene.
 */
export async function backfillRelativeJobs(supabase: Db, workspaceId: string, now: Date = new Date()): Promise<number> {
  const { data: bookings } = await supabase
    .from("bookings")
    .select("id, workspace_id, event_type_id, host_user_id, origin, status, category_snapshot, start_at, end_at, created_at, reschedule_count")
    .eq("workspace_id", workspaceId)
    .eq("status_group", "active")
    .gt("end_at", now.toISOString())
    .limit(500);

  let total = 0;
  for (const booking of bookings ?? []) {
    total += await syncRelativeJobs(supabase, booking as unknown as BookingForSync, now);
  }
  return total;
}

export type { PlannedJob };
