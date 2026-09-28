/**
 * Lectura de agendas para la pantalla (F33 a F36). Solo servidor.
 *
 * El alcance lo aplica RLS (`can_see_booking`): un Member ve solo aquellas en
 * las que es anfitrión. Acá no se repite la regla, se la aprovecha.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/types/database";
import type { BookingStatus } from "@/lib/scheduling/types";
import { getWorkspaceMembers, memberLabels } from "@/lib/workspace-members";

type Db = SupabaseClient<Database>;

export type BookingRow = Database["public"]["Tables"]["bookings"]["Row"];

/** Una fila de la lista, con lo que hace falta mostrar y nada más. */
export interface BookingListItem {
  id: string;
  uid: string;
  title: string;
  startAt: string;
  endAt: string;
  status: BookingStatus;
  hostUserId: string;
  hostName: string | null;
  contactId: string;
  contactName: string | null;
  bookerName: string | null;
  bookerEmail: string | null;
  bookerPhone: string | null;
  eventTypeId: string;
  eventColor: string | null;
  categorySnapshot: BookingRow["category_snapshot"];
  origin: string;
  locationType: string | null;
  locationText: string | null;
  meetUrl: string | null;
  timezone: string | null;
  syncStatus: string;
}

/** Cuántas agendas trae una página (F33). */
export const PAGE_SIZE = 50;

export interface BookingQuery {
  /** Rango por fecha de inicio. El calendario lo usa; la lista no. */
  from?: string | null;
  to?: string | null;
  statuses?: BookingStatus[] | null;
  statusGroups?: Database["public"]["Tables"]["bookings"]["Row"]["status_group"][] | null;
  hostUserId?: string | null;
  eventTypeId?: string | null;
  /** Ids de área y tipo, ya expandidos. Se compara contra el snapshot. */
  categoryIds?: string[] | null;
  search?: string | null;
  contactId?: string | null;
  page?: number;
  /** Próximas: ascendente. El resto: lo más reciente primero. */
  ascending?: boolean;
  limit?: number;
}

const SELECT =
  "id, uid, title, start_at, end_at, status, status_group, host_user_id, contact_id, booker_name, booker_email, booker_phone, event_type_id, category_snapshot, origin, location_type, location_text, meet_url, booker_timezone, google_sync_status, event_types!inner(color), contacts!inner(display_name)";

export async function listBookings(
  supabase: Db,
  workspaceId: string,
  query: BookingQuery = {},
): Promise<{ items: BookingListItem[]; total: number }> {
  const page = Math.max(1, query.page ?? 1);
  const size = query.limit ?? PAGE_SIZE;

  let q = supabase.from("bookings").select(SELECT, { count: "exact" }).eq("workspace_id", workspaceId);

  if (query.from) q = q.gte("start_at", query.from);
  if (query.to) q = q.lt("start_at", query.to);
  if (query.statuses?.length) q = q.in("status", query.statuses);
  if (query.statusGroups?.length) q = q.in("status_group", query.statusGroups);
  if (query.hostUserId) q = q.eq("host_user_id", query.hostUserId);
  if (query.eventTypeId) q = q.eq("event_type_id", query.eventTypeId);
  if (query.contactId) q = q.eq("contact_id", query.contactId);
  if (query.search?.trim()) {
    const needle = `%${query.search.trim().replace(/[%_]/g, "")}%`;
    q = q.or(`booker_name.ilike.${needle},booker_email.ilike.${needle},booker_phone.ilike.${needle}`);
  }

  q = q.order("start_at", { ascending: query.ascending ?? false }).range((page - 1) * size, page * size - 1);

  const { data, error, count } = await q;
  if (error) {
    console.error("[agenda] no pude leer las agendas:", error.message);
    return { items: [], total: 0 };
  }

  let rows = (data ?? []) as unknown as Array<BookingRow & { event_types: { color: string | null } | null; contacts: { display_name: string | null } | null }>;

  // El filtro por categoría va en memoria: está dentro del snapshot jsonb y
  // PostgREST no sabe preguntar "alguno de estos ids está en estas dos claves".
  if (query.categoryIds?.length) {
    const wanted = new Set(query.categoryIds);
    rows = rows.filter((r) => {
      const snap = r.category_snapshot as { area_id?: string | null; type_id?: string | null } | null;
      return Boolean((snap?.area_id && wanted.has(snap.area_id)) || (snap?.type_id && wanted.has(snap.type_id)));
    });
  }

  return {
    items: rows.map((r) => ({
      id: r.id,
      uid: r.uid,
      title: r.title,
      startAt: r.start_at,
      endAt: r.end_at,
      status: r.status,
      hostUserId: r.host_user_id,
      hostName: null,
      contactId: r.contact_id,
      contactName: r.contacts?.display_name ?? null,
      bookerName: r.booker_name,
      bookerEmail: r.booker_email,
      bookerPhone: r.booker_phone,
      eventTypeId: r.event_type_id,
      eventColor: r.event_types?.color ?? null,
      categorySnapshot: r.category_snapshot,
      origin: r.origin,
      locationType: r.location_type,
      locationText: r.location_text,
      meetUrl: r.meet_url,
      timezone: r.booker_timezone,
      syncStatus: r.google_sync_status,
    })),
    total: count ?? rows.length,
  };
}

/**
 * Los nombres de los anfitriones, para la lista y el filtro.
 *
 * Los nombres viven en `auth.users`, que no se lee por RLS: el camino ya
 * resuelto es `getWorkspaceMembers`, que usa el service role y está envuelto
 * en `cache()`, así una pantalla que lo pide tres veces lo resuelve una.
 */
export async function hostNames(workspaceId: string): Promise<Map<string, string>> {
  return memberLabels(await getWorkspaceMembers(workspaceId));
}

/** El detalle de una agenda, con su historial (F36). */
export async function getBookingDetail(supabase: Db, id: string) {
  const { data: booking } = await supabase.from("bookings").select("*").eq("id", id).maybeSingle();
  if (!booking) return null;

  const [{ data: history }, { data: event }, { data: contact }] = await Promise.all([
    supabase
      .from("audit_log")
      .select("id, action, metadata, changes, performed_at, performed_by, performed_by_agent_id")
      .eq("entity_type", "booking")
      .eq("entity_id", id)
      .order("performed_at", { ascending: false })
      .limit(50),
    supabase.from("event_types").select("id, title, slug, color, duration_minutes").eq("id", booking.event_type_id).maybeSingle(),
    supabase.from("contacts").select("id, display_name, email, phone").eq("id", booking.contact_id).maybeSingle(),
  ]);

  return { booking, history: history ?? [], event, contact };
}
