import { redirect } from "next/navigation";
import { getPermissionContext } from "@/lib/auth/guards";
import { canOpenConfig } from "@/lib/scheduling/config-sections";
import { getProfileForUser } from "@/lib/scheduling/data/profiles";
import { eventDefaults } from "@/lib/scheduling/data/event-context";
import { brokenCalendarAccounts } from "@/lib/scheduling/data/attention";
import { bookingUtmOptions, getBookingDetail, hostNames, listBookings } from "@/lib/scheduling/data/bookings";
import { listCategories, listEventTypes, toCategoryRow } from "@/lib/scheduling/data/event-types";
import { expandCategoryFilter, categoryLabel } from "@/lib/scheduling/categories";
import { quickFilterCounts, type QuickFilter } from "@/lib/scheduling/bookings-view";
import { ORIGIN_LABELS, isBookingOrigin, type AgendaFilters } from "@/lib/scheduling/agenda-filters";
import { isAgendaPeriod, resolveAgendaPeriod, DEFAULT_AGENDA_PERIOD, type AgendaPeriod } from "@/lib/scheduling/agenda-period";
import { statusesInGroup, isBookingStatus } from "@/lib/scheduling/booking-status";
import { publicBaseUrl, bookingPublicUrl, eventPublicUrl } from "@/lib/scheduling/public-url";
import { dateInTz } from "@/lib/scheduling/time/tz";
import { visibleFields } from "@/lib/scheduling/booking-fields";
import { listParam, pickPage, sanitizeSearch } from "@/lib/url-params";
import { BookingsScreen, type QuickPick } from "@/components/scheduling/bookings/bookings-view";
import type { ShareableEvent } from "@/components/scheduling/bookings/share-links-menu";
import type { CalendarView } from "@/lib/scheduling/calendar-view";
import type { BookingField, BookingOrigin, BookingStatus } from "@/lib/scheduling/types";
import { rangeFor } from "@/lib/scheduling/calendar-range";
import { startOfDay, endOfDay } from "@/lib/dates";

export const dynamic = "force-dynamic";

const QUICK_PICKS: QuickPick[] = ["all", "upcoming", "needs_outcome", "with_outcome", "cancelled"];

/** Los estados que implica la pastilla rápida, ya expandidos a la lista plana de los 11. Null = sin restricción ("Todas"). */
function statusesForQuickPick(quick: QuickPick): BookingStatus[] | null {
  switch (quick) {
    case "all":
      return null;
    case "upcoming":
    case "needs_outcome":
      return statusesInGroup("active");
    case "with_outcome":
      return [...statusesInGroup("no_show"), ...statusesInGroup("outcome")];
    case "cancelled":
      return statusesInGroup("cancelled");
  }
}

/**
 * Agendas (F33 a F37, revisión Agenda v2): lista, kanban y calendario sobre
 * los mismos datos.
 *
 * Los filtros viven en la URL y la consulta se arma acá, en el servidor: la
 * pantalla nunca recibe más agendas que las que puede ver (RLS) ni más de una
 * página por vez.
 *
 * Por defecto se ve TODO (todos los estados, incluidas las canceladas) en la
 * ventana de "últimos 7 + próximos 30 días": antes arrancaba en "Próximas" y
 * una agenda que se cancelaba desaparecía sin cambiar de pestaña.
 */
export default async function AgendaPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const ctx = await getPermissionContext();
  if (!ctx.can("scheduling.use") && !ctx.can("bookings.view")) redirect("/dashboard");

  const query = await searchParams;
  const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);
  const view = one(query.vista) === "kanban" || one(query.vista) === "calendar" ? (one(query.vista) as "kanban" | "calendar") : "list";
  const quick: QuickPick = QUICK_PICKS.includes(one(query.filtro) as QuickPick) ? (one(query.filtro) as QuickPick) : "all";
  const calendarView: CalendarView = one(query.cal) === "day" || one(query.cal) === "month" ? (one(query.cal) as CalendarView) : "week";
  const page = pickPage(query.pagina);
  const period: AgendaPeriod = isAgendaPeriod(one(query.rango) ?? "") ? (one(query.rango) as AgendaPeriod) : DEFAULT_AGENDA_PERIOD;
  const customFrom = one(query.desde);
  const customTo = one(query.hasta);

  const [profile, broken, categories, events, defaults] = await Promise.all([
    ctx.can("scheduling.use") ? getProfileForUser(ctx.supabase, ctx.workspace.id, ctx.user.id) : Promise.resolve(null),
    ctx.can("scheduling.use") ? brokenCalendarAccounts(ctx.supabase, ctx.workspace.id, ctx.user.id) : Promise.resolve([]),
    listCategories(ctx.supabase, ctx.workspace.id),
    listEventTypes(ctx.supabase, ctx.workspace.id),
    ctx.can("scheduling.use")
      ? eventDefaults(ctx.supabase, ctx.workspace as { id: string; scheduling_auto_create_flows?: boolean }, ctx.user.id)
      : Promise.resolve(null),
  ]);

  const timezone = profile?.timezone ?? (ctx.workspace as { timezone?: string }).timezone ?? "America/Costa_Rica";
  const categoryRows = categories.map(toCategoryRow);
  const anchor = /^\d{4}-\d{2}-\d{2}$/.test(one(query.dia) ?? "") ? (one(query.dia) as string) : dateInTz(new Date(), timezone);

  // Los filtros del widget: listas validadas contra lo que de verdad existe en
  // el workspace, para que la URL no meta un id ajeno en un `.in()`.
  const hostIds = new Set(events.map((e) => e.owner_user_id));
  const eventIds = new Set(events.map((e) => e.id));
  const filters: AgendaFilters = {
    statuses: listParam(query.estado).filter(isBookingStatus),
    categoryIds: listParam(query.categoria).filter((id) => categoryRows.some((c) => c.id === id)),
    eventTypeIds: listParam(query.evento).filter((id) => eventIds.has(id)),
    hostUserIds: listParam(query.anfitrion).filter((id) => hostIds.has(id)),
    origins: listParam(query.origen).filter(isBookingOrigin),
    utmSources: listParam(query.utm_source),
    utmMediums: listParam(query.utm_medium),
    utmCampaigns: listParam(query.utm_campaign),
  };
  const search = sanitizeSearch(one(query.q) ?? "");

  // El rango del calendario se corta en la MISMA zona con la que se resolvio
  // el ancla, no en UTC: un `T00:00:00.000Z` fijo corre el dia entero para
  // cualquier zona que no sea UTC.
  const dayBoundary = (day: string) => {
    const [y, m, d] = day.split("-").map(Number);
    return { y, m, d };
  };
  const calendarRange = view === "calendar" ? rangeFor(calendarView, anchor) : null;

  // El período (lista y kanban): un rango a medida en la URL gana sobre el
  // atajo. El calendario navega con su propia ancla y no usa esto.
  const resolvedPeriod =
    customFrom && customTo
      ? { from: new Date(customFrom).toISOString(), to: new Date(customTo).toISOString() }
      : resolveAgendaPeriod(period, new Date(), timezone);

  const base = {
    // Filtrar por un área incluye sus tipos; `expandCategoryFilter` devuelve
    // un Set y la consulta espera una lista.
    categoryIds: filters.categoryIds.length ? [...expandCategoryFilter(filters.categoryIds, categoryRows)] : null,
    eventTypeIds: filters.eventTypeIds.length ? filters.eventTypeIds : null,
    hostUserIds: filters.hostUserIds.length ? filters.hostUserIds : null,
    origins: filters.origins.length ? (filters.origins as BookingOrigin[]) : null,
    utmSources: filters.utmSources.length ? filters.utmSources : null,
    utmMediums: filters.utmMediums.length ? filters.utmMediums : null,
    utmCampaigns: filters.utmCampaigns.length ? filters.utmCampaigns : null,
    search: search || null,
  };

  // La pastilla rápida (grupo de estados) y el filtro fino "Estado" del
  // widget se combinan con un AND: elegir "Próximas" y además "Confirmada"
  // dentro del widget deja solo las confirmadas que todavía no pasaron.
  const quickStatuses = statusesForQuickPick(quick);
  const fineStatuses = filters.statuses.length ? (filters.statuses as BookingStatus[]) : null;
  const effectiveStatuses = quickStatuses && fineStatuses ? quickStatuses.filter((s) => fineStatuses.includes(s)) : (quickStatuses ?? fineStatuses);
  // Una combinación imposible (ej. pastilla "Canceladas" + estado "Venta")
  // no tiene que mostrar la lista entera: `null` es "sin filtro", así que una
  // contradicción se guarda aparte.
  const impossible = effectiveStatuses !== null && effectiveStatuses.length === 0;

  const now = new Date();
  const listQuery =
    view === "calendar"
      ? {
          from: (() => {
            const { y, m, d } = dayBoundary(calendarRange!.from);
            return startOfDay(y, m, d, timezone).toISOString();
          })(),
          to: (() => {
            const { y, m, d } = dayBoundary(calendarRange!.to);
            return endOfDay(y, m, d, timezone).toISOString();
          })(),
          limit: 500,
          ascending: true,
          ...base,
          statuses: effectiveStatuses,
        }
      : view === "kanban"
        ? { from: resolvedPeriod.from, to: resolvedPeriod.to, limit: 300, ascending: true, ...base, statuses: effectiveStatuses }
        : {
            from: resolvedPeriod.from,
            to: resolvedPeriod.to,
            ...base,
            statuses: effectiveStatuses,
            page,
            ascending: quick === "upcoming",
            // "Próximas" y "Sin resultado" comparten estado: se separan por si
            // ya terminó o no (mismo corte que needsOutcome, sobre end_at).
            ...(quick === "upcoming" ? { endFrom: now.toISOString() } : {}),
            ...(quick === "needs_outcome" ? { endTo: now.toISOString() } : {}),
          };

  const [{ items, total }, names] = impossible
    ? [{ items: [], total: 0 }, await hostNames(ctx.workspace.id)]
    : await Promise.all([listBookings(ctx.supabase, ctx.workspace.id, listQuery), hostNames(ctx.workspace.id)]);

  // Los contadores de las pastillas miran todo el período con los demás
  // filtros, no la pastilla elegida ni la página.
  const { items: forCounts } = await listBookings(ctx.supabase, ctx.workspace.id, {
    from: resolvedPeriod.from,
    to: resolvedPeriod.to,
    ...base,
    statuses: fineStatuses,
    limit: 500,
  });
  const quickCounts = quickFilterCounts(
    forCounts.map((i) => ({ status: i.status, start_at: i.startAt, end_at: i.endAt })),
    now,
  );
  const counts: Record<QuickPick, number> = { all: forCounts.length, ...quickCounts };

  const detail = query.agenda ? await getBookingDetail(ctx.supabase, one(query.agenda) ?? "") : null;
  const publicBase = publicBaseUrl(ctx.workspace as { scheduling_public_base_url?: string | null });

  // "Todavía no hay NINGUNA agenda" es un problema distinto de "ninguna con
  // estos filtros": antes los dos mostraban el mismo cartel de "Conectar
  // Google Calendar", aunque ya estuviera conectado.
  const [{ count: everCount }, utmOptions] = await Promise.all([
    ctx.supabase.from("bookings").select("id", { count: "exact", head: true }).eq("workspace_id", ctx.workspace.id),
    bookingUtmOptions(ctx.supabase, ctx.workspace.id),
  ]);

  // El link público de cada evento necesita el usuario de su dueño.
  const { data: profileRows } = await ctx.supabase.from("scheduling_profiles").select("user_id, username").eq("workspace_id", ctx.workspace.id);
  const usernameByUser = new Map((profileRows ?? []).map((p) => [p.user_id, p.username]));
  const shareableEvents: ShareableEvent[] = events
    .filter((e) => e.status === "active")
    .map((e) => {
      const username = usernameByUser.get(e.owner_user_id);
      if (!username) return null;
      return {
        id: e.id,
        title: e.title,
        durationMinutes: e.duration_minutes,
        areaLabel: categoryLabel(e.category_id, categoryRows) || null,
        url: eventPublicUrl(publicBase, username, e.slug),
      };
    })
    .filter((e): e is ShareableEvent => e !== null);

  return (
    <BookingsScreen
      items={items}
      total={total}
      page={page}
      counts={counts}
      hostNames={Object.fromEntries(names)}
      categories={categoryRows}
      eventOptions={events.filter((e) => e.status !== "inactive").map((e) => ({ id: e.id, title: e.title }))}
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
      shareableEvents={shareableEvents}
      hasEverBooked={(everCount ?? 0) > 0}
      hasCalendar={defaults?.hasCalendar ?? false}
      utmOptions={utmOptions}
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
              origin: ORIGIN_LABELS[detail.booking.origin as keyof typeof ORIGIN_LABELS] ?? detail.booking.origin,
              categoryId: detail.booking.category_id,
              categoryLabel: snapshotLabel(detail.booking.category_snapshot),
              syncStatus: detail.booking.google_sync_status,
              syncError: detail.booking.google_sync_error,
              rescheduleUrl: `${bookingPublicUrl(publicBase, detail.booking.uid)}/reagendar`,
              history: detail.history.map((h) => ({ id: h.id, at: h.performed_at, text: historyText(h, names) })),
              attribution: attributionOf((detail.booking as unknown as { utm?: unknown; referrer_url?: string | null }).utm, detail.booking.referrer_url),
            }
          : null
      }
      view={view}
      quick={quick}
      calendarView={calendarView}
      calendarAnchor={anchor}
      period={period}
      customRange={customFrom && customTo ? { from: customFrom, to: customTo } : null}
      filters={filters}
      search={search}
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

function snapshotLabel(snapshot: unknown): string {
  const snap = snapshot as { area_name?: string | null; type_name?: string | null } | null;
  if (!snap?.area_name) return "";
  return snap.type_name ? `${snap.area_name} · ${snap.type_name}` : snap.area_name;
}

/** Fuente, medio, campaña y de dónde vino, para la sección "Atribución" del detalle (Agenda v2). */
function attributionOf(utm: unknown, referrerUrl: string | null): { source: string; medium: string; campaign: string; content: string; term: string; referrerUrl: string | null } | null {
  const u = (utm ?? {}) as Record<string, unknown>;
  const has = Object.keys(u).length > 0 || Boolean(referrerUrl);
  if (!has) return null;
  const str = (v: unknown) => (typeof v === "string" && v ? v : "");
  return {
    source: str(u.utm_source),
    medium: str(u.utm_medium),
    campaign: str(u.utm_campaign),
    content: str(u.utm_content),
    term: str(u.utm_term),
    referrerUrl,
  };
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
      return `Se agendó (${ORIGIN_LABELS[meta.origin as keyof typeof ORIGIN_LABELS] ?? meta.origin ?? "origen desconocido"})`;
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
