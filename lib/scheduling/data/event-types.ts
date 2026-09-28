/**
 * Lectura de categorias y eventos (B3). Solo servidor.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/types/database";
import type { EventType } from "@/lib/scheduling/types";
import type { CategoryRow } from "@/lib/scheduling/categories";

type Db = SupabaseClient<Database>;

export type EventTypeRow = Database["public"]["Tables"]["event_types"]["Row"];
export type BookingCategoryRow = Database["public"]["Tables"]["booking_categories"]["Row"];

/** La fila adaptada a la forma que esperan las funciones puras del nucleo. */
export function toEventType(row: EventTypeRow): EventType {
  return {
    id: row.id,
    owner_user_id: row.owner_user_id,
    category_id: row.category_id,
    title: row.title,
    slug: row.slug,
    description_md: row.description_md,
    duration_minutes: row.duration_minutes,
    color: row.color,
    location_type: row.location_type,
    location_text: row.location_text,
    hide_location_until_booked: row.hide_location_until_booked,
    status: row.status,
    schedule_id: row.schedule_id,
    destination_calendar_id: row.destination_calendar_id,
    conflict_calendar_ids: row.conflict_calendar_ids ?? [],
    before_buffer_minutes: row.before_buffer_minutes,
    after_buffer_minutes: row.after_buffer_minutes,
    minimum_notice_minutes: row.minimum_notice_minutes,
    slot_interval_minutes: row.slot_interval_minutes,
    max_per_day: row.max_per_day,
    max_per_week: row.max_per_week,
    period_type: row.period_type,
    period_days: row.period_days,
    period_start_date: row.period_start_date,
    period_end_date: row.period_end_date,
    contact_assignment: row.contact_assignment,
    success_redirect_url: row.success_redirect_url,
    redirect_with_params: row.redirect_with_params,
    booking_fields: (row.booking_fields as unknown as EventType["booking_fields"]) ?? [],
    unavailable_messages: (row.unavailable_messages as unknown as EventType["unavailable_messages"]) ?? null,
  };
}

export function toCategoryRow(row: BookingCategoryRow): CategoryRow {
  return {
    id: row.id,
    parent_id: row.parent_id,
    name: row.name,
    color: row.color,
    position: row.position,
    is_system: row.is_system,
    archived_at: row.archived_at,
  };
}

export async function listCategories(supabase: Db, workspaceId: string): Promise<BookingCategoryRow[]> {
  const { data } = await supabase
    .from("booking_categories")
    .select("*")
    .eq("workspace_id", workspaceId)
    .order("position", { ascending: true })
    .order("name", { ascending: true });
  return (data ?? []) as BookingCategoryRow[];
}

export interface EventListFilters {
  ownerUserId?: string | null;
  categoryIds?: string[] | null;
}

export async function listEventTypes(supabase: Db, workspaceId: string, filters: EventListFilters = {}): Promise<EventTypeRow[]> {
  let query = supabase
    .from("event_types")
    .select("*")
    .eq("workspace_id", workspaceId)
    .is("deleted_at", null);
  if (filters.ownerUserId) query = query.eq("owner_user_id", filters.ownerUserId);
  if (filters.categoryIds && filters.categoryIds.length > 0) query = query.in("category_id", filters.categoryIds);
  const { data } = await query.order("title", { ascending: true });
  return (data ?? []) as EventTypeRow[];
}

export async function getEventType(supabase: Db, id: string): Promise<EventTypeRow | null> {
  const { data } = await supabase.from("event_types").select("*").eq("id", id).is("deleted_at", null).maybeSingle();
  return (data as EventTypeRow | null) ?? null;
}

/** Cuantas agendas futuras tiene un evento (para confirmar antes de borrar o cambiar el slug). Vacio hasta B4a. */
export async function futureBookingsCount(supabase: Db, eventTypeId: string): Promise<number> {
  const { count, error } = await supabase
    .from("bookings" as never)
    .select("id", { count: "exact", head: true })
    .eq("event_type_id", eventTypeId)
    .gte("start_at", new Date().toISOString())
    .in("status", ["scheduled", "confirmed", "rescheduled"]);
  if (error) return 0;
  return count ?? 0;
}

/** Cuantos eventos y agendas usa cada categoria (para la pantalla de Categorias). */
export async function categoryUsage(supabase: Db, workspaceId: string): Promise<Map<string, { events: number; bookings: number }>> {
  const usage = new Map<string, { events: number; bookings: number }>();
  const { data: events } = await supabase
    .from("event_types")
    .select("category_id")
    .eq("workspace_id", workspaceId)
    .is("deleted_at", null);
  for (const e of events ?? []) {
    const entry = usage.get(e.category_id) ?? { events: 0, bookings: 0 };
    entry.events++;
    usage.set(e.category_id, entry);
  }
  const { data: bookings, error } = await supabase
    .from("bookings" as never)
    .select("category_id")
    .eq("workspace_id", workspaceId);
  if (!error) {
    for (const b of (bookings ?? []) as unknown as Array<{ category_id: string | null }>) {
      if (!b.category_id) continue;
      const entry = usage.get(b.category_id) ?? { events: 0, bookings: 0 };
      entry.bookings++;
      usage.set(b.category_id, entry);
    }
  }
  return usage;
}
