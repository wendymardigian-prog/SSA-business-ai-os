/**
 * Reagendar (F28 por el invitado, F36 por el anfitrion).
 *
 * El horario nuevo se vuelve a validar en el servidor con datos frescos de
 * Google, excluyendo la propia agenda (si no, se choca consigo misma). La fila
 * es la misma: cambia el rango, sube `reschedule_count` y el estado pasa a
 * "Reagenda". No se crea una agenda nueva, asi el historial queda junto.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database, Json } from "@/lib/types/database";
import { logAudit } from "@/lib/audit";
import { availableSlots, isSlotAvailable } from "@/lib/scheduling/slots";
import { pickNextSlots, suggestNextSlots } from "@/lib/scheduling/next-slots";
import { buildSlotsInput } from "@/lib/scheduling/data/slots-input";
import { inviteeActions, LATE_ACTION_MESSAGE } from "@/lib/scheduling/booking-page";
import { notifyBooking } from "@/lib/scheduling/notifications";
import { cancelPendingJobs } from "./cancel";
import { syncRelativeJobs } from "@/lib/scheduling/automation/relative";
import { BOOKING_ENDED_JOB, BOOKING_GOOGLE_SYNC_JOB } from "@/lib/jobs/handlers/booking-sync";

type Db = SupabaseClient<Database>;

export interface RescheduleInput {
  uid?: string;
  bookingId?: string;
  startUtc: string;
  by: "invitee" | "host";
  reason?: string | null;
  actorUserId?: string | null;
  /** Solo el equipo (F36): mover a un horario que el motor no ofreceria. */
  ignoreAvailability?: boolean;
  /** B-AGE-01: solo el equipo, al estirar la reunión en el calendario. Entre 15 minutos y 8 horas. */
  durationMinutes?: number;
  /** 00430: quien atiende la movió en su Google Calendar. No se vuelve a escribir ahí (sería eco). */
  fromGoogle?: boolean;
  now?: Date;
}

export type RescheduleResult =
  | { ok: true; bookingId: string; uid: string; startUtc: string; endUtc: string }
  | {
      ok: false;
      status: number;
      reason: "not_found" | "too_late" | "slot_unavailable" | "slot_taken" | "temporarily_unavailable";
      message?: string;
      /** B-AGE-11: los huecos libres siguientes (UTC), a confirmar. */
      alternatives?: string[];
    };

export async function rescheduleBooking(service: Db, input: RescheduleInput): Promise<RescheduleResult> {
  const now = input.now ?? new Date();

  let query = service.from("bookings").select("*");
  query = input.uid ? query.eq("uid", input.uid) : query.eq("id", input.bookingId ?? "");
  const { data: booking } = await query.maybeSingle();
  if (!booking) return { ok: false, status: 404, reason: "not_found" };

  const actions = inviteeActions(booking, now);
  const allowed = input.by === "invitee" ? actions.canReschedule : actions.state !== "cancelled";
  if (!allowed) {
    return { ok: false, status: 409, reason: "too_late", message: input.by === "invitee" ? LATE_ACTION_MESSAGE.reschedule : "Una reunión cancelada no se reagenda." };
  }

  const { data: event } = await service.from("event_types").select("*").eq("id", booking.event_type_id).maybeSingle();
  if (!event) return { ok: false, status: 404, reason: "not_found" };
  const { data: profile } = await service
    .from("scheduling_profiles").select("*")
    .eq("workspace_id", booking.workspace_id).eq("user_id", booking.host_user_id).maybeSingle();
  if (!profile) return { ok: false, status: 404, reason: "not_found" };

  const startUtc = new Date(input.startUtc).toISOString();
  // La duracion de ESTA reunion, no la del evento: una reunion a mano de 90 minutos no pasa a 30 al moverla.
  const currentMs = Date.parse(booking.end_at) - Date.parse(booking.start_at);
  const wantedMinutes = input.by === "host" && input.durationMinutes !== undefined ? Math.round(input.durationMinutes) : null;
  if (wantedMinutes !== null && (!Number.isFinite(wantedMinutes) || wantedMinutes < 15 || wantedMinutes > 8 * 60)) {
    return { ok: false, status: 400, reason: "slot_unavailable", message: "La duración tiene que ir de 15 minutos a 8 horas." };
  }
  const durationMs = wantedMinutes !== null ? wantedMinutes * 60_000 : currentMs > 0 ? currentMs : event.duration_minutes * 60_000;
  const endUtc = new Date(new Date(startUtc).getTime() + durationMs).toISOString();

  if (!input.ignoreAvailability) {
    const from = new Date(new Date(startUtc).getTime() - 24 * 60 * 60 * 1000).toISOString();
    const to = new Date(new Date(endUtc).getTime() + 24 * 60 * 60 * 1000).toISOString();
    const built = await buildSlotsInput(service, event, profile, {
      from,
      to,
      inviteeTz: booking.booker_timezone ?? "UTC",
      now,
      freshGoogle: true,
      // La propia agenda no se cuenta como ocupada.
      excludeBookingId: booking.id,
      ignoreMinimumNotice: input.by === "host",
    });
    if (!built.ok) return { ok: false, status: 503, reason: "temporarily_unavailable" };
    if (!isSlotAvailable(built.input, startUtc)) {
      const alternatives = pickNextSlots(availableSlots(built.input).map((s) => s.startUtc), startUtc);
      return { ok: false, status: 409, reason: "slot_unavailable", message: "Ese horario ya no está disponible.", alternatives };
    }
  }

  const previous = { start_at: booking.start_at, end_at: booking.end_at };
  const { error } = await service
    .from("bookings")
    .update({
      start_at: startUtc,
      end_at: endUtc,
      status: "rescheduled",
      status_changed_at: now.toISOString(),
      status_changed_by: input.by === "host" ? input.actorUserId ?? null : null,
      reschedule_count: (booking.reschedule_count ?? 0) + 1,
    })
    .eq("id", booking.id)
    .eq("status_group", "active");
  if (error) {
    // 23P01 = la exclusion: el horario nuevo se ocupo entre la consulta y esto.
    if (error.code === "23P01") {
      // B-AGE-11: se proponen los huecos siguientes del mismo anfitrión, con la duración de ESTA reunión.
      const alternatives = await suggestNextSlots(service, event, profile, {
        requestedUtc: startUtc,
        inviteeTz: booking.booker_timezone ?? "UTC",
        now,
        excludeBookingId: booking.id,
        ignoreMinimumNotice: input.by === "host",
        durationMinutes: durationMs / 60_000,
      });
      return { ok: false, status: 409, reason: "slot_taken", message: "Ese horario se acaba de ocupar.", alternatives };
    }
    console.error("[agenda] no pude reagendar:", error.message);
    return { ok: false, status: 500, reason: "temporarily_unavailable" };
  }

  await logAudit({
    supabase: service,
    workspaceId: booking.workspace_id,
    entityType: "booking",
    entityId: booking.id,
    action: "booking.rescheduled",
    changes: { start_at: { old: previous.start_at, new: startUtc }, end_at: { old: previous.end_at, new: endUtc } },
    metadata: { by: input.by, reason: input.reason ?? null, ...(input.fromGoogle ? { source: "google" } : {}) },
    performedBy: input.by === "host" ? input.actorUserId ?? null : null,
  });

  await service.from("automation_events").insert({
    workspace_id: booking.workspace_id,
    event_type: "booking_rescheduled",
    contact_id: booking.contact_id,
    payload: {
      booking_id: booking.id,
      event_type_id: booking.event_type_id,
      host_user_id: booking.host_user_id,
      by_whom: input.by,
      previous_start_at: previous.start_at,
      reason: input.reason ?? null,
    } as unknown as Json,
  });

  // Los avisos viejos ya no sirven: se anulan y el fin se reprograma. Los
  // relativos los vuelve a agendar syncRelativeJobs (B7a).
  await cancelPendingJobs(service, booking.id);
  await service.from("scheduled_jobs").insert([
    ...(input.fromGoogle
      ? []
      : [{
          type: BOOKING_GOOGLE_SYNC_JOB,
          payload: { booking_id: booking.id, action: booking.google_event_id ? "update" : "create", attempt: 0 } as unknown as Json,
          run_at: now.toISOString(),
          status: "pending" as const,
        }]),
    {
      type: BOOKING_ENDED_JOB,
      payload: { booking_id: booking.id } as unknown as Json,
      run_at: endUtc,
      status: "pending" as const,
    },
  ]);

  // Los avisos relativos se recalculan contra la fecha nueva: los de la vieja
  // ya quedaron anulados adentro de syncRelativeJobs.
  try {
    await syncRelativeJobs(
      service,
      {
        id: booking.id,
        workspace_id: booking.workspace_id,
        event_type_id: booking.event_type_id,
        host_user_id: booking.host_user_id,
        origin: booking.origin,
        status: "rescheduled",
        category_snapshot: booking.category_snapshot as never,
        metadata: booking.metadata as never,
        start_at: startUtc,
        end_at: endUtc,
        created_at: booking.created_at,
        reschedule_count: (booking.reschedule_count ?? 0) + 1,
      },
      now,
    );
  } catch (err) {
    console.error("[agenda] no pude reprogramar los avisos:", err instanceof Error ? err.message : err);
  }

  await notifyBooking(service, booking.id, "booking_rescheduled", {
    actorUserId: input.by === "host" ? input.actorUserId : null,
  });

  return { ok: true, bookingId: booking.id, uid: booking.uid, startUtc, endUtc };
}
