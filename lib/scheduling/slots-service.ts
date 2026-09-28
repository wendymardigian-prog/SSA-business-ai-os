/**
 * El servicio de horarios (F24): la MISMA funcion que usan la pagina publica,
 * el agendar manual y el agente. Ası el link y el agente ofrecen exactamente
 * lo mismo.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/types/database";
import type { SlotsByDate } from "@/lib/scheduling/types";
import { getAvailableSlots } from "@/lib/scheduling/slots";
import { buildSlotsInput, findPublicEvent } from "@/lib/scheduling/data/slots-input";

type Db = SupabaseClient<Database>;

/** Rango maximo por consulta (F24). */
export const MAX_RANGE_DAYS = 45;

export type SlotsServiceResult =
  | { ok: true; slots: SlotsByDate; eventTitle: string; durationMinutes: number }
  | { ok: false; status: number; reason: "not_found" | "range_too_wide" | "temporarily_unavailable" };

export interface SlotsQuery {
  username?: string;
  slug?: string;
  eventTypeId?: string;
  from: string;
  to: string;
  timezone: string;
  now?: Date;
  ignoreMinimumNotice?: boolean;
  excludeBookingId?: string;
  freshGoogle?: boolean;
}

export function rangeTooWide(from: string, to: string): boolean {
  const days = (new Date(to).getTime() - new Date(from).getTime()) / (24 * 60 * 60 * 1000);
  return !(days > 0) || days > MAX_RANGE_DAYS;
}

export async function getPublicSlots(service: Db, query: SlotsQuery): Promise<SlotsServiceResult> {
  if (rangeTooWide(query.from, query.to)) return { ok: false, status: 400, reason: "range_too_wide" };

  let event: Database["public"]["Tables"]["event_types"]["Row"] | null = null;
  let profile: Database["public"]["Tables"]["scheduling_profiles"]["Row"] | null = null;

  if (query.eventTypeId) {
    const { data: row } = await service.from("event_types").select("*").eq("id", query.eventTypeId).is("deleted_at", null).maybeSingle();
    if (!row) return { ok: false, status: 404, reason: "not_found" };
    event = row;
    const { data: p } = await service.from("scheduling_profiles").select("*").eq("workspace_id", row.workspace_id).eq("user_id", row.owner_user_id).maybeSingle();
    if (!p) return { ok: false, status: 404, reason: "not_found" };
    profile = p;
  } else if (query.username && query.slug) {
    const found = await findPublicEvent(service, query.username, query.slug);
    if (!found) return { ok: false, status: 404, reason: "not_found" };
    event = found.event;
    profile = found.profile;
  } else {
    return { ok: false, status: 404, reason: "not_found" };
  }

  const built = await buildSlotsInput(service, event, profile, {
    from: query.from,
    to: query.to,
    inviteeTz: query.timezone,
    now: query.now,
    ignoreMinimumNotice: query.ignoreMinimumNotice,
    excludeBookingId: query.excludeBookingId,
    freshGoogle: query.freshGoogle,
  });
  if (!built.ok) {
    // Nunca se ofrecen horarios sin haber leido los calendarios de conflicto.
    return { ok: false, status: 200, reason: "temporarily_unavailable" };
  }

  return {
    ok: true,
    slots: getAvailableSlots(built.input),
    eventTitle: event.title,
    durationMinutes: event.duration_minutes,
  };
}

/** Lo que la pagina publica puede mostrar del evento: nada interno (§15). */
export interface PublicEventPayload {
  title: string;
  description: string | null;
  durationMinutes: number;
  locationType: "google_meet" | "manual";
  /** Solo si no esta oculta hasta agendar. */
  locationText: string | null;
  color: string | null;
  hostName: string;
  hostAvatarUrl: string | null;
  hostWelcome: string | null;
  timeFormat: "12h" | "24h";
  fields: unknown;
  unavailableMessages: unknown;
  hostTimezone: string;
}

export async function getPublicEvent(service: Db, username: string, slug: string): Promise<PublicEventPayload | null> {
  const found = await findPublicEvent(service, username, slug);
  if (!found) return null;
  const { event, profile } = found;
  return {
    title: event.title,
    description: event.description_md,
    durationMinutes: event.duration_minutes,
    locationType: event.location_type,
    locationText: event.hide_location_until_booked ? null : event.location_text,
    color: event.color,
    hostName: profile.display_name,
    hostAvatarUrl: profile.avatar_url,
    hostWelcome: profile.welcome_message,
    timeFormat: profile.time_format,
    fields: event.booking_fields,
    unavailableMessages: event.unavailable_messages,
    hostTimezone: profile.timezone,
  };
}
