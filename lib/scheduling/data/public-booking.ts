/**
 * La agenda que ve el invitado con su codigo publico (F27, F28).
 *
 * Se lee con service role porque no hay sesion: el codigo de 22 caracteres ES
 * la credencial. Lo que se devuelve esta filtrado a mano: nada de ids
 * internos, notas del equipo, atribucion ni estado de sincronizacion.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/types/database";
import type { BookingStatus } from "@/lib/scheduling/types";
import { inviteeActions, type InviteeActions } from "@/lib/scheduling/booking-page";

type Db = SupabaseClient<Database>;

export interface PublicBooking {
  uid: string;
  title: string;
  startUtc: string;
  endUtc: string;
  status: BookingStatus;
  durationMinutes: number;
  inviteeTimezone: string;
  hostTimezone: string;
  hostName: string;
  hostAvatarUrl: string | null;
  username: string | null;
  eventSlug: string;
  locationType: "google_meet" | "manual";
  locationText: string | null;
  meetUrl: string | null;
  bookerName: string | null;
  bookerEmail: string | null;
  cancelledByType: "invitee" | "host" | "system" | null;
  cancellationReason: string | null;
  timeFormat: "12h" | "24h";
  actions: InviteeActions;
  /** Para el .ics y el historial; no se muestra. */
  icalUid: string | null;
}

export interface PublicBookingContext {
  booking: Database["public"]["Tables"]["bookings"]["Row"];
  event: Database["public"]["Tables"]["event_types"]["Row"];
  profile: Database["public"]["Tables"]["scheduling_profiles"]["Row"] | null;
  workspace: { id: string; scheduling_public_base_url: string | null };
}

export async function findBookingByUid(service: Db, uid: string): Promise<PublicBookingContext | null> {
  if (!uid || uid.length > 40) return null;
  const { data: booking } = await service.from("bookings").select("*").eq("uid", uid).maybeSingle();
  if (!booking) return null;

  const [{ data: event }, { data: profile }, { data: workspace }] = await Promise.all([
    service.from("event_types").select("*").eq("id", booking.event_type_id).maybeSingle(),
    service.from("scheduling_profiles").select("*").eq("workspace_id", booking.workspace_id).eq("user_id", booking.host_user_id).maybeSingle(),
    service.from("workspaces").select("id, scheduling_public_base_url").eq("id", booking.workspace_id).maybeSingle(),
  ]);
  if (!event) return null;
  return {
    booking,
    event,
    profile: profile ?? null,
    workspace: { id: booking.workspace_id, scheduling_public_base_url: workspace?.scheduling_public_base_url ?? null },
  };
}

export function toPublicBooking(ctx: PublicBookingContext, now: Date = new Date()): PublicBooking {
  const { booking, event, profile } = ctx;
  const duration = Math.round((new Date(booking.end_at).getTime() - new Date(booking.start_at).getTime()) / 60_000);
  return {
    uid: booking.uid,
    title: booking.title,
    startUtc: booking.start_at,
    endUtc: booking.end_at,
    status: booking.status,
    durationMinutes: duration,
    inviteeTimezone: booking.booker_timezone ?? "UTC",
    hostTimezone: booking.host_timezone ?? profile?.timezone ?? "UTC",
    hostName: profile?.display_name ?? "El equipo",
    hostAvatarUrl: profile?.avatar_url ?? null,
    username: profile?.username ?? null,
    eventSlug: event.slug,
    locationType: booking.location_type ?? event.location_type,
    locationText: booking.location_text ?? null,
    meetUrl: booking.meet_url,
    bookerName: booking.booker_name,
    bookerEmail: booking.booker_email,
    cancelledByType: booking.cancelled_by_type,
    cancellationReason: booking.cancellation_reason,
    timeFormat: profile?.time_format ?? "24h",
    actions: inviteeActions(booking, now),
    icalUid: booking.ical_uid,
  };
}
