/**
 * El job `google_calendar_inbound` (00430): lee los cambios del Google Calendar de quien atiende y, si movió o
 * canceló ahí una reunión creada en la plataforma, lo refleja acá. Lo encola
 * `private.enqueue_google_calendar_inbound()` (00430, parte del cron de cada 5 minutos) por calendario.
 *
 * - Lee con el `calendars.sync_token` (00095); sin token o con 410, lectura completa desde ayer (o desde 60 días atrás
 *   si el calendario se muestra en la Agenda, 00510).
 * - 00510: si el calendario tiene «Mostrar en Agenda», guarda la copia de sus eventos (`google_calendar_events`).
 *   La ida y vuelta solo toca reuniones que terminaron hace menos de 24 h (`withinReconcileHorizon`).
 * - Solo mira los eventos que son de una reunión de ESTE calendario (`bookings.google_event_id` +
 *   `google_calendar_id`): cada evento tiene un solo dueño y los eventos propios de Google no se importan
 *   (cuentan como ocupado por freeBusy).
 * - Mueve o cancela con `rescheduleBooking` / `cancelBooking` con `fromGoogle`, que no vuelven a escribir en Google.
 * - Sin eco: si la plataforma tiene un `booking_google_sync` pendiente (mover, reasignar, cancelar), gana la plataforma.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database, Json } from "@/lib/types/database";
import { registerJobHandler, type JobContext } from "@/lib/jobs/registry";
import { listEvents, type ListEventsResult } from "@/lib/google-calendar/client";
import type { GoogleDeps } from "@/lib/google-calendar/auth";
import { GoogleCalendarError } from "@/lib/google-calendar/errors";
import { decideInbound, fullSyncFrom, withinReconcileHorizon } from "@/lib/google-calendar/inbound";
import { mirrorFullSyncFrom, mirrorWindow, toMirrorRow, type MirrorRow } from "@/lib/google-calendar/mirror";
import { rescheduleBooking } from "@/lib/scheduling/booking/reschedule";
import { cancelBooking } from "@/lib/scheduling/booking/cancel";
import { logAudit } from "@/lib/audit";
import { createNotification } from "@/lib/notifications/create";
import { BOOKING_GOOGLE_SYNC_JOB } from "./booking-sync";

type Db = SupabaseClient<Database>;

export const GOOGLE_CALENDAR_INBOUND_JOB = "google_calendar_inbound";

export interface InboundResult {
  moved: number;
  cancelled: number;
  ignored: number;
  failed: number;
  /** 00510: filas de la copia de la Agenda guardadas y borradas. */
  mirrored: number;
  removed: number;
  fullSync: boolean;
  /** null = no se pudo leer (conexion rota o Google caido): el token no se toca. */
  error: string | null;
}

/**
 * Cuánto dura el candado de una lectura (si el proceso muere, se libera solo). La primera lectura de un calendario con
 * muchos eventos (60 días atrás, las repeticiones expandidas) tarda más de un par de minutos: al terminar se libera.
 */
const LOCK_MS = 10 * 60 * 1000;
/** La primera lectura de la copia puede traer muchos eventos (60 días atrás, recurrentes expandidos). */
const MIRROR_FULL_SYNC_MAX_PAGES = 60;
const UPSERT_CHUNK = 200;

export async function syncCalendarInbound(deps: GoogleDeps, calendarRowId: string): Promise<InboundResult> {
  const service = deps.supabase;
  const now = deps.now?.() ?? new Date();
  const result: InboundResult = { moved: 0, cancelled: 0, ignored: 0, failed: 0, mirrored: 0, removed: 0, fullSync: false, error: null };

  const { data: cal } = await service
    .from("calendars")
    .select("id, workspace_id, user_id, connection_id, external_calendar_id, sync_token, is_active, show_in_agenda, events_synced_at")
    .eq("id", calendarRowId)
    .maybeSingle();
  if (!cal || !cal.is_active) return { ...result, error: "calendar_missing" };

  // 00510: una lectura a la vez por calendario (el cron y «Actualizar» de la Agenda comparten el sync_token).
  const { data: locked } = await service
    .from("calendars")
    .update({ events_sync_lock_until: new Date(now.getTime() + LOCK_MS).toISOString() })
    .eq("id", cal.id)
    .or(`events_sync_lock_until.is.null,events_sync_lock_until.lt.${now.toISOString()}`)
    .select("id")
    .maybeSingle();
  if (!locked) return { ...result, error: "busy" };

  try {
    return await readAndApply(deps, cal, now, result);
  } finally {
    await service.from("calendars").update({ events_sync_lock_until: null }).eq("id", cal.id);
  }
}

type CalendarForSync = {
  id: string;
  workspace_id: string;
  user_id: string;
  connection_id: string;
  external_calendar_id: string;
  sync_token: string | null;
  show_in_agenda: boolean;
  events_synced_at: string | null;
};

async function readAndApply(deps: GoogleDeps, cal: CalendarForSync, now: Date, result: InboundResult): Promise<InboundResult> {
  const service = deps.supabase;
  const mirroring = cal.show_in_agenda;
  // La primera vez que se copia un calendario se lee desde 60 días atrás (el token que hubiera es de la ventana de
  // la ida y vuelta, de un día).
  const backfill = mirroring && !cal.events_synced_at;

  let changes;
  try {
    changes = await listEvents(deps, cal.connection_id, cal.external_calendar_id, {
      syncToken: backfill ? null : cal.sync_token,
      fullSyncFrom: mirroring ? mirrorFullSyncFrom(now) : fullSyncFrom(now),
      ...(mirroring ? { fullSyncMaxPages: MIRROR_FULL_SYNC_MAX_PAGES } : {}),
    });
  } catch (err) {
    // Conexión rota: acá solo se espera a que se reconecte; el token no se toca.
    const kind = err instanceof GoogleCalendarError ? err.kind : "temporary";
    console.warn(`[agenda] no pude leer los cambios de Google (${kind})`);
    return { ...result, error: kind };
  }
  result.fullSync = changes.fullSync;

  const ids = [...new Set(changes.items.map((i) => i.id))];
  const bookings = ids.length === 0 ? [] : (
    await service
      .from("bookings")
      .select("id, uid, workspace_id, host_user_id, google_event_id, start_at, end_at, status_group, metadata")
      .eq("workspace_id", cal.workspace_id)
      .eq("google_calendar_id", cal.id)
      .in("google_event_id", ids)
  ).data ?? [];
  const byEvent = new Map(bookings.map((b) => [b.google_event_id as string, b]));

  const pending = new Set<string>();
  if (bookings.length > 0) {
    const { data: jobs } = await service
      .from("scheduled_jobs")
      .select("payload")
      .eq("type", BOOKING_GOOGLE_SYNC_JOB)
      .in("status", ["pending", "processing"])
      .in("payload->>booking_id", bookings.map((b) => b.id));
    for (const j of jobs ?? []) {
      const id = (j.payload as { booking_id?: string } | null)?.booking_id;
      if (id) pending.add(id);
    }
  }

  for (const event of changes.items) {
    const booking = byEvent.get(event.id);
    if (!booking) {
      // Evento propio de Google (o de otro calendario): no es una reunión. Si el calendario se muestra en la Agenda,
      // va a la copia (abajo).
      result.ignored++;
      continue;
    }
    // 00510: la copia lee 60 días atrás, pero una reunión que terminó hace más de 24 h no se toca por Google.
    if (!withinReconcileHorizon(booking.end_at, now)) {
      result.ignored++;
      continue;
    }
    const decision = decideInbound(event, {
      id: booking.id,
      start_at: booking.start_at,
      end_at: booking.end_at,
      status_group: booking.status_group,
    }, { pendingPlatformSync: pending.has(booking.id) });

    if (decision.kind === "ignore") {
      result.ignored++;
    } else if (decision.kind === "move") {
      const r = await rescheduleBooking(service, {
        bookingId: booking.id,
        startUtc: decision.startUtc,
        durationMinutes: decision.durationMinutes,
        by: "host",
        actorUserId: booking.host_user_id,
        // Lo eligió quien atiende en su calendario: no se comprueba contra los horarios ofrecidos. La exclusión de la base
        // (dos reuniones a la vez del mismo anfitrión) sigue valiendo.
        ignoreAvailability: true,
        reason: "Movida en Google Calendar",
        fromGoogle: true,
        now,
      });
      if (r.ok) result.moved++;
      else {
        result.failed++;
        await logAudit({
          supabase: service,
          workspaceId: booking.workspace_id,
          entityType: "booking",
          entityId: booking.id,
          action: "booking.google_move_rejected",
          metadata: { source: "google", reason: r.reason, wanted_start: decision.startUtc } as unknown as Record<string, Json>,
          performedBy: null,
        });
      }
    } else {
      const r = await cancelBooking(service, {
        bookingId: booking.id,
        by: "host",
        actorUserId: booking.host_user_id,
        reason: "Cancelada en Google Calendar",
        fromGoogle: true,
        now,
      });
      if (r.ok) {
        result.cancelled++;
        // 00524: una fecha de una serie de reuniones borrada en Google no se vuelve a crear: su vuelta queda «por
        // agendar» (el enganche de la base) y quien atiende se entera para agendarla o darla por perdida.
        if (typeof (booking.metadata as { series_id?: unknown } | null)?.series_id === "string") {
          await createNotification({
            supabase: service,
            workspaceId: booking.workspace_id,
            recipientId: booking.host_user_id,
            type: "booking_cancelled",
            title: "Borraron en Google una reunión de la serie",
            body: "Su vuelta volvió a «Por agendar»: agendala de nuevo o dala por perdida en la ficha del servicio.",
            entityType: "booking",
            entityId: booking.id,
          });
        }
      } else result.failed++;
    }
  }

  if (mirroring) {
    try {
      await applyMirror(service, cal, changes, byEvent, now, result);
    } catch (err) {
      // La copia nunca frena la ida y vuelta: se reintenta en la próxima lectura (el token no avanza).
      console.warn(`[agenda] no pude guardar la copia de Google Calendar: ${err instanceof Error ? err.message : "error"}`);
      return { ...result, error: "mirror_failed" };
    }
  }

  const patch: Database["public"]["Tables"]["calendars"]["Update"] = {};
  if (changes.nextSyncToken) patch.sync_token = changes.nextSyncToken;
  if (mirroring) patch.events_synced_at = now.toISOString();
  if (Object.keys(patch).length > 0) await service.from("calendars").update(patch).eq("id", cal.id);
  return result;
}

/** Guarda la copia de la Agenda (00510): upsert de lo que sigue, borrado de lo cancelado o fuera de la ventana. */
async function applyMirror(
  service: Db,
  cal: CalendarForSync,
  changes: ListEventsResult,
  byEvent: Map<string, { id: string; uid: string | null; status_group: string }>,
  now: Date,
  result: InboundResult,
): Promise<void> {
  const calendar = { id: cal.id, workspace_id: cal.workspace_id, user_id: cal.user_id, connection_id: cal.connection_id };
  const upserts: Array<ReturnType<typeof withBooking>> = [];
  const deletes: string[] = [];
  const uidsToFind = new Set<string>();
  const decisions = changes.items.map((ev) => ({ ev, d: toMirrorRow(ev, calendar, now) }));
  for (const { d } of decisions) if (d.kind === "upsert" && d.bookingUid && !byEvent.has(d.row.external_event_id)) uidsToFind.add(d.bookingUid);

  // Una reunión de la plataforma creada en este calendario se reconoce por su id de evento o por su uid.
  const byUid = new Map<string, string>();
  if (uidsToFind.size > 0) {
    const { data } = await service
      .from("bookings")
      .select("id, uid")
      .eq("workspace_id", cal.workspace_id)
      .in("uid", [...uidsToFind]);
    for (const b of data ?? []) if (b.uid) byUid.set(b.uid, b.id);
  }

  for (const { ev, d } of decisions) {
    if (d.kind === "delete") {
      deletes.push(ev.id);
      continue;
    }
    const linked = byEvent.get(ev.id);
    const bookingId = linked && linked.status_group !== "cancelled" ? linked.id : (d.bookingUid ? byUid.get(d.bookingUid) ?? null : null);
    upserts.push(withBooking(d.row, bookingId));
  }

  for (let i = 0; i < upserts.length; i += UPSERT_CHUNK) {
    const chunk = upserts.slice(i, i + UPSERT_CHUNK);
    const { error } = await service.from("google_calendar_events").upsert(chunk as never, { onConflict: "calendar_id,external_event_id" });
    if (error) throw new Error(error.message);
    result.mirrored += chunk.length;
  }
  for (let i = 0; i < deletes.length; i += UPSERT_CHUNK) {
    const chunk = deletes.slice(i, i + UPSERT_CHUNK);
    const { error } = await service.from("google_calendar_events").delete().eq("calendar_id", cal.id).in("external_event_id", chunk);
    if (error) throw new Error(error.message);
    result.removed += chunk.length;
  }

  // Una lectura completa y terminada trae todo lo que hay desde la fecha de inicio: lo que la copia tenga de ese
  // rango y Google ya no devolvió, ya no existe.
  if (changes.fullSync && changes.nextSyncToken) {
    const seen = new Set(changes.items.map((i) => i.id));
    const { data: existing } = await service
      .from("google_calendar_events")
      .select("external_event_id")
      .eq("calendar_id", cal.id)
      .gte("end_at", mirrorFullSyncFrom(now));
    const gone = (existing ?? []).map((r) => r.external_event_id).filter((id) => !seen.has(id));
    for (let i = 0; i < gone.length; i += UPSERT_CHUNK) {
      await service.from("google_calendar_events").delete().eq("calendar_id", cal.id).in("external_event_id", gone.slice(i, i + UPSERT_CHUNK));
      result.removed += Math.min(UPSERT_CHUNK, gone.length - i);
    }
  }

  // Lo que quedó fuera de la ventana (más de 60 días atrás).
  await service.from("google_calendar_events").delete().eq("calendar_id", cal.id).lt("end_at", mirrorWindow(now).from.toISOString());
}

function withBooking(row: MirrorRow, bookingId: string | null) {
  return { ...row, booking_id: bookingId };
}

async function handleGoogleCalendarInbound(ctx: JobContext): Promise<void> {
  const calendarId = (ctx.job.payload as { calendar_id?: unknown } | null)?.calendar_id;
  if (typeof calendarId !== "string") return;
  const r = await syncCalendarInbound({ supabase: ctx.supabase }, calendarId);
  if (r.moved + r.cancelled + r.failed > 0) {
    console.info(`[agenda] cambios de Google: ${r.moved} movidas, ${r.cancelled} canceladas, ${r.failed} rechazadas`);
  }
}

export function registerGoogleCalendarInboundHandler(): void {
  registerJobHandler(GOOGLE_CALENDAR_INBOUND_JOB, handleGoogleCalendarInbound);
}
