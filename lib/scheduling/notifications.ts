/**
 * Avisos de agenda al anfitrion (F38).
 *
 * Nunca se avisa a quien hizo la accion: si el anfitrion cancela, no se
 * notifica a si mismo.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/types/database";
import { createNotification } from "@/lib/notifications/create";
import { formatDateTimeWithZone } from "@/lib/scheduling/booker/format";
import { isValidTimeZone } from "@/lib/timezone";

type Db = SupabaseClient<Database>;

export type BookingNotification = "booking_created" | "booking_rescheduled" | "booking_cancelled" | "booking_sync_failed";

const TITLES: Record<BookingNotification, string> = {
  booking_created: "Te agendaron una reunión",
  booking_rescheduled: "Cambiaron la fecha de una reunión",
  booking_cancelled: "Cancelaron una reunión",
  booking_sync_failed: "No pude sincronizar una agenda con Google",
};

export async function notifyBooking(
  service: Db,
  bookingId: string,
  type: BookingNotification,
  options: { actorUserId?: string | null; detail?: string } = {},
): Promise<void> {
  const { data: booking } = await service
    .from("bookings")
    .select("id, workspace_id, host_user_id, title, start_at, host_timezone, booker_name")
    .eq("id", bookingId)
    .maybeSingle();
  if (!booking) return;
  // El anfitrión no se avisa a sí mismo.
  if (options.actorUserId && options.actorUserId === booking.host_user_id) return;

  // La fecha va en la zona de la persona que recibe el aviso (Mi cuenta), no en la de su perfil de agenda.
  const { data: prefs } = await service.from("user_preferences").select("timezone").eq("user_id", booking.host_user_id).maybeSingle();
  const saved = prefs?.timezone && isValidTimeZone(prefs.timezone) ? prefs.timezone : null;
  const when = formatDateTimeWithZone(booking.start_at, saved ?? booking.host_timezone ?? "UTC");
  const who = booking.booker_name ?? "Alguien";

  await createNotification({
    supabase: service,
    workspaceId: booking.workspace_id,
    type,
    title: TITLES[type],
    body:
      options.detail ??
      (type === "booking_sync_failed"
        ? `${booking.title} · ${when}. El evento no quedó en tu Google Calendar: probá "Reintentar sincronización".`
        : `${who} · ${booking.title} · ${when}`),
    entityType: "booking",
    entityId: booking.id,
    recipientId: booking.host_user_id,
    metadata: { booking_id: booking.id },
  });
}
