import { redirect } from "next/navigation";
import { getPermissionContext } from "@/lib/auth/guards";
import { canOpenConfig } from "@/lib/scheduling/config-sections";
import { getProfileForUser } from "@/lib/scheduling/data/profiles";
import { brokenCalendarAccounts } from "@/lib/scheduling/data/attention";
import { getBookingDetail, hostNames, listBookings } from "@/lib/scheduling/data/bookings";
import { listCategories, listEventTypes, toCategoryRow } from "@/lib/scheduling/data/event-types";
import { expandCategoryFilter, categoryLabel } from "@/lib/scheduling/categories";
import { quickFilterCounts, type QuickFilter } from "@/lib/scheduling/bookings-view";
import { statusesInGroup } from "@/lib/scheduling/booking-status";
import { publicBaseUrl, bookingPublicUrl } from "@/lib/scheduling/public-url";
import { dateInTz } from "@/lib/scheduling/time/tz";
import { visibleFields } from "@/lib/scheduling/booking-fields";
import { BookingsScreen } from "@/components/scheduling/bookings/bookings-view";
import type { CalendarView } from "@/lib/scheduling/calendar-view";
import type { BookingField, BookingStatus } from "@/lib/scheduling/types";
import { rangeFor } from "@/lib/scheduling/calendar-range";

export const dynamic = "force-dynamic";

const QUICK: QuickFilter[] = ["upcoming", "needs_outcome", "with_outcome", "cancelled"];

/**
 * Agendas (F33 a F37): lista, kanban y calendario sobre los mismos datos.
 *
 * Los filtros viven en la URL y la consulta se arma acá, en el servidor: la
 * pantalla nunca recibe más agendas que las que puede ver (RLS) ni más de una
 * página por vez.
 */
export default async function AgendaPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const ctx = await getPermissionContext();
  if (!ctx.can("scheduling.use") && !ctx.can("bookings.view")) redirect("/dashboard");

  const query = await searchParams;
  const view = query.vista === "kanban" || query.vista === "calendar" ? query.vista : "list";
  const quick: QuickFilter = QUICK.includes(query.filtro as QuickFilter) ? (query.filtro as QuickFilter) : "upcoming";
  const calendarView: CalendarView = query.cal === "day" || query.cal === "month" ? query.cal : "week";
  const page = Math.max(1, Number(query.pagina) || 1);

  const [profile, broken, categories, events] = await Promise.all([
    ctx.can("scheduling.use") ? getProfileForUser(ctx.supabase, ctx.workspace.id, ctx.user.id) : Promise.resolve(null),
    ctx.can("scheduling.use") ? brokenCalendarAccounts(ctx.supabase, ctx.workspace.id, ctx.user.id) : Promise.resolve([]),
    listCategories(ctx.supabase, ctx.workspace.id),
    listEventTypes(ctx.supabase, ctx.workspace.id),
  ]);

  const timezone = profile?.timezone ?? (ctx.workspace as { timezone?: string }).timezone ?? "America/Costa_Rica";
  const categoryRows = categories.map(toCategoryRow);
  const anchor = query.dia && /^\d{4}-\d{2}-\d{2}$/.test(query.dia) ? query.dia : dateInTz(new Date(), timezone);

  // El rango sólo lo usa el calendario; la lista y el kanban traen la página.
  const range = view === "calendar" ? rangeFor(calendarView, anchor) : null;

  const base = {
    // Filtrar por un área incluye sus tipos; `expandCategoryFilter` devuelve
    // un Set y la consulta espera una lista.
    categoryIds: query.categoria ? [...expandCategoryFilter([query.categoria], categoryRows)] : null,
    hostUserId: query.anfitrion ?? null,
    search: query.q ?? null,
  };

  const quickToQuery: Record<QuickFilter, { statuses?: BookingStatus[]; ascending: boolean }> = {
    upcoming: { statuses: statusesInGroup("active"), ascending: true },
    needs_outcome: { statuses: statusesInGroup("active"), ascending: false },
    with_outcome: { statuses: [...statusesInGroup("no_show"), ...statusesInGroup("outcome")], ascending: false },
    cancelled: { statuses: statusesInGroup("cancelled"), ascending: false },
  };

  const now = new Date();
  const listQuery =
    view === "calendar"
      ? { from: `${range!.from}T00:00:00.000Z`, to: `${range!.to}T23:59:59.999Z`, limit: 500, ascending: true, ...base }
      : view === "kanban"
        ? { limit: 300, ascending: true, ...base }
        : {
            ...quickToQuery[quick],
            ...base,
            page,
            // "Próximas" y "Sin resultado" comparten estados: se separan por la hora.
            ...(quick === "upcoming" ? { from: now.toISOString() } : {}),
            ...(quick === "needs_outcome" ? { to: now.toISOString() } : {}),
          };

  const [{ items, total }, names] = await Promise.all([
    listBookings(ctx.supabase, ctx.workspace.id, listQuery),
    hostNames(ctx.workspace.id),
  ]);

  // Los contadores de las pastillas miran todo lo visible, no la página.
  const { items: forCounts } = await listBookings(ctx.supabase, ctx.workspace.id, { ...base, limit: 500 });
  const counts = quickFilterCounts(
    forCounts.map((i) => ({ status: i.status, start_at: i.startAt, end_at: i.endAt })),
    now,
  );

  const detail = query.agenda ? await getBookingDetail(ctx.supabase, query.agenda) : null;
  const publicBase = publicBaseUrl(ctx.workspace as { scheduling_public_base_url?: string | null });

  return (
    <BookingsScreen
      items={items}
      total={total}
      page={page}
      counts={counts}
      hostNames={Object.fromEntries(names)}
      categories={categoryRows}
      events={events
        .filter((e) => e.status !== "inactive")
        .map((e) => ({
          id: e.id,
          title: e.title,
          durationMinutes: e.duration_minutes,
          areaName: null,
          categoryLabel: categoryLabel(e.category_id, categoryRows),
          hostName: names.get(e.owner_user_id) ?? "Sin nombre",
          hidden: e.status === "hidden",
          fields: visibleFields((e.booking_fields as unknown as BookingField[]) ?? []),
          color: e.color,
        }))}
      detail={
        detail
          ? {
              id: detail.booking.id,
              uid: detail.booking.uid,
              title: detail.booking.title,
              startAt: detail.booking.start_at,
              endAt: detail.booking.end_at,
              status: detail.booking.status,
              hostName: names.get(detail.booking.host_user_id) ?? "Sin nombre",
              hostTimezone: detail.booking.host_timezone ?? timezone,
              inviteeTimezone: detail.booking.booker_timezone ?? timezone,
              contactId: detail.booking.contact_id,
              contactName: detail.contact?.display_name ?? detail.booking.booker_name ?? null,
              bookerEmail: detail.booking.booker_email,
              bookerPhone: detail.booking.booker_phone,
              responses: answersOf(detail.booking.responses, events, detail.booking.event_type_id),
              internalNotes: detail.booking.internal_notes,
              locationType: detail.booking.location_type,
              locationText: detail.booking.location_text,
              meetUrl: detail.booking.meet_url,
              origin: ORIGIN_LABEL[detail.booking.origin] ?? detail.booking.origin,
              categoryId: detail.booking.category_id,
              categoryLabel: snapshotLabel(detail.booking.category_snapshot),
              syncStatus: detail.booking.google_sync_status,
              syncError: detail.booking.google_sync_error,
              rescheduleUrl: `${bookingPublicUrl(publicBase, detail.booking.uid)}/reagendar`,
              history: detail.history.map((h) => ({ id: h.id, at: h.performed_at, text: historyText(h, names) })),
            }
          : null
      }
      view={view}
      quick={quick}
      calendarView={calendarView}
      calendarAnchor={anchor}
      filters={{ categoryId: query.categoria ?? null, hostUserId: query.anfitrion ?? null, search: query.q ?? "" }}
      timezone={timezone}
      timeFormat={profile?.time_format ?? "24h"}
      scopeAll={ctx.scope("bookings") === "all"}
      canManage={ctx.can("bookings.manage")}
      showConfig={canOpenConfig(ctx.can)}
      brokenAccounts={broken}
      needsProfile={ctx.can("scheduling.use") && !profile}
    />
  );
}

const ORIGIN_LABEL: Record<string, string> = {
  public_page: "Link público",
  embed: "Embed",
  manual: "A mano",
  agent: "Agente de IA",
  api: "API",
};

function snapshotLabel(snapshot: unknown): string {
  const snap = snapshot as { area_name?: string | null; type_name?: string | null } | null;
  if (!snap?.area_name) return "";
  return snap.type_name ? `${snap.area_name} · ${snap.type_name}` : snap.area_name;
}

/**
 * Las respuestas con la etiqueta del formulario. Si el evento cambió de
 * preguntas, la clave se muestra tal cual: es preferible a esconder una
 * respuesta que la persona sí escribió.
 */
function answersOf(
  responses: unknown,
  events: Array<{ id: string; booking_fields: unknown }>,
  eventTypeId: string,
): Array<{ label: string; value: string }> {
  const fields = ((events.find((e) => e.id === eventTypeId)?.booking_fields as BookingField[] | undefined) ?? []) as BookingField[];
  const byId = new Map(fields.map((f) => [f.identifier, f.label]));
  const out: Array<{ label: string; value: string }> = [];
  for (const [key, value] of Object.entries((responses as Record<string, unknown>) ?? {})) {
    if (value === null || value === undefined || value === "") continue;
    out.push({ label: byId.get(key) ?? key, value: Array.isArray(value) ? value.join(", ") : String(value) });
  }
  return out;
}

/** Una línea del historial en palabras. */
function historyText(entry: { action: string; metadata: unknown; changes: unknown; performed_by: string | null }, names: Map<string, string>): string {
  const who = entry.performed_by ? names.get(entry.performed_by) ?? "Alguien del equipo" : "El sistema";
  const meta = (entry.metadata ?? {}) as Record<string, unknown>;
  const changes = (entry.changes ?? {}) as Record<string, { old?: unknown; new?: unknown }>;

  switch (entry.action) {
    case "booking.created":
      return `Se agendó (${ORIGIN_LABEL[String(meta.origin ?? "")] ?? meta.origin ?? "origen desconocido"})`;
    case "booking.rescheduled":
      return `${who} cambió la fecha`;
    case "booking.cancelled":
      return `${meta.by === "invitee" ? "El invitado" : who} canceló${meta.reason ? `: ${meta.reason}` : ""}`;
    case "booking.status_changed":
      return `${who} cambió el estado a ${String(changes.status?.new ?? "")}`;
    case "booking.updated":
      return `${who} editó la agenda`;
    case "booking.sync_ok":
      return "Google Calendar quedó al día";
    case "booking.sync_failed":
      return `No se pudo sincronizar con Google${meta.error ? `: ${meta.error}` : ""}`;
    default:
      return entry.action;
  }
}
