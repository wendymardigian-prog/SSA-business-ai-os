/**
 * Cancelar una agenda (F28 por el invitado, F36 por el anfitrion).
 *
 * Es la MISMA funcion para los dos: cambia quien la llama y el estado con el
 * que queda. Cancelar es final: no hay vuelta a activa.
 *
 * Lo que pasa en orden: se valida que todavia se pueda, se guarda el estado,
 * queda en el historial, sale el evento de automatizacion, se anulan los jobs
 * que ya no corresponden, se manda el borrado a Google y se avisa.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database, Json } from "@/lib/types/database";
import { logAudit } from "@/lib/audit";
import { inviteeActions, LATE_ACTION_MESSAGE } from "@/lib/scheduling/booking-page";
import { notifyBooking } from "@/lib/scheduling/notifications";
import { BOOKING_ENDED_JOB, BOOKING_GOOGLE_SYNC_JOB } from "@/lib/jobs/handlers/booking-sync";

type Db = SupabaseClient<Database>;

export type CancelStatus = "cancelled_other" | "cancelled_no_response" | "cancelled_not_qualified";

export interface CancelInput {
  /** El codigo publico (invitado) o el id (equipo y agente). */
  uid?: string;
  bookingId?: string;
  by: "invitee" | "host" | "system";
  status?: CancelStatus;
  reason?: string | null;
  actorUserId?: string | null;
  /** 00430: quien atiende la canceló en su Google Calendar. No se vuelve a borrar ahí (ya no está). */
  fromGoogle?: boolean;
  now?: Date;
}

export type CancelResult =
  | { ok: true; bookingId: string; uid: string }
  | { ok: false; status: number; reason: "not_found" | "too_late"; message?: string };

export async function cancelBooking(service: Db, input: CancelInput): Promise<CancelResult> {
  const now = input.now ?? new Date();

  let query = service.from("bookings").select("*");
  query = input.uid ? query.eq("uid", input.uid) : query.eq("id", input.bookingId ?? "");
  const { data: booking } = await query.maybeSingle();
  if (!booking) return { ok: false, status: 404, reason: "not_found" };

  // El invitado no puede cancelar una reunion que empezo ni una cancelada. El
  // equipo tampoco puede cancelar dos veces, pero si una que ya empezo.
  const actions = inviteeActions(booking, now);
  const allowed = input.by === "invitee" ? actions.canCancel : actions.state !== "cancelled";
  if (!allowed) {
    return { ok: false, status: 409, reason: "too_late", message: input.by === "invitee" ? LATE_ACTION_MESSAGE.cancel : "Esta reunión ya estaba cancelada." };
  }

  // 00524: una reunión de una serie que fijó quien atiende se mueve o se marca «No se presentó», no se cancela desde
  // la plataforma. Sí si la borraron en Google (`fromGoogle`) o la cancela el sistema (la serie terminó).
  if (!input.fromGoogle && input.by !== "system" && (await isActiveSeriesBooking(service, booking.metadata))) {
    return { ok: false, status: 409, reason: "too_late", message: SERIES_NO_CANCEL_MESSAGE };
  }

  const status: CancelStatus = input.status ?? "cancelled_other";
  const { error } = await service
    .from("bookings")
    .update({
      status,
      status_changed_at: now.toISOString(),
      status_changed_by: input.actorUserId ?? null,
      cancelled_at: now.toISOString(),
      cancelled_by_type: input.by,
      cancelled_by_user_id: input.by === "host" ? input.actorUserId ?? null : null,
      cancellation_reason: input.reason?.trim() || null,
    })
    .eq("id", booking.id)
    // Solo si sigue activa: dos cancelaciones a la vez no se pisan.
    .eq("status_group", "active");
  if (error) {
    console.error("[agenda] no pude cancelar:", error.message);
    return { ok: false, status: 500, reason: "not_found" };
  }

  await logAudit({
    supabase: service,
    workspaceId: booking.workspace_id,
    entityType: "booking",
    entityId: booking.id,
    action: "booking.cancelled",
    metadata: { by: input.by, status, reason: input.reason ?? null, ...(input.fromGoogle ? { source: "google" } : {}) },
    performedBy: input.by === "host" ? input.actorUserId ?? null : null,
  });

  await service.from("automation_events").insert({
    workspace_id: booking.workspace_id,
    event_type: "booking_cancelled",
    contact_id: booking.contact_id,
    payload: {
      booking_id: booking.id,
      event_type_id: booking.event_type_id,
      host_user_id: booking.host_user_id,
      by_whom: input.by,
      status,
      reason: input.reason ?? null,
    } as unknown as Json,
  });

  await cancelPendingJobs(service, booking.id);
  if (!input.fromGoogle) {
    await service.from("scheduled_jobs").insert({
      type: BOOKING_GOOGLE_SYNC_JOB,
      payload: { booking_id: booking.id, action: "delete", attempt: 0 } as unknown as Json,
      run_at: now.toISOString(),
      status: "pending",
    });
  }

  // Si canceló el invitado, el anfitrión se entera por el aviso.
  await notifyBooking(service, booking.id, "booking_cancelled", {
    actorUserId: input.by === "host" ? input.actorUserId : null,
  });

  return { ok: true, bookingId: booking.id, uid: booking.uid };
}

/**
 * Anula los jobs pendientes de una agenda: el fin de reunion y los avisos
 * relativos. `cancelled` existe justo para esto (migracion 00099).
 */
export async function cancelPendingJobs(service: Db, bookingId: string, types?: string[]): Promise<void> {
  let query = service
    .from("scheduled_jobs")
    .update({ status: "cancelled" })
    .eq("payload->>booking_id", bookingId)
    .eq("status", "pending");
  if (types && types.length > 0) query = query.in("type", types);
  else query = query.in("type", [BOOKING_ENDED_JOB, "booking_relative_trigger"]);
  const { error } = await query;
  if (error) console.error("[agenda] no pude anular los jobs de la agenda:", error.message);
}

export const SERIES_NO_CANCEL_MESSAGE =
  "Esta reunión es parte de una serie: movela a otro día o, si no se hizo, marcala «No se presentó». Para terminar la serie, andá a la ficha del servicio.";

/** Si la reunión es de una serie de reuniones (00524) que sigue activa. Ante la duda (no se pudo leer), no frena. */
async function isActiveSeriesBooking(service: Db, metadata: unknown): Promise<boolean> {
  const seriesId = (metadata as { series_id?: unknown } | null)?.series_id;
  if (typeof seriesId !== "string") return false;
  let active = false;
  // @plantilla-desde(servicios)
  try {
    const { data } = await service.schema("app_servicio" as never).from("meeting_series").select("status").eq("id", seriesId).maybeSingle();
    active = (data as { status?: string } | null)?.status === "active";
  } catch {
    active = false;
  }
  // @plantilla-hasta(servicios)
  return active;
}
