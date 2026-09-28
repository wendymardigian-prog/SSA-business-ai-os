/**
 * El job de un aviso relativo (F44).
 *
 * Cuando llega la hora, este handler NO ejecuta el flow: emite el evento de
 * automatización con el nombre del trigger y lo dispara el cron de siempre.
 * Así los avisos relativos pasan por el mismo camino, la misma idempotencia y
 * el mismo registro que los inmediatos.
 *
 * Antes de emitir vuelve a mirar: si la reunión se canceló o se movió después
 * de agendar el aviso, no se manda nada.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database, Json } from "@/lib/types/database";
import { registerJobHandler, type JobContext } from "@/lib/jobs/registry";
import { RELATIVE_JOB_TYPE } from "@/lib/scheduling/automation/relative";
import { bookingDedupeKey } from "@/lib/scheduling/automation/triggers";

type Db = SupabaseClient<Database>;

interface RelativePayload {
  booking_id: string;
  trigger_id: string;
  trigger_type: string;
  dedupe_key?: string;
}

export async function handleBookingRelativeTrigger(ctx: JobContext): Promise<void> {
  const service = ctx.supabase as Db;
  const payload = ctx.job.payload as unknown as RelativePayload;

  const { data: booking } = await service
    .from("bookings")
    .select("id, workspace_id, contact_id, event_type_id, host_user_id, origin, status, status_group, reschedule_count")
    .eq("id", payload.booking_id)
    .maybeSingle();
  if (!booking) return;

  // Una reunión cancelada no recibe recordatorios.
  if (booking.status_group === "cancelled") return;

  // Si se movió después de agendar el aviso, el aviso es de la fecha vieja:
  // el reagendado ya planificó el suyo.
  const expected = payload.dedupe_key ?? bookingDedupeKey(payload.trigger_type, booking.id, 0);
  const current = bookingDedupeKey(payload.trigger_type, booking.id, booking.reschedule_count ?? 0);
  if (expected !== current) return;

  // El trigger puede haberse apagado o borrado entre medio.
  const { data: trigger } = await service
    .from("triggers")
    .select("id, is_active, flows!inner(status)")
    .eq("id", payload.trigger_id)
    .maybeSingle();
  if (!trigger || !trigger.is_active) return;

  await service.from("automation_events").insert({
    workspace_id: booking.workspace_id,
    event_type: payload.trigger_type,
    contact_id: booking.contact_id,
    payload: {
      booking_id: booking.id,
      event_type_id: booking.event_type_id,
      host_user_id: booking.host_user_id,
      origin: booking.origin,
      trigger_id: payload.trigger_id,
    } as unknown as Json,
  });
}

export function registerBookingRelativeHandler(): void {
  registerJobHandler(RELATIVE_JOB_TYPE, handleBookingRelativeTrigger);
}
