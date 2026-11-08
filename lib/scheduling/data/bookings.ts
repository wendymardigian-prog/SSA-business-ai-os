/**
 * Lectura de agendas para la pantalla (F33 a F36). Solo servidor.
 *
 * El alcance lo aplica RLS (`can_see_booking`): un Member ve solo aquellas en
 * las que es anfitrión. Acá no se repite la regla, se la aprovecha.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/types/database";
import type { BookingOrigin, BookingStatus } from "@/lib/scheduling/types";
import { getWorkspaceMembers, memberLabels } from "@/lib/workspace-members";
import { flatAttribution } from "@/lib/attribution/columns";

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
  /** Agenda v2: su horario dejó de contar como ocupado. null = nunca se liberó. */
  slotReleasedAt: string | null;
  createdAt: string;
  /** La atribución de la reunión: solo texto (`utm`, más `referrer_url`), sin `first_visit`. */
  attribution: Record<string, string>;
}

/** La atribución de una reunión, tal como la leen la lista y el panel. */
export function bookingAttributionOf(utm: unknown, referrerUrl: string | null | undefined): Record<string, string> {
  const flat = flatAttribution(utm);
  return referrerUrl && !flat.referrer_url ? { ...flat, referrer_url: referrerUrl } : flat;
}

/** Cuántas agendas trae una página (F33). */
export const PAGE_SIZE = 50;

/** Solo ids de verdad: ni un apóstrofe ni una coma se cuelan en un filtro armado a mano. */
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export interface BookingQuery {
  /** Rango por fecha de inicio. Lo usa el calendario, que navega por ancla. */
  from?: string | null;
  to?: string | null;
  /**
   * Rango por fecha de FIN: lo usan "Próximas" y "Sin resultado". Es el mismo
   * corte que `needsOutcome` (bookings-view.ts): una reunión en curso tiene
   * `start_at` pasado pero `end_at` futuro, y tiene que caer del mismo lado
   * acá que en los contadores, o aparece en una pastilla y se cuenta en otra.
   */
  endFrom?: string | null;
  endTo?: string | null;
  statuses?: BookingStatus[] | null;
  statusGroups?: Database["public"]["Tables"]["bookings"]["Row"]["status_group"][] | null;
  hostUserIds?: string[] | null;
  eventTypeIds?: string[] | null;
  /** Ids de área y tipo, ya expandidos (`expandCategoryFilter`). Compara contra el snapshot congelado. */
  categoryIds?: string[] | null;
  origins?: BookingOrigin[] | null;
  utmSources?: string[] | null;
  utmMediums?: string[] | null;
  utmCampaigns?: string[] | null;
  search?: string | null;
  contactId?: string | null;
  page?: number;
  /** Próximas: ascendente. El resto: lo más reciente primero. */
  ascending?: boolean;
  limit?: number;
}

const SELECT =
  "id, uid, title, start_at, end_at, status, status_group, host_user_id, contact_id, booker_name, booker_email, booker_phone, event_type_id, category_snapshot, origin, location_type, location_text, meet_url, booker_timezone, google_sync_status, slot_released_at, created_at, utm, referrer_url, event_types!inner(color), contacts!inner(display_name)";

export async function listBookings(
  supabase: Db,
  workspaceId: string,
  query: BookingQuery = {},
): Promise<{ items: BookingListItem[]; total: number }> {
  const page = Math.max(1, query.page ?? 1);
  const size = query.limit ?? PAGE_SIZE;

  let q = applyBookingFilters(supabase.from("bookings").select(SELECT, { count: "exact" }).eq("workspace_id", workspaceId), query);

  q = q.order("start_at", { ascending: query.ascending ?? false }).range((page - 1) * size, page * size - 1);

  const { data, error, count } = await q;
  if (error) {
    console.error("[agenda] no pude leer las agendas:", error.message);
    return { items: [], total: 0 };
  }

  const rows = (data ?? []) as unknown as Array<BookingRow & { event_types: { color: string | null } | null; contacts: { display_name: string | null } | null }>;

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
      slotReleasedAt: r.slot_released_at,
      createdAt: r.created_at,
      attribution: bookingAttributionOf(r.utm, r.referrer_url),
    })),
    total: count ?? rows.length,
  };
}

/**
 * Los filtros de la Agenda sobre una consulta de `bookings`: los mismos para la
 * lista y para los contadores, así las dos cuentas no se separan nunca.
 */
function applyBookingFilters<Q extends { gte: any; lt: any; gt: any; lte: any; in: any; eq: any; or: any }>(q: Q, query: BookingQuery): Q {
  if (query.from) q = q.gte("start_at", query.from);
  if (query.to) q = q.lt("start_at", query.to);
  if (query.endFrom) q = q.gt("end_at", query.endFrom);
  if (query.endTo) q = q.lte("end_at", query.endTo);
  if (query.statuses?.length) q = q.in("status", query.statuses);
  if (query.statusGroups?.length) q = q.in("status_group", query.statusGroups);
  if (query.hostUserIds?.length) q = q.in("host_user_id", query.hostUserIds);
  if (query.eventTypeIds?.length) q = q.in("event_type_id", query.eventTypeIds);
  if (query.contactId) q = q.eq("contact_id", query.contactId);
  if (query.origins?.length) q = q.in("origin", query.origins);
  if (query.utmSources?.length) q = q.in("utm->>utm_source", query.utmSources);
  if (query.utmMediums?.length) q = q.in("utm->>utm_medium", query.utmMediums);
  if (query.utmCampaigns?.length) q = q.in("utm->>utm_campaign", query.utmCampaigns);
  if (query.search?.trim()) {
    const needle = `%${query.search.trim().replace(/[%_]/g, "")}%`;
    q = q.or(`booker_name.ilike.${needle},booker_email.ilike.${needle},booker_phone.ilike.${needle}`);
  }

  // El área y el tipo viven adentro del snapshot jsonb, no en una columna: se
  // compara con `->>` en vez de `.in()`. Va DENTRO de la consulta (antes de
  // `.range()`), no en memoria después: si no, el total y la paginación
  // cuentan filas que después se descartan.
  if (query.categoryIds?.length) {
    const ids = query.categoryIds.filter((id) => UUID_RE.test(id));
    if (ids.length) {
      const list = ids.join(",");
      q = q.or(`category_snapshot->>area_id.in.(${list}),category_snapshot->>type_id.in.(${list})`);
    }
  }

  return q;
}

/**
 * Lo mínimo para contar las pastillas de la Agenda (estado y horario), con los
 * mismos filtros y los mismos `!inner` que la lista (una reunión cuyo contacto
 * no se ve tampoco se cuenta). Antes se traían hasta 500 reuniones completas
 * DESPUÉS de la lista; esto va en paralelo y trae tres columnas.
 */
export async function listBookingStatuses(
  supabase: Db,
  workspaceId: string,
  query: BookingQuery = {},
): Promise<Array<{ status: BookingStatus; start_at: string; end_at: string }>> {
  const q = applyBookingFilters(
    supabase.from("bookings").select("status, start_at, end_at, event_types!inner(id), contacts!inner(id)").eq("workspace_id", workspaceId),
    query,
  ).limit(query.limit ?? 2000);
  const { data, error } = await q;
  if (error) {
    console.error("[agenda] no pude contar las agendas:", error.message);
    return [];
  }
  return (data ?? []) as unknown as Array<{ status: BookingStatus; start_at: string; end_at: string }>;
}

/**
 * Las fuentes, medios y campañas de UTM que de verdad existen en el
 * workspace, para las opciones del filtro "UTM" (Agenda v2, 00129).
 *
 * La RPC es `SECURITY INVOKER`: lee `bookings` con el cliente de quien llama,
 * así que un Member con alcance propio solo ve los UTM de sus propias
 * agendas, igual que en la lista.
 */
export async function bookingUtmOptions(supabase: Db, workspaceId: string): Promise<{ sources: string[]; mediums: string[]; campaigns: string[] }> {
  const { data, error } = await supabase.rpc("booking_utm_options", { p_workspace_id: workspaceId });
  if (error) {
    console.error("[agenda] no pude leer las opciones de UTM:", error.message);
    return { sources: [], mediums: [], campaigns: [] };
  }
  const row = (data ?? {}) as { sources?: string[]; mediums?: string[]; campaigns?: string[] };
  return { sources: row.sources ?? [], mediums: row.mediums ?? [], campaigns: row.campaigns ?? [] };
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

/**
 * El detalle de una agenda, con su historial (F36). Un solo viaje: la reunión
 * con su evento y su contacto embebidos, en paralelo con el historial (los dos
 * solo necesitan el id). El contacto y el evento pasan por su RLS igual que
 * antes: si quien mira no ve el contacto, viene `null`.
 */
export async function getBookingDetail(supabase: Db, id: string) {
  const [{ data: row }, { data: history }] = await Promise.all([
    supabase
      .from("bookings")
      .select("*, event_types(id, title, slug, color, duration_minutes, booking_fields), contacts(id, display_name, email, phone)")
      .eq("id", id)
      .maybeSingle(),
    supabase
      .from("audit_log")
      .select("id, action, metadata, changes, performed_at, performed_by, performed_by_agent_id")
      .eq("entity_type", "booking")
      .eq("entity_id", id)
      .order("performed_at", { ascending: false })
      .limit(50),
  ]);
  if (!row) return null;

  const { event_types: event, contacts: contact, ...booking } = row as typeof row & {
    event_types: { id: string; title: string; slug: string; color: string | null; duration_minutes: number; booking_fields: unknown } | null;
    contacts: { id: string; display_name: string | null; email: string | null; phone: string | null } | null;
  };
  return { booking: booking as Database["public"]["Tables"]["bookings"]["Row"], history: history ?? [], event, contact };
}
