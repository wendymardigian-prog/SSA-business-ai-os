/**
 * El job `google_calendar_inbound` (00430): lee los cambios del Google Calendar de quien atiende y, si movió o
 * canceló ahí una reunión creada en la plataforma, lo refleja acá. Lo encola
 * `private.enqueue_google_calendar_inbound()` (00430, parte del cron de cada 5 minutos) por calendario.
 *
 * - Lee con el `calendars.sync_token` (00095); sin token o con 410, lectura completa desde ayer.
 * - Solo mira los eventos que son de una reunión de ESTE calendario (`bookings.google_event_id` +
 *   `google_calendar_id`): cada evento tiene un solo dueño y los eventos propios de Google no se importan
 *   (cuentan como ocupado por freeBusy).
 * - Mueve o cancela con `rescheduleBooking` / `cancelBooking` con `fromGoogle`, que no vuelven a escribir en Google.
 * - Sin eco: si la plataforma tiene un `booking_google_sync` pendiente (mover, reasignar, cancelar), gana la plataforma.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database, Json } from "@/lib/types/database";
import { registerJobHandler, type JobContext } from "@/lib/jobs/registry";
import { listEvents } from "@/lib/google-calendar/client";
import type { GoogleDeps } from "@/lib/google-calendar/auth";
import { GoogleCalendarError } from "@/lib/google-calendar/errors";
import { decideInbound, fullSyncFrom } from "@/lib/google-calendar/inbound";
import { rescheduleBooking } from "@/lib/scheduling/booking/reschedule";
import { cancelBooking } from "@/lib/scheduling/booking/cancel";
import { logAudit } from "@/lib/audit";
import { BOOKING_GOOGLE_SYNC_JOB } from "./booking-sync";

type Db = SupabaseClient<Database>;

export const GOOGLE_CALENDAR_INBOUND_JOB = "google_calendar_inbound";

export interface InboundResult {
  moved: number;
  cancelled: number;
  ignored: number;
  failed: number;
  fullSync: boolean;
  /** null = no se pudo leer (conexion rota o Google caido): el token no se toca. */
  error: string | null;
}

export async function syncCalendarInbound(deps: GoogleDeps, calendarRowId: string): Promise<InboundResult> {
  const service = deps.supabase;
  const now = deps.now?.() ?? new Date();
  const result: InboundResult = { moved: 0, cancelled: 0, ignored: 0, failed: 0, fullSync: false, error: null };

  const { data: cal } = await service
    .from("calendars")
    .select("id, workspace_id, user_id, connection_id, external_calendar_id, sync_token, is_active")
    .eq("id", calendarRowId)
    .maybeSingle();
  if (!cal || !cal.is_active) return { ...result, error: "calendar_missing" };

  let changes;
  try {
    changes = await listEvents(deps, cal.connection_id, cal.external_calendar_id, {
      syncToken: cal.sync_token,
      fullSyncFrom: fullSyncFrom(now),
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
      .select("id, workspace_id, host_user_id, google_event_id, start_at, end_at, status_group")
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
      // Evento propio de Google (o de otro calendario): no se importa.
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
      if (r.ok) result.cancelled++;
      else result.failed++;
    }
  }

  if (changes.nextSyncToken) {
    await service.from("calendars").update({ sync_token: changes.nextSyncToken }).eq("id", cal.id);
  }
  return result;
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
