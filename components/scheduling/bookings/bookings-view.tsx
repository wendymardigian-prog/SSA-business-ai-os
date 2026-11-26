"use client";

/**
 * La pantalla de Agendas (F33 a F37, revisión Agenda v2): lista, kanban y
 * calendario sobre los mismos datos, con los filtros arriba.
 *
 * Los filtros viven en la URL: así se comparte un link con lo que uno está
 * mirando y el botón de atrás hace lo que se espera. La vista elegida también.
 *
 * La barra superior sigue la misma convención que el resto del dashboard
 * (`PageHeader`, slot `filters`): vista, período, filtros y buscador van ahí,
 * no sueltos en el contenido como antes.
 */

import { useCallback, useEffect, useMemo, useRef, useState, useTransition } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import { CalendarDays, KanbanSquare, List, Plus, Settings } from "lucide-react";
import { ViewToggle } from "@/components/ui/view-toggle";
import { PageHeader } from "@/components/page-header";
import { ReconnectBanner } from "../reconnect-banner";
import { NoGoogleNotice } from "../no-google-notice";
import type { MetaLink } from "@/lib/attribution/meta-link";
import { BookingsList } from "./list";
import { ColumnsMenu } from "@/components/ui/data-table/columns-menu";
import { useTablePrefs } from "@/components/ui/data-table/use-table-prefs";
import { AGENDA_TABLE_KEY, agendaColumnMetas } from "@/lib/scheduling/agenda-columns";
import { basePrefsFor } from "@/lib/ui/data-table/prefs";
import type { BookingTouchView } from "@/lib/attribution/last-touches";
import { BookingsKanban } from "./kanban-board";
import { BookingsCalendar } from "./calendar-grid";
import { useRescheduleDrag } from "./reschedule-dialog";
import { wallTimeOfMinutes } from "@/lib/scheduling/booking-drag";
import { TaskWorkbench, useTaskWorkbench } from "@/components/tasks/task-workbench"; // @plantilla-quitar(tareas)
import { dueToStored } from "@/lib/tasks/due-view"; // @plantilla-quitar(tareas)
import { tasksModeParam, type TasksMode } from "@/lib/tasks/calendar-ui"; // @plantilla-quitar(tareas)
import type { TaskRow } from "@/lib/tasks/types"; // @plantilla-quitar(tareas)
import type { MemberLite } from "@/lib/tasks/table-model"; // @plantilla-quitar(tareas)
import { BookingDetailPanel, BookingDetailSkeleton, type BookingDetailData } from "./detail-panel";
import { loadBookingDetail } from "@/lib/actions/scheduling/booking-detail";
import { BookManualDialog, type ManualEventOption } from "./book-manual-dialog";
import { AgendaFiltersMenu } from "./agenda-filters-menu";
import { AgendaFilterSummary } from "./agenda-filter-summary";
import { AgendaEmptyFiltered, AgendaEmptyWorkspace } from "./agenda-empty-state";
import { ShareLinksMenu, type ShareableEvent } from "./share-links-menu";
import { useAgendaUrl } from "./use-agenda-url";
import type { BookingListItem } from "@/lib/scheduling/data/bookings";
import type { BookingStatus, SlotsByDate } from "@/lib/scheduling/types";
import type { CalendarView } from "@/lib/scheduling/calendar-view";
import type { CategoryRow } from "@/lib/scheduling/categories";
import type { BookingTriggerConfig } from "@/lib/scheduling/automation/triggers";
import { QUICK_FILTER_LABELS, type QuickFilter } from "@/lib/scheduling/bookings-view";
import type { AgendaFilters } from "@/lib/scheduling/agenda-filters";
import { AGENDA_PERIODS, AGENDA_PERIOD_LABELS, type AgendaPeriod } from "@/lib/scheduling/agenda-period";
import { PeriodPopover } from "@/components/dashboards/chat/filters/period-popover";
import { ExpandableSearch } from "@/components/ui/expandable-search";
import { agendaSearchHint } from "@/lib/scheduling/agenda-search-hint";
import { gmtOffsetLabel, timezoneCityLabel } from "@/lib/scheduling/booker/format";
import { changeBookingStatus, cancelBookingAsHost, searchContactsForBooking } from "@/lib/actions/scheduling/bookings";
import { DEFAULT_CONFIG_SECTION } from "@/lib/scheduling/config-sections";
import { durationMinutesOf, googleLayerParam, type AgendaGoogleEvent } from "@/lib/google-calendar/agenda";
import type { AgendaGoogleData } from "@/lib/google-calendar/agenda-load";
import { refreshMyGoogleEvents } from "@/lib/actions/scheduling/google-events";
import { CalendarShowMenu } from "./calendar-show-menu";
import { showsCancelled, statusParams } from "@/lib/scheduling/calendar-show";
import { CreateChoiceDialog, GoogleCreateDialog, GoogleEventPanel, GoogleImportDialog, GoogleMoveDialog } from "./google-event-panel";
import { groupOf } from "@/lib/scheduling/booking-status";
import { TEAM_LAYOUT_STORAGE_KEY, type TeamBusyStatus } from "@/lib/scheduling/team-view";
import { Tip } from "@/components/ui/tooltip";

/** La pastilla rápida de la lista: los cuatro de siempre, más "Todas" (ahora el default). */
export type QuickPick = QuickFilter | "all";

const QUICK_PICK_LABELS: Record<QuickPick, string> = { all: "Todas", ...QUICK_FILTER_LABELS };
const QUICK_PICK_ORDER: QuickPick[] = ["all", "upcoming", "needs_outcome", "with_outcome", "cancelled"];

const VIEWS: Array<{ value: "list" | "kanban" | "calendar"; label: string; icon: typeof List }> = [
  { value: "list", label: "Lista", icon: List },
  { value: "kanban", label: "Kanban", icon: KanbanSquare },
  { value: "calendar", label: "Calendario", icon: CalendarDays },
];

// @plantilla-desde(tareas)
/** Lo que la pagina arma para las tareas del calendario. */
export interface AgendaTasksProps {
  mode: TasksMode;
  rows: TaskRow[];
  members: MemberLite[];
  currentUserId: string;
  /** AAAA-MM-DD en la zona de quien mira. */
  today: string;
  /** La zona de las fechas de las tareas (la del workspace). */
  workspaceTimeZone: string;
  canEdit: boolean;
  canDelete: boolean;
}
// @plantilla-hasta(tareas)
// @plantilla-sin(tareas): export type AgendaTasksProps = never;

export function BookingsScreen({
  items,
  total,
  page,
  counts,
  hostNames,
  categories,
  events,
  manualHosts,
  manualAreas,
  confirmationConfigs,
  viewerId,
  eventOptions,
  shareableEvents,
  hasEverBooked,
  hasCalendar,
  utmOptions,
  canReassign,
  reassignHostOptions,
  metaLinks,
  lastTouches,
  canLinkMeta,
  canEditContact,
  view,
  quick,
  calendarView,
  calendarAnchor,
  period,
  customRange,
  filters,
  search,
  timezone,
  timeFormat,
  scopeAll,
  canManage,
  canDelete = false,
  showConfig,
  brokenAccounts,
  noGoogle = false,
  needsProfile,
  tasks,
  google,
  meetingsShown = true,
  canSeeTeam = false,
  team,
}: {
  items: BookingListItem[];
  total: number;
  page: number;
  counts: Record<QuickPick, number>;
  hostNames: Record<string, string>;
  categories: CategoryRow[];
  /** Todos los eventos (activos e inactivos), para elegir uno al agendar a mano. */
  events: ManualEventOption[];
  /** Agendar a mano sin evento: quien puede atender y en que area. */
  manualHosts: Array<{ userId: string; label: string; meetAvailable: boolean }>;
  manualAreas: Array<{ id: string; name: string; isDefault: boolean }>;
  confirmationConfigs: BookingTriggerConfig[];
  viewerId: string;
  /** Los eventos para el filtro ("Evento"): id y título nomás. */
  eventOptions: Array<{ id: string; title: string }>;
  /** Los eventos activos, para "Compartir" y para el estado vacío del workspace. */
  shareableEvents: ShareableEvent[];
  /** false: el workspace no tiene NINGUNA agenda todavía (sin importar filtros). */
  hasEverBooked: boolean;
  hasCalendar: boolean;
  /** Fuente/medio/campaña que de verdad existen en el workspace, para el grupo "UTM" del widget de filtros. */
  utmOptions: { sources: string[]; mediums: string[]; campaigns: string[] };
  /** Owner/Admin con alcance total (Agenda v2): solo ellos reasignan. */
  canReassign: boolean;
  /** Quién tiene perfil de agenda, para elegir a quién reasignar (incluye al anfitrión actual, se saca al armar el detalle). */
  reassignHostOptions: Array<{ userId: string; label: string; hasGoogle: boolean; canRecreate: boolean }>;
  /** El vínculo con Meta de cada reunión de la lista. */
  metaLinks: Record<string, MetaLink>;
  /** El «último click» de cada reunión de la lista: los últimos toques antes de agendar. */
  lastTouches: Record<string, BookingTouchView[]>;
  /** `settings.general`: vincular, ignorar o quitar el vínculo con Meta. */
  canLinkMeta: boolean;
  /** `contacts.edit`: editar el nombre del contacto desde el panel de la reunión. */
  canEditContact: boolean;
  view: "list" | "kanban" | "calendar";
  quick: QuickPick;
  calendarView: CalendarView;
  calendarAnchor: string;
  period: AgendaPeriod;
  /** Un rango a medida, si lo hay: gana sobre `period`. */
  customRange: { from: string; to: string } | null;
  filters: AgendaFilters;
  search: string;
  timezone: string;
  timeFormat: "12h" | "24h";
  scopeAll: boolean;
  canManage: boolean;
  /** `bookings.delete`: «Eliminar» en el detalle (va a la Papelera). */
  canDelete?: boolean;
  showConfig: boolean;
  brokenAccounts: string[];
  /** La persona no tiene Google Calendar conectado (y ninguna cuenta rota, que tiene su propio aviso). */
  noGoogle?: boolean;
  needsProfile: boolean;
  /**  @plantilla-quitar(tareas)
   * Tareas × CRM (R7): las tareas del calendario. `undefined` = el contacto no puede ver tareas (no hay interruptor). Con  @plantilla-quitar(tareas)
   * `mode: "off"` el interruptor existe pero no se consulto nada de tareas.  @plantilla-quitar(tareas)
   * @plantilla-quitar(tareas) */
  tasks?: AgendaTasksProps;
  /** 00510: los eventos de Google Calendar de quien mira (solo en el calendario y con `scheduling.use`). */
  google?: AgendaGoogleData;
  /** «Qué mostrar»: `?reuniones=0` oculta las reuniones del calendario. */
  meetingsShown?: boolean;
  /** Quien mira ve las agendas de todos: en «Día» puede elegir «Por persona» (la vista de equipo) o «Todo junto». */
  canSeeTeam?: boolean;
  /** La vista de equipo, ya armada (solo en «Día», con permiso y sin `?equipo=0`): el ocupado real de cada persona. */
  team?: Array<{ userId: string; name: string; status: TeamBusyStatus; busy: Array<{ startAt: string; endAt: string }> }>;
}) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { pending: navigating, setParam, setParams, setPeriod, clearAll } = useAgendaUrl();
  // «Por persona / Todo junto» (vista de equipo en «Día»): vive en la URL (`?equipo=0`) y se recuerda en el navegador.
  function setTeamLayout(on: boolean) {
    try {
      window.localStorage.setItem(TEAM_LAYOUT_STORAGE_KEY, on ? "1" : "0");
    } catch {
      // sin almacenamiento, solo la URL
    }
    setParam("equipo", on ? null : "0");
  }
  const teamParam = searchParams.get("equipo");
  useEffect(() => {
    if (!canSeeTeam || view !== "calendar" || calendarView !== "day" || teamParam !== null) return;
    let saved: string | null = null;
    try {
      saved = window.localStorage.getItem(TEAM_LAYOUT_STORAGE_KEY);
    } catch {
      saved = null;
    }
    if (saved === "0") setParam("equipo", "0");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [canSeeTeam, view, calendarView, teamParam]);
  const [manualOpen, setManualOpen] = useState(false);
  // el horario arrastrado en el calendario (sin esto, «Agendar» arranca en la próxima media hora).
  const [manualSlot, setManualSlot] = useState<{ date: string; time: string; durationMinutes: number; hostUserId?: string | null } | null>(null);
  const [cancelDrop, setCancelDrop] = useState<{ id: string; status: BookingStatus } | null>(null);
  const [reason, setReason] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const reschedule = useRescheduleDrag({ items, timezone, timeFormat });
  // Las columnas de la lista viven acá porque su botón está en la barra de arriba, al lado de los filtros.
  // Las columnas de la lista: el catálogo, lo normal (el contacto fijo) y lo que eligió cada persona en su navegador.
  const columnMetas = useMemo(() => agendaColumnMetas(), []);
  const columnBase = useMemo(() => basePrefsFor(columnMetas), [columnMetas]);
  const columns = useTablePrefs(AGENDA_TABLE_KEY, "base", columnMetas, columnBase);

  const now = useMemo(() => new Date(), []);
  const hostOptions = useMemo(() => Object.entries(hostNames).map(([userId, label]) => ({ userId, label })).sort((a, b) => a.label.localeCompare(b.label)), [hostNames]);
  const catalog = useMemo(
    () => ({ categories, events: new Map(eventOptions.map((e) => [e.id, e.title])), hosts: new Map(hostOptions.map((h) => [h.userId, h.label])) }),
    [categories, eventOptions, hostOptions],
  );

  // El detalle abierto vive en `?agenda=` (un link lo abre), pero abrirlo o
  // cerrarlo NO le pide la página al servidor: se cambia la URL con la API del
  // navegador y el detalle se pide aparte (`loadBookingDetail`). Antes cada
  // clic recargaba la pantalla entera.
  const openId = searchParams.get("agenda");

  // La pestaña elegida se marca en el clic, sin esperar al servidor: mientras
  // la navegación está en curso se muestra la elegida; al terminar, manda otra
  // vez lo que dice la página.
  const [clicked, setClicked] = useState<string | null>(null);
  const shownView = navigating && clicked ? clicked : view;
  // Lo último que llegó del servidor, con el id que se pidió: si no coincide con
  // el abierto, se muestra el esqueleto (y no los datos de otra reunión).
  const [loaded, setLoaded] = useState<{ id: string; data: BookingDetailData | null } | null>(null);
  const detail = loaded && loaded.id === openId ? loaded.data : null;
  const detailMissing = loaded !== null && loaded.id === openId && loaded.data === null;

  const openDetail = useCallback((id: string) => {
    const next = new URLSearchParams(window.location.search);
    next.set("agenda", id);
    next.delete("gcal");
    window.history.pushState(null, "", `?${next.toString()}`);
  }, []);
  const closeDetail = useCallback(() => {
    const next = new URLSearchParams(window.location.search);
    next.delete("agenda");
    const qs = next.toString();
    window.history.replaceState(null, "", qs ? `?${qs}` : window.location.pathname);
  }, []);

  // ── 00510: Google Calendar ────────────────────────────────────────────────────────────────────────────────────────
  // El evento abierto vive en `?gcal=` (igual que una reunión en `?agenda=`, sin recargar la página).
  const gcalId = searchParams.get("gcal");
  const gcalEvent = useMemo(() => (gcalId && google ? (google.events.find((e) => e.id === gcalId) ?? null) : null), [gcalId, google]);
  const openGoogle = useCallback((id: string) => {
    const next = new URLSearchParams(window.location.search);
    next.set("gcal", id);
    next.delete("agenda");
    window.history.pushState(null, "", `?${next.toString()}`);
  }, []);
  const closeGoogle = useCallback(() => {
    const next = new URLSearchParams(window.location.search);
    next.delete("gcal");
    const qs = next.toString();
    window.history.replaceState(null, "", qs ? `?${qs}` : window.location.pathname);
  }, []);
  const [refreshing, setRefreshing] = useState(false);
  const refreshGoogle = useCallback(
    (force: boolean) => {
      setRefreshing(true);
      refreshMyGoogleEvents({ force })
        .then((r) => {
          if (r.refreshed > 0 || force) router.refresh();
        })
        .catch(() => undefined)
        .finally(() => setRefreshing(false));
    },
    [router],
  );
  const googleOn = !!google?.on;
  // Al abrir el calendario con Google prendido, se relee si pasó más de un minuto (lo decide el servidor).
  // En segundo plano: sin la ruedita (solo «Actualizar» la muestra).
  useEffect(() => {
    if (!googleOn) return;
    let alive = true;
    refreshMyGoogleEvents({ force: false })
      .then((r) => {
        if (alive && r.refreshed > 0) router.refresh();
      })
      .catch(() => undefined);
    return () => {
      alive = false;
    };
  }, [googleOn, router]);
  const [googleMove, setGoogleMove] = useState<{ event: AgendaGoogleEvent; startUtc: string; durationMinutes: number } | null>(null);
  const [createChoice, setCreateChoice] = useState<{ date: string; startMinutes: number; durationMinutes: number; hostUserId?: string | null } | null>(null);
  const [googleCreate, setGoogleCreate] = useState<{ date: string; startMinutes: number; durationMinutes: number } | null>(null);
  const [googleImport, setGoogleImport] = useState<AgendaGoogleEvent | null>(null);
  // Una tarea pedida desde «¿Qué querés crear?»: se abre cuando la capa de Tareas está montada.
  const [pendingTask, setPendingTask] = useState<PendingTask | null>(null);
  const canCreateTask = !!tasks && tasks.canEdit; // @plantilla-quitar(tareas)
  // @plantilla-sin(tareas): const canCreateTask = false;
  function openMeeting(slot: { date: string; startMinutes: number; durationMinutes: number; hostUserId?: string | null }) {
    setManualSlot({ date: slot.date, time: wallTimeOfMinutes(slot.startMinutes), durationMinutes: slot.durationMinutes, hostUserId: slot.hostUserId ?? null });
    setManualOpen(true);
  }
  function openTask(slot: { date: string; startMinutes: number; durationMinutes: number }) {
    setPendingTask({ date: slot.date, time: wallTimeOfMinutes(slot.startMinutes), minutes: slot.durationMinutes });
    // Con la capa de Tareas apagada se prende en «Mías», para ver la tarea al guardarla.
    if (tasks && tasks.mode === "off") setParam("tareas", "1"); // @plantilla-quitar(tareas)
  }
  const canCreateGoogle = googleOn && (google?.calendars ?? []).some((c) => c.writable);
  const overlapsBooking = (startUtc: string, minutes: number) => {
    const s0 = Date.parse(startUtc);
    const e0 = s0 + minutes * 60_000;
    return items.some((b) => groupOf(b.status) === "active" && Date.parse(b.startAt) < e0 && Date.parse(b.endAt) > s0);
  };
  const googleNote = !google?.on
    ? null
    : google.error
      ? "No pude leer tu Google Calendar"
      : google.nothingToShow
        ? "Prendé «Mostrar en Agenda» en Ajustes de calendarios"
        : !google.syncedAt
          ? "Leyendo tu Google Calendar…"
          : null;

  // Se vuelve a pedir al abrir otra reunión y cada vez que la página trae datos
  // nuevos (`items` cambia después de un `router.refresh()` de una acción).
  useEffect(() => {
    if (!openId) return;
    let alive = true;
    loadBookingDetail(openId)
      .then((data) => {
        if (alive) setLoaded({ id: openId, data });
      })
      .catch(() => {
        if (alive) setLoaded({ id: openId, data: null });
      });
    return () => {
      alive = false;
    };
  }, [openId, items]);

  function move(id: string, status: BookingStatus) {
    setError(null);
    start(async () => {
      const result = await changeBookingStatus({ bookingId: id, status });
      if (!result.ok) setError(result.error);
      else router.refresh();
    });
  }

  function confirmCancel() {
    if (!cancelDrop) return;
    setError(null);
    start(async () => {
      const result = await cancelBookingAsHost({ bookingId: cancelDrop.id, status: cancelDrop.status, reason });
      if (!result.ok) setError(result.error);
      else {
        setCancelDrop(null);
        setReason("");
        router.refresh();
      }
    });
  }

  const pages = Math.max(1, Math.ceil(total / 50));
  // "Todavía no hay NINGUNA agenda" (en todo el workspace) es un cartel
  // distinto de "ninguna con estos filtros" (F33, Agenda v2).
  const isEmpty = items.length === 0 && view !== "calendar";
  const isEmptyWorkspace = isEmpty && !hasEverBooked;

  return (
    <div className="flex h-full min-h-0 flex-col">
      <PageHeader
        route="/dashboard/agenda"
        filtersBreakpoint="wide"
        // `view` y no `left` (Servicios A2, F131): sin lugar, baja a la franja con los filtros en vez de dejar
        // «Agendar» y la configuracion fuera de la pantalla (pasaba a 390 y a 768 px).
        view={
          <ViewToggle
            value={shownView}
            options={VIEWS}
            onChange={(next) => {
              setClicked(next);
              setParam("vista", next === "list" ? null : next);
            }}
          />
        }
        right={
          <div className="flex shrink-0 items-center gap-2">
            <ShareLinksMenu events={shareableEvents} />
            {canManage && (
              <button
                type="button"
                onClick={() => setManualOpen(true)}
                aria-label="Agendar una reunión"
                className="inline-flex h-9 shrink-0 items-center gap-1.5 whitespace-nowrap rounded-lg bg-primary px-2.5 text-sm font-medium text-primary-foreground hover:opacity-90 sm:px-3"
              >
                <Plus className="h-4 w-4" aria-hidden />
                {/* En el telefono, solo el "+": la barra tiene que dejar lugar al titulo y a la campana. */}
                <span className="hidden sm:inline">Agendar</span>
              </button>
            )}
            {showConfig && (
              <Tip asChild content={`Configuración de agenda · hora de ${timezoneCityLabel(timezone)} (${gmtOffsetLabel(now, timezone)})`}>
                <Link
                  href={DEFAULT_CONFIG_SECTION.href}
                  aria-label={`Configuración de agenda. Hora de ${timezoneCityLabel(timezone)} (${gmtOffsetLabel(now, timezone)})`}
                  className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-border text-muted-foreground hover:bg-muted hover:text-foreground"
                >
                  <Settings className="h-4 w-4" />
                </Link>
              </Tip>
            )}
          </div>
        }
        filters={
          <>

            {view !== "calendar" && (
              <PeriodPopover
                preset={period}
                presets={AGENDA_PERIODS}
                labels={AGENDA_PERIOD_LABELS}
                from={customRange?.from ?? null}
                to={customRange?.to ?? null}
                timezone={timezone}
                allowFuture
                onApply={setPeriod}
              />
            )}

            <AgendaFiltersMenu
              filters={filters}
              categories={categories}
              events={eventOptions}
              hosts={scopeAll ? hostOptions : null}
              utmOptions={utmOptions}
              quick={{ value: quick, options: QUICK_PICK_ORDER.map((key) => ({ key, label: QUICK_PICK_LABELS[key], count: counts[key] })) }}
            />

            {view === "list" && (
              // En el celular la lista son tarjetas: no hay columnas que elegir.
              <div className="hidden md:block">
                <ColumnsMenu state={columns} />
              </div>
            )}

            <ExpandableSearch
              value={search}
              onCommit={(next) => setParam("q", next || null)}
              label="Buscar contacto"
              placeholder="Buscar contacto"
              hint={agendaSearchHint({ view, period, customRange, timezone })}
              hintAlign="right"
            />
          </>
        }
      />
      {/* Mientras el servidor trae los datos de un filtro o una vista nueva, una barra arriba lo dice: antes no se veía nada y parecía colgado. */}
      <div aria-hidden className={`h-0.5 w-full overflow-hidden ${navigating ? "" : "invisible"}`}>
        <div className="h-full w-1/3 animate-[agenda-loading_1s_ease-in-out_infinite] bg-primary" />
      </div>
      {navigating && <span className="sr-only" role="status">Cargando…</span>}
      <ReconnectBanner accounts={brokenAccounts} />
      {noGoogle && <NoGoogleNotice state="none" />}
      <AgendaFilterSummary filters={filters} catalog={catalog} />

      {/* El calendario y, al lado, el panel abierto (en el teléfono el panel va encima, a pantalla completa). */}
      <div className="flex min-h-0 flex-1">
      <div className="flex min-h-0 min-w-0 flex-1 flex-col gap-3 overflow-y-auto px-4 pb-6 pt-3 md:px-6">
        {needsProfile && (
          <p className="rounded-xl border border-border bg-muted/50 p-3 text-sm">
            Todavía no configuraste tu agenda.{" "}
            <Link href="/dashboard/agenda/configuracion/ajustes" className="text-primary-ink underline">
              Empezá por acá
            </Link>
            .
          </p>
        )}

        {error && (
          <p role="alert" className="rounded-lg border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive">
            {error}
          </p>
        )}

        {isEmptyWorkspace ? (
          <AgendaEmptyWorkspace events={shareableEvents} hasCalendar={hasCalendar} canManage={canManage} onBookManually={() => setManualOpen(true)} />
        ) : isEmpty ? (
          <AgendaEmptyFiltered onClearFilters={clearAll} onShowAll={() => setPeriod({ preset: "todo", from: null, to: null })} />
        ) : view === "list" ? (
          <>
            <BookingsList
              items={items}
              hostNames={hostNames}
              timezone={timezone}
              timeFormat={timeFormat}
              now={now}
              metaLinks={metaLinks}
              lastTouches={lastTouches}
              prefs={columns}
              canManage={canManage}
              busy={pending}
              onOpen={openDetail}
              onMove={move}
              onCancelDrop={(id, status) => setCancelDrop({ id, status })}
            />
            {pages > 1 && (
              <div className="flex items-center justify-between text-xs text-muted-foreground">
                <span>
                  {total} agendas · página {page} de {pages}
                </span>
                <span className="flex gap-2">
                  <button
                    type="button"
                    disabled={page <= 1}
                    onClick={() => setParam("pagina", String(page - 1), { keepPage: true })}
                    className="rounded-lg border border-border px-2 py-1 disabled:opacity-40"
                  >
                    Anterior
                  </button>
                  <button
                    type="button"
                    disabled={page >= pages}
                    onClick={() => setParam("pagina", String(page + 1), { keepPage: true })}
                    className="rounded-lg border border-border px-2 py-1 disabled:opacity-40"
                  >
                    Siguiente
                  </button>
                </span>
              </div>
            )}
          </>
        ) : view === "kanban" ? (
          <BookingsKanban
            items={items}
            timezone={timezone}
            timeFormat={timeFormat}
            now={now}
            canManage={canManage}
            busy={pending}
            onOpen={openDetail}
            onMove={move}
            onCancelDrop={(id, status) => setCancelDrop({ id, status })}
          />
        ) : (
          <CalendarWithTasks
            tasks={tasks}
            pendingTask={pendingTask}
            onPendingTaskUsed={() => setPendingTask(null)}
            viewerTimeZone={timezone}
            calendar={
              <BookingsCalendar
                items={items}
                hostNames={hostNames}
                timezone={timezone}
                timeFormat={timeFormat}
                view={calendarView}
                anchor={calendarAnchor}
                onView={(v) => setParam("cal", v)}
                onAnchor={(d) => setParam("dia", d)}
                onOpen={openDetail}
                taskControls={tasks ? { mode: tasks.mode, onMode: (m) => setParam("tareas", tasksModeParam(m)) } : undefined} // @plantilla-quitar(tareas)
                canDragBookings={canManage}
                onDropBooking={reschedule.onDrop}
                onResizeBooking={canManage ? reschedule.onResize : undefined}
                onCreateRange={
                  canManage || canCreateGoogle || canCreateTask
                    ? (date, startMinutes, durationMinutes, hostUserId) => {
                        const slot = { date, startMinutes, durationMinutes, hostUserId };
                        // En la columna de otra persona (vista de equipo) solo se le agenda una reunión.
                        if (hostUserId && hostUserId !== viewerId) {
                          if (canManage) openMeeting(slot);
                          return;
                        }
                        // Con más de una opción, se elige qué crear; con una sola, directo a esa.
                        const options = [canManage, canCreateTask, canCreateGoogle].filter(Boolean).length;
                        if (options > 1) return setCreateChoice(slot);
                        if (canManage) return openMeeting(slot);
                        if (canCreateTask) return openTask(slot);
                        setGoogleCreate(slot);
                      }
                    : undefined
                }
                ghost={reschedule.ghost}
                team={team ? { selfId: viewerId, people: team } : undefined}
                teamControls={
                  canSeeTeam && calendarView === "day"
                    ? { on: !!team, onToggle: (on) => setTeamLayout(on) }
                    : undefined
                }
                includeCancelled={showsCancelled(filters.statuses as BookingStatus[])}
                showMenu={
                  <CalendarShowMenu
                    statuses={filters.statuses as BookingStatus[]}
                    meetingsShown={meetingsShown}
                    onStatuses={(next) => setParams(statusParams(next))}
                    onMeetings={(on) => setParams(on ? { reuniones: null } : { reuniones: "0", estado: null })}
                    tasks={tasks ? { mode: tasks.mode, onMode: (m) => setParam("tareas", tasksModeParam(m)) } : undefined} // @plantilla-quitar(tareas)
                    google={google ? { on: google.on, onToggle: (on) => setParam("google", googleLayerParam(on)) } : undefined}
                  />
                }
                google={
                  google
                    ? {
                        on: google.on,
                        onToggle: (on) => setParam("google", googleLayerParam(on)),
                        events: google.events,
                        busy: google.busy,
                        refreshing,
                        onRefresh: () => refreshGoogle(true),
                        note: googleNote,
                        onOpen: openGoogle,
                        onDrop: (event, startUtc) => setGoogleMove({ event, startUtc, durationMinutes: durationMinutesOf(event) }),
                        onResize: (event, durationMinutes) => setGoogleMove({ event, startUtc: event.startAt, durationMinutes }),
                      }
                    : undefined
                }
              />
            }
            timeFormat={timeFormat}
          />
        )}
      </div>
        {openId && !detail && <BookingDetailSkeleton missing={detailMissing} onClose={closeDetail} />}

        {openId && detail && (
          <BookingDetailPanel
            key={detail.id}
            booking={detail}
            canLinkMeta={canLinkMeta}
            canEditContact={canEditContact}
            categories={categories}
            timezone={timezone}
            timeFormat={timeFormat}
            canManage={canManage}
            canDelete={canDelete}
            canReassign={canReassign}
            hostOptions={reassignHostOptions.filter((h) => h.userId !== detail.hostUserId)}
            onClose={closeDetail}
          />
        )}

        {gcalId && gcalEvent && (
          <GoogleEventPanel
            key={`${gcalEvent.id}:${gcalEvent.etag ?? ""}:${gcalEvent.startAt}:${gcalEvent.endAt}`}
            event={gcalEvent}
            timezone={timezone}
            timeFormat={timeFormat}
            onClose={closeGoogle}
            onChanged={() => router.refresh()}
            onRefresh={() => refreshGoogle(true)}
            importSlot={
              canManage && !gcalEvent.allDay ? (
                <button type="button" onClick={() => setGoogleImport(gcalEvent)} className="inline-flex items-center gap-1.5 rounded-lg bg-primary px-3 py-1.5 text-sm font-semibold text-primary-foreground">
                  Pasar al sistema
                </button>
              ) : undefined
            }
          />
        )}
      </div>

      {reschedule.dialog}

      {cancelDrop && (
        <div className="fixed inset-0 z-50 grid place-items-center bg-black/40 p-4" onClick={() => setCancelDrop(null)}>
          <div role="dialog" aria-modal="true" aria-label="Cancelar la agenda" onClick={(e) => e.stopPropagation()} className="w-full max-w-sm rounded-2xl border border-border bg-card p-4">
            <p className="font-medium">Cancelar la agenda</p>
            <p className="mt-1 text-sm text-muted-foreground">Es definitivo. El evento se borra del calendario y Google le avisa al invitado.</p>
            <label htmlFor="drop-reason" className="mt-3 block text-xs text-muted-foreground">
              Motivo (opcional)
            </label>
            <textarea id="drop-reason" value={reason} onChange={(e) => setReason(e.target.value)} rows={2} className="mt-1 w-full rounded-lg border border-input bg-background px-3 py-2 text-sm" />
            <div className="mt-3 flex justify-end gap-2">
              <button type="button" onClick={() => setCancelDrop(null)} className="rounded-lg border border-border px-3 py-1.5 text-sm hover:bg-muted">
                Volver
              </button>
              <button type="button" disabled={pending} onClick={confirmCancel} className="rounded-lg bg-destructive px-3 py-1.5 text-sm font-semibold text-white disabled:opacity-60">
                {pending ? "Cancelando…" : "Sí, cancelar"}
              </button>
            </div>
          </div>
        </div>
      )}

      {googleImport && (
        <GoogleImportDialog
          event={googleImport}
          categories={categories}
          ownEvents={events.filter((e) => e.hostUserId === viewerId && e.status !== "inactive").map((e) => ({ id: e.id, title: e.title }))}
          searchContacts={async (term) => (await searchContactsForBooking(term)).map((c) => ({ id: c.id, name: c.name, detail: c.detail }))}
          onClose={() => setGoogleImport(null)}
          onImported={(bookingId) => {
            setGoogleImport(null);
            closeGoogle();
            router.refresh();
            openDetail(bookingId);
          }}
        />
      )}

      {googleMove && (
        <GoogleMoveDialog
          event={googleMove.event}
          startUtc={googleMove.startUtc}
          durationMinutes={googleMove.durationMinutes}
          timezone={timezone}
          timeFormat={timeFormat}
          overlapsBooking={overlapsBooking(googleMove.startUtc, googleMove.durationMinutes)}
          onClose={() => setGoogleMove(null)}
          onDone={() => {
            setGoogleMove(null);
            router.refresh();
          }}
          onRefresh={() => {
            setGoogleMove(null);
            refreshGoogle(true);
          }}
        />
      )}

      {createChoice && (
        <CreateChoiceDialog
          label={slotLabel(createChoice)}
          onClose={() => setCreateChoice(null)}
          onMeeting={
            canManage
              ? () => {
                  openMeeting(createChoice);
                  setCreateChoice(null);
                }
              : undefined
          }
          onTask={
            canCreateTask
              ? () => {
                  openTask(createChoice);
                  setCreateChoice(null);
                }
              : undefined
          }
          onGoogle={
            canCreateGoogle
              ? () => {
                  setGoogleCreate(createChoice);
                  setCreateChoice(null);
                }
              : undefined
          }
        />
      )}

      {googleCreate && google && (
        <GoogleCreateDialog
          calendars={google.calendars}
          initial={googleCreate}
          timezone={timezone}
          onClose={() => setGoogleCreate(null)}
          onCreated={(id) => {
            setGoogleCreate(null);
            router.refresh();
            if (id) openGoogle(id);
          }}
        />
      )}

      {manualOpen && (
        <BookManualDialog
          events={events}
          timezone={timezone}
          timeFormat={timeFormat}
          initialSlot={manualSlot}
          onClose={() => {
            setManualOpen(false);
            setManualSlot(null);
          }}
          onCreated={(bookingId) => {
            router.refresh();
            openDetail(bookingId);
          }}
          searchContacts={(term) => searchContactsForBooking(term)}
          hosts={manualHosts}
          currentUserId={viewerId}
          areas={manualAreas}
          confirmationConfigs={confirmationConfigs}
        />
      )}
    </div>
  );
}


/**
 * El calendario con el anfitrion de tareas (el drawer, las acciones y las tareas en pantalla) cuando hay tareas que mostrar.
 * Con el interruptor apagado (o sin permiso) devuelve el calendario tal cual: no monta nada de tareas.
 */
function CalendarWithTasks({
  tasks,
  calendar,
  timeFormat,
  pendingTask,
  onPendingTaskUsed,
  viewerTimeZone,
}: {
  tasks?: AgendaTasksProps;
  calendar: React.ReactNode;
  timeFormat: "12h" | "24h";
  pendingTask: PendingTask | null;
  onPendingTaskUsed: () => void;
  viewerTimeZone: string;
}) {
  // @plantilla-desde(tareas)
  if (!tasks || tasks.mode === "off") return <>{calendar}</>;
  return (
    <TaskWorkbench
      syncUrl
      initialTasks={tasks.rows}
      members={tasks.members}
      currentUserId={tasks.currentUserId}
      today={tasks.today}
      timeZone={tasks.workspaceTimeZone}
      timeFormat={timeFormat}
      canEdit={tasks.canEdit}
      canDelete={tasks.canDelete}
    >
      {calendar}
      {pendingTask && <PendingTaskStarter task={pendingTask} workspaceTz={tasks.workspaceTimeZone} viewerTz={viewerTimeZone} onUsed={onPendingTaskUsed} />}
    </TaskWorkbench>
  );
  // @plantilla-hasta(tareas)
  // @plantilla-sin(tareas): void pendingTask; void onPendingTaskUsed; void viewerTimeZone; return <>{calendar}</>;
}

// @plantilla-desde(tareas)
/** Abre UNA vez la tarea nueva pedida desde el calendario, con su día, hora y duración (en la zona del negocio). */
function PendingTaskStarter({ task, workspaceTz, viewerTz, onUsed }: { task: PendingTask; workspaceTz: string; viewerTz: string; onUsed: () => void }) {
  const wb = useTaskWorkbench();
  const used = useRef(false);
  useEffect(() => {
    if (used.current) return;
    used.current = true;
    const stored = dueToStored({ date: task.date, time: task.time }, workspaceTz, viewerTz);
    wb.startCreate({ due_date: stored.due_date, due_time: stored.due_time, duration_minutes: task.minutes });
    onUsed();
  }, [wb, task, workspaceTz, viewerTz, onUsed]);
  return null;
}
// @plantilla-hasta(tareas)

/** Una tarea pedida desde «¿Qué querés crear?»: día y hora en la zona de quien mira. */
interface PendingTask {
  date: string;
  time: string;
  minutes: number;
}

/** «Martes, 24 de noviembre · 10:30»: el día y la hora del hueco, tal como se ven en el calendario (fecha civil). */
function slotLabel(slot: { date: string; startMinutes: number }): string {
  const day = new Intl.DateTimeFormat("es", { weekday: "long", day: "numeric", month: "long", timeZone: "UTC" }).format(new Date(`${slot.date}T12:00:00Z`));
  return `${day.charAt(0).toUpperCase()}${day.slice(1)} · ${wallTimeOfMinutes(slot.startMinutes)}`;
}
