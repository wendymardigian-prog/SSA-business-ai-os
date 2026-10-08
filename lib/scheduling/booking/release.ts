/**
 * Liberar y volver a ocupar el espacio de una agenda (Agenda v2).
 *
 * La agenda sigue existiendo, activa, con su lead y su link de Meet. Lo
 * único que cambia es que su horario deja de contar como ocupado (ni para la
 * exclusión de la base, ni para los topes por día/semana, ni en Google), así
 * el equipo puede agendar otro lead en el mismo lugar mientras este no se
 * confirma. Volver a ocupar lo revierte; si alguien ya agendó encima, la
 * base lo rechaza con la misma exclusión de siempre.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database, Json } from "@/lib/types/database";
import { logAudit } from "@/lib/audit";
import { isActive } from "@/lib/scheduling/booking-status";
import { BOOKING_GOOGLE_SYNC_JOB } from "@/lib/jobs/handlers/booking-sync";

type Db = SupabaseClient<Database>;
type BookingRow = Database["public"]["Tables"]["bookings"]["Row"];

export type ReleaseResult =
  | { ok: true; booking: BookingRow }
  | { ok: false; status: number; message: string };

async function visible(service: Db, bookingId: string): Promise<BookingRow | null> {
  const { data } = await service.from("bookings").select("*").eq("id", bookingId).maybeSingle();
  return data;
}

/** Libera el espacio: la agenda sigue activa, su horario queda libre. */
export async function releaseBookingSlot(service: Db, bookingId: string, actorUserId: string): Promise<ReleaseResult> {
  const booking = await visible(service, bookingId);
  if (!booking) return { ok: false, status: 404, message: "No encontré esa agenda." };
  if (!isActive(booking.status)) return { ok: false, status: 400, message: "Solo se libera una agenda activa." };
  if (booking.slot_released_at) return { ok: true, booking };

  const { data: updated, error } = await service
    .from("bookings")
    .update({ slot_released_at: new Date().toISOString(), slot_released_by: actorUserId })
    .eq("id", bookingId)
    .is("slot_released_at", null)
    .select("*")
    .maybeSingle();
  if (error) return { ok: false, status: 500, message: `No pude liberar el espacio: ${error.message}` };
  if (!updated) return { ok: false, status: 409, message: "Ya estaba liberada." };

  await logAudit({
    supabase: service,
    workspaceId: booking.workspace_id,
    entityType: "booking",
    entityId: booking.id,
    action: "booking.slot_released",
    performedBy: actorUserId,
  });

  if (updated.google_event_id) {
    await service.from("scheduled_jobs").insert({
      type: BOOKING_GOOGLE_SYNC_JOB,
      payload: { booking_id: booking.id, action: "release", attempt: 0 } as unknown as Json,
      run_at: new Date().toISOString(),
      status: "pending",
    });
  }

  return { ok: true, booking: updated };
}

/**
 * Vuelve a ocupar el espacio. Si alguien ya agendó encima mientras estaba
 * liberada, la exclusión de la base (`bookings_no_overlap`) lo rechaza con
 * 23P01: desde acá no se puede saber de antemano, hay que intentarlo.
 */
export async function occupyBookingSlot(service: Db, bookingId: string, actorUserId: string): Promise<ReleaseResult> {
  const booking = await visible(service, bookingId);
  if (!booking) return { ok: false, status: 404, message: "No encontré esa agenda." };
  if (!booking.slot_released_at) return { ok: true, booking };

  const { data: updated, error } = await service
    .from("bookings")
    .update({ slot_released_at: null, slot_released_by: null })
    .eq("id", bookingId)
    .not("slot_released_at", "is", null)
    .select("*")
    .maybeSingle();
  if (error) {
    if (error.code === "23P01") return { ok: false, status: 409, message: "Ese horario ya lo tomó otra agenda." };
    return { ok: false, status: 500, message: `No pude volver a ocupar el espacio: ${error.message}` };
  }
  if (!updated) return { ok: true, booking };

  await logAudit({
    supabase: service,
    workspaceId: booking.workspace_id,
    entityType: "booking",
    entityId: booking.id,
    action: "booking.slot_occupied",
    performedBy: actorUserId,
  });

  if (updated.google_event_id) {
    await service.from("scheduled_jobs").insert({
      type: BOOKING_GOOGLE_SYNC_JOB,
      payload: { booking_id: booking.id, action: "occupy", attempt: 0 } as unknown as Json,
      run_at: new Date().toISOString(),
      status: "pending",
    });
  }

  return { ok: true, booking: updated };
}
