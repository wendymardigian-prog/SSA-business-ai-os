import { redirect } from "next/navigation";
import { defaultManualCategory } from "@/lib/scheduling/booking/manual";
import { getPermissionContext } from "@/lib/auth/guards";
import { createServiceClient } from "@/lib/supabase/server";
import { canOpenConfig } from "@/lib/scheduling/config-sections";
import { getProfileForUser } from "@/lib/scheduling/data/profiles";
import { eventDefaults } from "@/lib/scheduling/data/event-context";
import { loadMeetContext } from "@/lib/scheduling/data/meet-availability";
import { meetAvailableFor } from "@/lib/scheduling/meet-availability";
import { brokenCalendarAccounts } from "@/lib/scheduling/data/attention";
import { bookingUtmOptions, hostNames, listBookingStatuses, listBookings } from "@/lib/scheduling/data/bookings";
import { metaLinkFromTouch, touchMetaIds, type MetaLink } from "@/lib/attribution/meta-link";
import { EMPTY_META_NAMES, loadMetaNamesByIds } from "@/lib/attribution/meta-names";
import { loadBookingMatches } from "@/lib/attribution/source-touches";
import { loadBookingLastTouches } from "@/lib/attribution/last-touches-load";
import { listCategories, listEventTypes, toCategoryRow } from "@/lib/scheduling/data/event-types";
import { expandCategoryFilter, categoryLabel } from "@/lib/scheduling/categories";
import { quickFilterCounts } from "@/lib/scheduling/bookings-view";
import { isBookingOrigin, type AgendaFilters } from "@/lib/scheduling/agenda-filters";
import { isAgendaPeriod, resolveAgendaPeriod, DEFAULT_AGENDA_PERIOD, type AgendaPeriod } from "@/lib/scheduling/agenda-period";
import { statusesInGroup, isBookingStatus } from "@/lib/scheduling/booking-status";
import { publicBaseUrl, eventPublicUrl } from "@/lib/scheduling/public-url";
import { dateInTz } from "@/lib/scheduling/time/tz";
import { listParam, pickPage, sanitizeSearch } from "@/lib/url-params";
import { BookingsScreen, type QuickPick } from "@/components/scheduling/bookings/bookings-view";
import type { ShareableEvent } from "@/components/scheduling/bookings/share-links-menu";
import type { CalendarView } from "@/lib/scheduling/calendar-view";
import type { BookingOrigin, BookingStatus } from "@/lib/scheduling/types";
import { rangeFor } from "@/lib/scheduling/calendar-range";
import { startOfDay, endOfDay, todayInputValue } from "@/lib/dates";
import { TASK_COLUMNS } from "@/lib/tasks/core"; // @plantilla-quitar(tareas)
import { dueDateWindow } from "@/lib/tasks/calendar"; // @plantilla-quitar(tareas)
import { parseTasksMode } from "@/lib/tasks/calendar-ui"; // @plantilla-quitar(tareas)
import type { TaskRow } from "@/lib/tasks/types"; // @plantilla-quitar(tareas)
import { getWorkspaceMembers } from "@/lib/workspace-members";
import { resolveViewerTimezone } from "@/lib/user-timezone";
import type { BookingTriggerConfig } from "@/lib/scheduling/automation/triggers";

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

  // Primera tanda, todo en paralelo: lo que no depende de los filtros. Antes iban
  // en cinco pasos seguidos (y la mitad, al final de la pagina).
  const service = await createServiceClient();
  const [profile, broken, categories, events, defaults, timezone, names, { data: anyBooking }, utmOptions, { data: profileRows }, { data: googleRows }, { data: confirmationRows }] =
    await Promise.all([
      ctx.can("scheduling.use") ? getProfileForUser(ctx.supabase, ctx.workspace.id, ctx.user.id) : Promise.resolve(null),
      ctx.can("scheduling.use") ? brokenCalendarAccounts(ctx.supabase, ctx.workspace.id, ctx.user.id) : Promise.resolve([]),
      listCategories(ctx.supabase, ctx.workspace.id),
      listEventTypes(ctx.supabase, ctx.workspace.id),
      ctx.can("scheduling.use")
        ? eventDefaults(ctx.supabase, ctx.workspace as { id: string; scheduling_auto_create_flows?: boolean }, ctx.user.id)
        : Promise.resolve(null),
      // La zona de quien mira, la misma de todo el sistema. `scheduling_profiles.timezone` es otra cosa: la de su horario de atencion.
      resolveViewerTimezone((ctx.workspace as { timezone?: string }).timezone),
      hostNames(ctx.workspace.id),
      // "¿Hay ALGUNA agenda?" alcanza con una fila: un `count exact` recorria todas pasando la RLS por cada una.
      ctx.supabase.from("bookings").select("id").eq("workspace_id", ctx.workspace.id).limit(1),
      bookingUtmOptions(ctx.supabase, ctx.workspace.id),
      // El link público de cada evento necesita el usuario de su dueño. De paso,
      // quién tiene perfil de agenda (para reasignar) y quién conectó Google. Lo
      // segundo (solo el user_id) lo lee el servidor: la RLS de las conexiones se
      // las muestra solo a Owner y Admin, y un rol que reasigna no veia a nadie.
      ctx.supabase.from("scheduling_profiles").select("user_id, username").eq("workspace_id", ctx.workspace.id),
      service.from("oauth_connections").select("user_id").eq("workspace_id", ctx.workspace.id).eq("provider", "google_calendar").eq("status", "active"),
      // Los flujos de confirmacion prendidos: el modal de agendar a mano dice si sale el email.
      // Con el servidor: un rol sin permiso sobre automatizaciones tambien tiene que saberlo.
      service
        .from("triggers")
        .select("config, flows!inner(status)")
        .eq("workspace_id", ctx.workspace.id)
        .eq("type", "booking_created")
        .eq("is_active", true)
        .eq("flows.status", "published"),
    ]);

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

  // Segunda tanda, en paralelo: la lista, los contadores de las pastillas y quien
  // puede crear un Meet. Los contadores miran todo el período con los demás
  // filtros, no la pastilla elegida ni la página; traen solo estado y horario.
  const [{ items, total }, forCounts, meetContext] = await Promise.all([
    impossible ? Promise.resolve({ items: [], total: 0 }) : listBookings(ctx.supabase, ctx.workspace.id, listQuery),
    listBookingStatuses(ctx.supabase, ctx.workspace.id, { from: resolvedPeriod.from, to: resolvedPeriod.to, ...base, statuses: fineStatuses }),
    // Quien puede crear un Google Meet al agendar a mano (lo vuelve a comprobar el servidor al agendar).
    loadMeetContext(service, ctx.workspace.id, [...names.keys(), ...events.map((e) => e.owner_user_id)]),
  ]);
  const quickCounts = quickFilterCounts(forCounts, now);
  const counts: Record<QuickPick, number> = { all: forCounts.length, ...quickCounts };

  const publicBase = publicBaseUrl(ctx.workspace as { scheduling_public_base_url?: string | null });

  // El vinculo con Meta de la lista (solo en esa vista). El detalle de una reunion se pide aparte
  // (`loadBookingDetail`): abrirlo ya no recarga la pagina. Las reuniones ya las leyo la sesion, asi
  // que la RLS decidio cuales ve; el toque va con el cliente de servicio porque quien atiende una
  // reunion puede no ver su contacto. Los nombres, con la sesion: sin `dashboards.ads.view` se ven los ids.
  const linkTargets = view === "list" ? items.map((i) => ({ id: i.id, contactId: i.contactId, createdAt: i.createdAt })) : [];
  const bookingMatches = linkTargets.length ? await loadBookingMatches(service, ctx.workspace.id, linkTargets) : new Map();
  const matchedTouches = [...bookingMatches.values()].flatMap((m) => (m.touch ? [m.touch] : []));
  const metaNames = ctx.can("dashboards.ads.view") && matchedTouches.length ? await loadMetaNamesByIds(ctx.supabase, ctx.workspace.id, matchedTouches.map(touchMetaIds)) : EMPTY_META_NAMES;
  // El «último click» de cada reunión (los últimos 3 toques de cualquier canal antes de agendar): solo en la lista.
  const lastTouches = linkTargets.length ? await loadBookingLastTouches(service, ctx.supabase, ctx.workspace.id, linkTargets.map((t) => t.id)) : {};
  const metaLinks: Record<string, MetaLink> = {};
  for (const [id, match] of bookingMatches) {
    if (match.touch) metaLinks[id] = metaLinkFromTouch(match.touch, metaNames, { ownTouchId: match.ownTouchId, inherited: match.inherited });
  }

  // "Todavía no hay NINGUNA agenda" es un problema distinto de "ninguna con
  // estos filtros": antes los dos mostraban el mismo cartel de "Conectar
  // Google Calendar", aunque ya estuviera conectado.
  // @plantilla-desde(tareas)
  // Las tareas del calendario (Tareas × CRM, R7): SOLO con el interruptor encendido, en la vista calendario y con
  // `tasks.view`. Apagado no se consulta nada de tareas. La RLS decide cuales ve cada quien; «mias» es el responsable.
  const canViewTasks = ctx.can("tasks.view");
  const tasksMode = parseTasksMode(query.tareas, canViewTasks);
  let agendaTasks: import("@/components/scheduling/bookings/bookings-view").AgendaTasksProps | undefined;
  if (canViewTasks) {
    const workspaceTz = (ctx.workspace as { timezone?: string }).timezone || "UTC";
    let rows: TaskRow[] = [];
    let members: Array<{ id: string; name: string }> = [];
    if (tasksMode !== "off" && view === "calendar" && calendarRange) {
      const win = dueDateWindow(calendarRange);
      const base = () => {
        let q = ctx.supabase.from("tasks").select(TASK_COLUMNS).eq("workspace_id", ctx.workspace.id).is("deleted_at", null);
        if (tasksMode === "mine") q = q.eq("owner_id", ctx.user.id);
        return q;
      };
      const [dated, undated, team] = await Promise.all([
        base().gte("due_date", win.from).lte("due_date", win.to).limit(500),
        base().is("due_date", null).neq("status", "completed").order("created_at", { ascending: false }).limit(50),
        getWorkspaceMembers(ctx.workspace.id),
      ]);
      rows = [...((dated.data ?? []) as unknown as TaskRow[]), ...((undated.data ?? []) as unknown as TaskRow[])];
      members = team.map((m) => ({ id: m.userId, name: m.name }));
    }
    agendaTasks = {
      mode: view === "calendar" ? tasksMode : "off",
      rows,
      members,
      currentUserId: ctx.user.id,
      today: todayInputValue(new Date(), timezone),
      workspaceTimeZone: workspaceTz,
      canEdit: ctx.can("tasks.edit"),
      canDelete: ctx.can("tasks.delete"),
    };
  }
  // @plantilla-hasta(tareas)

  const usernameByUser = new Map((profileRows ?? []).map((p) => [p.user_id, p.username]));
  const hasGoogleByUser = new Set((googleRows ?? []).map((c) => c.user_id));
  const confirmationConfigs = (confirmationRows ?? []).map((t) => (t.config ?? {}) as BookingTriggerConfig);
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
      // Agendar a mano (un solo paso): TODOS los eventos, los inactivos tambien
      // (el modal los muestra abajo). El horario es libre, no depende de que el evento este activo.
      events={events.map((e) => ({
        id: e.id,
        title: e.title,
        durationMinutes: e.duration_minutes,
        categoryLabel: categoryLabel(e.category_id, categoryRows),
        hostName: names.get(e.owner_user_id) ?? "Sin nombre",
        hostUserId: e.owner_user_id,
        categoryId: e.category_id,
        status: e.status as "active" | "hidden" | "inactive",
        color: e.color,
        locationType: e.location_type === "google_meet" ? "google_meet" : "manual",
        locationText: e.location_text,
        meetAvailable: meetAvailableFor(meetContext, e.owner_user_id, e.destination_calendar_id),
      }))}
      manualHosts={[...names.entries()]
        .map(([userId, label]) => ({ userId, label, meetAvailable: meetAvailableFor(meetContext, userId) }))
        .sort((a, b) => a.label.localeCompare(b.label))}
      manualAreas={(() => {
        const defaultId = defaultManualCategory(categoryRows);
        return categoryRows
          .filter((c) => c.parent_id === null && !c.archived_at)
          .map((c) => ({ id: c.id, name: c.name, isDefault: c.id === defaultId }));
      })()}
      confirmationConfigs={confirmationConfigs}
      viewerId={ctx.user.id}
      shareableEvents={shareableEvents}
      hasEverBooked={(anyBooking ?? []).length > 0}
      hasCalendar={defaults?.hasCalendar ?? false}
      utmOptions={utmOptions}
      canReassign={ctx.scope("bookings") === "all"}
      reassignHostOptions={[...names.keys()]
        .filter((userId) => usernameByUser.has(userId))
        .map((userId) => ({
          userId,
          label: names.get(userId) ?? "Sin nombre",
          hasGoogle: hasGoogleByUser.has(userId),
          // Reasignar con reunión nueva: un calendario propio donde crearla (el servidor lo recomprueba con el destino del evento).
          canRecreate: meetAvailableFor(meetContext, userId),
        }))}
      metaLinks={metaLinks}
      lastTouches={lastTouches}
      canLinkMeta={ctx.can("settings.general")}
      canEditContact={ctx.can("contacts.edit")}
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
      tasks={agendaTasks} // @plantilla-quitar(tareas)
    />
  );
}
