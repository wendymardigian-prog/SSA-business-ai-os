/**
 * Reasignar el anfitrión de una agenda (Agenda v2), sin avisarle al invitado.
 *
 * Por qué así: Google no deja pasar un evento de una cuenta a otra sin
 * permisos de edición entre calendarios (que normalmente no hay), y
 * borrar+crear le manda mails al invitado. Lo que sí se puede, con la propia
 * conexión del organizador (que sigue siendo quien creó el evento, para
 * siempre): sumar al nuevo anfitrión como invitado confirmado
 * (`responseStatus: "accepted"`), que es justo lo que hace que el evento le
 * aparezca "Ocupado" en su calendario sin que tenga que aceptar nada. El
 * organizador original pasa a "Disponible" en su propia copia
 * (`transparency: "transparent"`): deja de contar como su horario.
 *
 * Límite a propósito: si se reasigna otra vez, o se vuelve al organizador
 * original, se reconstruye la lista de invitados desde cero (el booker más
 * el anfitrión actual) — no se lee el estado de Google antes de escribir,
 * igual que ya hace el resto de este job.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database, Json } from "@/lib/types/database";
import { logAudit } from "@/lib/audit";
import { isActive } from "@/lib/scheduling/booking-status";
import { syncRelativeJobs } from "@/lib/scheduling/automation/relative";
import { BOOKING_GOOGLE_SYNC_JOB } from "@/lib/jobs/handlers/booking-sync";

type Db = SupabaseClient<Database>;
type BookingRow = Database["public"]["Tables"]["bookings"]["Row"];

export interface ReassignInput {
  bookingId: string;
  newHostUserId: string;
  /** Para sumarlo como invitado en Google; sin esto el aviso a Google se saltea. */
  newHostEmail: string | null;
  newHostName: string | null;
  actorUserId: string;
  /** El closer/setter del contacto pasa al nuevo SOLO si era el anfitrión original. Default true. */
  transferAssignment?: boolean;
  now?: Date;
}

export type ReassignResult =
  | { ok: true; booking: BookingRow }
  | { ok: false; status: number; message: string };

export async function reassignBookingHost(service: Db, input: ReassignInput): Promise<ReassignResult> {
  const now = input.now ?? new Date();

  const { data: booking } = await service.from("bookings").select("*").eq("id", input.bookingId).maybeSingle();
  if (!booking) return { ok: false, status: 404, message: "No encontré esa agenda." };
  if (!isActive(booking.status)) return { ok: false, status: 400, message: "Solo se reasigna una agenda activa." };
  if (booking.host_user_id === input.newHostUserId) return { ok: false, status: 400, message: "Esa persona ya es el anfitrión." };

  const { data: newProfile } = await service
    .from("scheduling_profiles")
    .select("timezone")
    .eq("workspace_id", booking.workspace_id)
    .eq("user_id", input.newHostUserId)
    .maybeSingle();
  if (!newProfile) return { ok: false, status: 400, message: "Esa persona todavía no configuró su agenda: no se le puede reasignar." };

  // El mismo choque que impediría la base (bookings_no_overlap), mostrado
  // antes de intentar, con un mensaje claro en vez de un código de error.
  const { data: clash } = await service
    .from("bookings")
    .select("id")
    .eq("host_user_id", input.newHostUserId)
    .eq("status_group", "active")
    .is("slot_released_at", null)
    .lt("start_at", booking.end_at)
    .gt("end_at", booking.start_at)
    .limit(1);
  if (clash && clash.length > 0) return { ok: false, status: 409, message: "Esa persona ya tiene una agenda activa en ese horario." };

  const oldHostUserId = booking.host_user_id;
  const { data: updated, error } = await service
    .from("bookings")
    .update({ host_user_id: input.newHostUserId, host_timezone: newProfile.timezone })
    .eq("id", booking.id)
    .eq("status_group", "active")
    .select("*")
    .maybeSingle();
  if (error) {
    // 23P01: la nueva persona ganó una carrera (se le creó otra agenda justo ahora).
    if (error.code === "23P01") return { ok: false, status: 409, message: "Esa persona ya tiene una agenda activa en ese horario." };
    return { ok: false, status: 500, message: `No pude reasignar: ${error.message}` };
  }
  if (!updated) return { ok: false, status: 404, message: "No encontré esa agenda." };

  if (input.transferAssignment ?? true) {
    await service.from("contacts").update({ vendedor_id: input.newHostUserId }).eq("id", booking.contact_id).eq("vendedor_id", oldHostUserId);
    await service.from("contacts").update({ setter_id: input.newHostUserId }).eq("id", booking.contact_id).eq("setter_id", oldHostUserId);
  }

  await logAudit({
    supabase: service,
    workspaceId: booking.workspace_id,
    entityType: "booking",
    entityId: booking.id,
    action: "booking.host_changed",
    changes: { host_user_id: { old: oldHostUserId, new: input.newHostUserId } },
    performedBy: input.actorUserId,
  });

  // Los avisos relativos filtran por anfitrión (F44): hay que volver a armarlos.
  try {
    await syncRelativeJobs(
      service,
      {
        id: updated.id,
        workspace_id: updated.workspace_id,
        event_type_id: updated.event_type_id,
        host_user_id: updated.host_user_id,
        origin: updated.origin,
        status: updated.status,
        category_snapshot: updated.category_snapshot as { area_id?: string | null; type_id?: string | null } | null,
        start_at: updated.start_at,
        end_at: updated.end_at,
        created_at: updated.created_at,
        reschedule_count: updated.reschedule_count,
      },
      now,
    );
  } catch (err) {
    console.error("[agenda] no pude reagendar los avisos tras reasignar:", err instanceof Error ? err.message : err);
  }

  if (updated.google_event_id) {
    await service.from("scheduled_jobs").insert({
      type: BOOKING_GOOGLE_SYNC_JOB,
      payload: {
        booking_id: booking.id,
        action: "reassign",
        new_host_email: input.newHostEmail,
        new_host_name: input.newHostName,
        attempt: 0,
      } as unknown as Json,
      run_at: now.toISOString(),
      status: "pending",
    });
  }

  return { ok: true, booking: updated };
}
