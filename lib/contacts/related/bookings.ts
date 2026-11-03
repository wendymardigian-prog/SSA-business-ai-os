/**
 * La lista de contactos: agendas (reuniones de la Agenda, Etapa 4).
 *
 * Filtros por join con `bookings` (respeta su RLS: `can_see_booking`) y
 * columnas que se cargan solo para la página que se ve.
 */
import { BOOKING_STATUSES, statusLabel, isBookingStatus, groupOf } from "@/lib/scheduling/booking-status";
import { hasRelatedFilter, relatedDateFilter, relatedMultiFilter } from "../filters/catalog";
import { UUID_RE, byContact, fillCells, type CellValue, type ContactListModule, type ListGroupDef } from "../filters/types";

export const BOOKINGS_GROUP: ListGroupDef = { key: "agenda", label: "Agenda", order: 70 };

interface BookingRow {
  contact_id: string;
  start_at: string;
  status: string;
  title: string | null;
}

export const bookingsModule: ContactListModule = {
  key: "agenda",
  filters: [
    hasRelatedFilter({ param: "agenda", label: "Tiene agenda", group: BOOKINGS_GROUP, relation: "bookings", columns: ["id"], keywords: "reunion llamada cita" }),
    relatedMultiFilter({
      param: "estado_agenda",
      label: "Estado de la agenda",
      group: BOOKINGS_GROUP,
      relation: "bookings",
      column: "status",
      accepts: (v) => isBookingStatus(v),
      options: { static: BOOKING_STATUSES.map((s) => ({ value: s.key, label: s.label })) },
      keywords: "no-show cancelada confirmada",
      hint: "Alguna de sus agendas está en este estado.",
    }),
    relatedMultiFilter({
      param: "tipo_evento",
      label: "Tipo de evento",
      group: BOOKINGS_GROUP,
      relation: "bookings",
      column: "event_type_id",
      accepts: (v) => UUID_RE.test(v),
      options: { from: "eventTypes" },
      keywords: "reunion evento",
    }),
    relatedMultiFilter({
      param: "anfitrion",
      label: "Anfitrión",
      group: BOOKINGS_GROUP,
      relation: "bookings",
      column: "host_user_id",
      accepts: (v) => UUID_RE.test(v),
      options: { from: "members" },
      keywords: "host closer",
    }),
    relatedDateFilter({
      param: "fecha_agenda",
      label: "Fecha de la agenda",
      group: BOOKINGS_GROUP,
      relation: "bookings",
      column: "start_at",
      presets: ["proximas", "pasadas", "hoy", "proximos7", "7d", "30d"],
      keywords: "reunion cuando",
    }),
  ],
  columns: [
    { key: "next_booking", label: "Próxima agenda", group: BOOKINGS_GROUP, hideable: true, defaultVisible: false, source: "related", keywords: "reunion" },
    { key: "last_booking", label: "Última agenda", group: BOOKINGS_GROUP, hideable: true, defaultVisible: false, source: "related", keywords: "reunion estado" },
    { key: "bookings_count", label: "Cantidad de agendas", group: BOOKINGS_GROUP, hideable: true, defaultVisible: false, source: "related", keywords: "reuniones" },
  ],
  async loadOptions(supabase, workspaceId) {
    const { data, error } = await supabase.from("event_types").select("id, title").eq("workspace_id", workspaceId).is("deleted_at", null).order("title");
    if (error) throw new Error(error.message);
    return { eventTypes: (data ?? []).map((e) => ({ value: e.id, label: e.title })) };
  },
  async loadCells(supabase, workspaceId, contactIds, keys) {
    const { data, error } = await supabase
      .from("bookings")
      .select("contact_id, start_at, status, title")
      .eq("workspace_id", workspaceId)
      .in("contact_id", [...contactIds])
      .order("start_at", { ascending: true })
      .limit(2000);
    if (error) throw new Error(error.message);
    return bookingCells(contactIds, keys, (data ?? []) as BookingRow[], new Date());
  },
};

/** Puro: las celdas a partir de las agendas de la página (ordenadas por fecha). */
export function bookingCells(contactIds: readonly string[], keys: readonly string[], rows: readonly BookingRow[], now: Date) {
  const grouped = byContact(rows);
  return fillCells(contactIds, keys, (id) => {
    const list = grouped.get(id) ?? [];
    const nowMs = now.getTime();
    const next = list.find((b) => new Date(b.start_at).getTime() >= nowMs && isBookingStatus(b.status) && groupOf(b.status) === "active");
    const past = list.filter((b) => new Date(b.start_at).getTime() < nowMs);
    const last = past[past.length - 1];
    const cells: Record<string, CellValue> = {
      next_booking: next ? { t: "date", at: next.start_at, mode: "datetime", ...(next.title ? { sub: next.title } : {}) } : null,
      // La fecha va como fecha (el navegador la muestra en la zona de quien mira) y el estado debajo.
      last_booking: last ? { t: "date", at: last.start_at, mode: "day", sub: isBookingStatus(last.status) ? statusLabel(last.status) : last.status } : null,
      bookings_count: list.length > 0 ? { t: "number", n: list.length, ...(next ? { sub: "1 próxima" } : {}) } : null,
    };
    return cells;
  });
}
