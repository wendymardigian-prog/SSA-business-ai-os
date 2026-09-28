/**
 * Los jobs de agenda (F26, F43): crear, mover y borrar el evento en Google, y
 * avisar cuando la agenda termino.
 *
 * Los reintentos los agenda ESTE handler (1, 5 y 15 minutos), no la cola: la
 * cola reintenta a los 10 segundos, encima del reintento propio. Es la misma
 * decision que tomo el despachador de contenido en la Etapa 2.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database, Json } from "@/lib/types/database";
import { registerJobHandler, type JobContext } from "@/lib/jobs/registry";
import { createEvent, deleteEvent, updateEvent } from "@/lib/google-calendar/client";
import { GoogleCalendarError } from "@/lib/google-calendar/errors";
import { resolveEventCalendars } from "@/lib/scheduling/resolve-calendars";
import { calendarsForResolve } from "@/lib/scheduling/data/event-context";
import { logAudit } from "@/lib/audit";
import { notifyBooking } from "@/lib/scheduling/notifications";
import { bookingPublicUrl, publicBaseUrl } from "@/lib/scheduling/public-url";

type Db = SupabaseClient<Database>;

export const BOOKING_GOOGLE_SYNC_JOB = "booking_google_sync";
export const BOOKING_ENDED_JOB = "booking_ended";

/** 1, 5 y 15 minutos (F26). Despues del cuarto intento, se da por perdido. */
export const SYNC_RETRY_MINUTES = [1, 5, 15] as const;
export const MAX_SYNC_ATTEMPTS = SYNC_RETRY_MINUTES.length + 1;

export interface SyncPayload {
  booking_id: string;
  action: "create" | "update" | "delete";
  attempt?: number;
}

/** Cuando reintentar, o null si ya no hay que reintentar. */
export function nextSyncRunAt(attempt: number, now: Date = new Date()): Date | null {
  const minutes = SYNC_RETRY_MINUTES[attempt];
  return minutes === undefined ? null : new Date(now.getTime() + minutes * 60_000);
}

/** La descripcion del evento de Google: lo que el anfitrion ya puede ver. */
export function buildDescription(input: {
  bookerName: string | null;
  bookerEmail: string | null;
  bookerPhone: string | null;
  responses: Record<string, unknown>;
  manageUrl: string;
}): string {
  const lines = [
    input.bookerName ? `Contacto: ${input.bookerName}` : null,
    input.bookerEmail ? `Email: ${input.bookerEmail}` : null,
    input.bookerPhone ? `Teléfono: ${input.bookerPhone}` : null,
  ].filter(Boolean) as string[];

  const answers = Object.entries(input.responses).filter(([key]) => !["name", "email", "phone"].includes(key));
  if (answers.length > 0) {
    lines.push("", "Respuestas:");
    for (const [key, value] of answers) {
      lines.push(`· ${key}: ${Array.isArray(value) ? value.join(", ") : String(value ?? "")}`);
    }
  }
  lines.push("", `Reagendar: ${input.manageUrl}/reagendar`, `Cancelar: ${input.manageUrl}`);
  return lines.join("\n");
}

/** El calendario destino efectivo de la agenda, con su conexion. */
async function destinationFor(service: Db, booking: { workspace_id: string; host_user_id: string; event_type_id: string }) {
  const [{ data: event }, { data: profile }, calendars] = await Promise.all([
    service.from("event_types").select("destination_calendar_id, conflict_calendar_ids, location_type").eq("id", booking.event_type_id).maybeSingle(),
    service.from("scheduling_profiles").select("default_destination_calendar_id").eq("workspace_id", booking.workspace_id).eq("user_id", booking.host_user_id).maybeSingle(),
    calendarsForResolve(service, booking.workspace_id, booking.host_user_id),
  ]);
  if (!event) return null;
  const resolved = resolveEventCalendars(
    { destination_calendar_id: event.destination_calendar_id, conflict_calendar_ids: event.conflict_calendar_ids },
    profile ? { default_destination_calendar_id: profile.default_destination_calendar_id } : null,
    calendars,
  );
  if (!resolved.destination) return null;
  const { data: row } = await service
    .from("calendars")
    .select("id, connection_id, external_calendar_id")
    .eq("id", resolved.destination.id)
    .maybeSingle();
  if (!row) return null;
  return { calendarRowId: row.id, connectionId: row.connection_id, externalId: row.external_calendar_id, locationType: event.location_type };
}

export async function handleBookingGoogleSync(ctx: JobContext): Promise<void> {
  const service = ctx.supabase as Db;
  const payload = ctx.job.payload as unknown as SyncPayload;
  const attempt = payload.attempt ?? 0;

  const { data: booking } = await service
    .from("bookings")
    .select("*")
    .eq("id", payload.booking_id)
    .maybeSingle();
  if (!booking) return;

  // Una agenda cancelada no se crea ni se mueve: solo se borra.
  if (payload.action !== "delete" && booking.status_group === "cancelled") return;

  const { data: workspace } = await service.from("workspaces").select("scheduling_public_base_url").eq("id", booking.workspace_id).maybeSingle();
  const manageUrl = bookingPublicUrl(publicBaseUrl(workspace as { scheduling_public_base_url?: string | null }), booking.uid);

  try {
    if (payload.action === "delete") {
      if (booking.google_event_id && booking.google_connection_id && booking.google_calendar_id) {
        const { data: cal } = await service.from("calendars").select("external_calendar_id").eq("id", booking.google_calendar_id).maybeSingle();
        if (cal) {
          await deleteEvent({ supabase: service }, booking.google_connection_id, cal.external_calendar_id, booking.google_event_id);
        }
      }
      await service
        .from("bookings")
        .update({ google_event_deleted_at: new Date().toISOString(), google_sync_status: "synced", google_sync_error: null })
        .eq("id", booking.id);
    } else if (payload.action === "update" && booking.google_event_id && booking.google_connection_id && booking.google_calendar_id) {
      const { data: cal } = await service.from("calendars").select("external_calendar_id").eq("id", booking.google_calendar_id).maybeSingle();
      if (!cal) throw new GoogleCalendarError("El calendario ya no existe", "permanent", null, "no_calendar");
      const updated = await updateEvent({ supabase: service }, booking.google_connection_id, cal.external_calendar_id, booking.google_event_id, {
        startUtc: booking.start_at,
        endUtc: booking.end_at,
        timeZone: booking.host_timezone ?? "UTC",
        description: buildDescription({
          bookerName: booking.booker_name,
          bookerEmail: booking.booker_email,
          bookerPhone: booking.booker_phone,
          responses: (booking.responses as Record<string, unknown>) ?? {},
          manageUrl,
        }),
        locationText: booking.location_type === "manual" ? booking.location_text : undefined,
      });
      await service
        .from("bookings")
        .update({ google_sync_status: "synced", google_sync_error: null, meet_url: updated.meetUrl ?? booking.meet_url })
        .eq("id", booking.id);
    } else {
      const destination = await destinationFor(service, booking);
      if (!destination) {
        // Sin calendario destino no hay nada que crear: no es un error que se
        // reintente, es una configuracion incompleta.
        await service.from("bookings").update({ google_sync_status: "not_applicable" }).eq("id", booking.id);
        return;
      }
      const created = await createEvent({ supabase: service }, destination.connectionId, destination.externalId, {
        bookingUid: booking.uid,
        summary: booking.title,
        description: buildDescription({
          bookerName: booking.booker_name,
          bookerEmail: booking.booker_email,
          bookerPhone: booking.booker_phone,
          responses: (booking.responses as Record<string, unknown>) ?? {},
          manageUrl,
        }),
        startUtc: booking.start_at,
        endUtc: booking.end_at,
        timeZone: booking.host_timezone ?? "UTC",
        attendeeEmail: booking.booker_email,
        attendeeName: booking.booker_name,
        location: booking.location_type === "google_meet" ? { kind: "google_meet" } : { kind: "manual", text: booking.location_text },
      });
      await service
        .from("bookings")
        .update({
          google_connection_id: destination.connectionId,
          google_calendar_id: destination.calendarRowId,
          google_event_id: created.eventId,
          ical_uid: created.iCalUID,
          meet_url: created.meetUrl,
          google_sync_status: "synced",
          google_sync_error: null,
        })
        .eq("id", booking.id);
    }

    await logAudit({
      supabase: service,
      workspaceId: booking.workspace_id,
      entityType: "booking",
      entityId: booking.id,
      action: "booking.sync_ok",
      metadata: { action: payload.action, attempt },
    });
  } catch (err) {
    const temporary = err instanceof GoogleCalendarError && err.kind === "temporary";
    const message = err instanceof Error ? err.message : "Google no respondió";
    const runAt = temporary ? nextSyncRunAt(attempt) : null;

    if (runAt) {
      // El reintento lo agenda este handler, no la cola.
      await service.from("scheduled_jobs").insert({
        type: BOOKING_GOOGLE_SYNC_JOB,
        payload: { ...payload, attempt: attempt + 1 } as unknown as Json,
        run_at: runAt.toISOString(),
        status: "pending",
      });
      await service.from("bookings").update({ google_sync_error: message }).eq("id", booking.id);
      return;
    }

    await service.from("bookings").update({ google_sync_status: "failed", google_sync_error: message }).eq("id", booking.id);
    await logAudit({
      supabase: service,
      workspaceId: booking.workspace_id,
      entityType: "booking",
      entityId: booking.id,
      action: "booking.sync_failed",
      metadata: { action: payload.action, attempt, error: message },
    });
    await notifyBooking(service, booking.id, "booking_sync_failed");
  }
}

/** La hora de la agenda paso: se emite `booking_ended` (F43). */
export async function handleBookingEnded(ctx: JobContext): Promise<void> {
  const service = ctx.supabase as Db;
  const payload = ctx.job.payload as unknown as { booking_id: string };

  const { data: booking } = await service
    .from("bookings")
    .select("id, workspace_id, contact_id, event_type_id, host_user_id, origin, status_group")
    .eq("id", payload.booking_id)
    .maybeSingle();
  if (!booking || booking.status_group === "cancelled") return;

  await service.from("automation_events").insert({
    workspace_id: booking.workspace_id,
    event_type: "booking_ended",
    contact_id: booking.contact_id,
    payload: {
      booking_id: booking.id,
      event_type_id: booking.event_type_id,
      host_user_id: booking.host_user_id,
      origin: booking.origin,
    } as unknown as Json,
  });
}

export function registerBookingJobHandlers(): void {
  registerJobHandler(BOOKING_GOOGLE_SYNC_JOB, handleBookingGoogleSync);
  registerJobHandler(BOOKING_ENDED_JOB, handleBookingEnded);
}
