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

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Settings } from "lucide-react";
import { PageHeader } from "@/components/page-header";
import { ReconnectBanner } from "../reconnect-banner";
import { BookingsList } from "./list";
import { BookingsKanban } from "./kanban-board";
import { BookingsCalendar } from "./calendar-grid";
import { BookingDetailPanel, type BookingDetailData } from "./detail-panel";
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
import { QUICK_FILTER_LABELS, type QuickFilter } from "@/lib/scheduling/bookings-view";
import type { AgendaFilters } from "@/lib/scheduling/agenda-filters";
import { AGENDA_PERIODS, AGENDA_PERIOD_LABELS, type AgendaPeriod } from "@/lib/scheduling/agenda-period";
import { PeriodPopover } from "@/components/dashboards/chat/filters/period-popover";
import { gmtOffsetLabel, timezoneCityLabel } from "@/lib/scheduling/booker/format";
import { changeBookingStatus, cancelBookingAsHost, searchContactsForBooking, slotsForManualBooking } from "@/lib/actions/scheduling/bookings";

/** La pastilla rápida de la lista: los cuatro de siempre, más "Todas" (ahora el default). */
export type QuickPick = QuickFilter | "all";

const QUICK_PICK_LABELS: Record<QuickPick, string> = { all: "Todas", ...QUICK_FILTER_LABELS };
const QUICK_PICK_ORDER: QuickPick[] = ["all", "upcoming", "needs_outcome", "with_outcome", "cancelled"];

const VIEWS: Array<{ key: "list" | "kanban" | "calendar"; label: string }> = [
  { key: "list", label: "Lista" },
  { key: "kanban", label: "Kanban" },
  { key: "calendar", label: "Calendario" },
];

export function BookingsScreen({
  items,
  total,
  page,
  counts,
  hostNames,
  categories,
  events,
  eventOptions,
  shareableEvents,
  hasEverBooked,
  hasCalendar,
  utmOptions,
  detail,
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
  showConfig,
  brokenAccounts,
  needsProfile,
}: {
  items: BookingListItem[];
  total: number;
  page: number;
  counts: Record<QuickPick, number>;
  hostNames: Record<string, string>;
  categories: CategoryRow[];
  events: ManualEventOption[];
  /** Los eventos para el filtro ("Evento"): id y título nomás. */
  eventOptions: Array<{ id: string; title: string }>;
  /** Los eventos activos, para "Compartir" y para el estado vacío del workspace. */
  shareableEvents: ShareableEvent[];
  /** false: el workspace no tiene NINGUNA agenda todavía (sin importar filtros). */
  hasEverBooked: boolean;
  hasCalendar: boolean;
  /** Fuente/medio/campaña que de verdad existen en el workspace, para el grupo "UTM" del widget de filtros. */
  utmOptions: { sources: string[]; mediums: string[]; campaigns: string[] };
  detail: BookingDetailData | null;
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
  showConfig: boolean;
  brokenAccounts: string[];
  needsProfile: boolean;
}) {
  const router = useRouter();
  const { setParam, setPeriod, clearAll } = useAgendaUrl();
  const [manualOpen, setManualOpen] = useState(false);
  const [cancelDrop, setCancelDrop] = useState<{ id: string; status: BookingStatus } | null>(null);
  const [reason, setReason] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  const now = useMemo(() => new Date(), []);
  const hostOptions = useMemo(() => Object.entries(hostNames).map(([userId, label]) => ({ userId, label })).sort((a, b) => a.label.localeCompare(b.label)), [hostNames]);
  const catalog = useMemo(
    () => ({ categories, events: new Map(eventOptions.map((e) => [e.id, e.title])), hosts: new Map(hostOptions.map((h) => [h.userId, h.label])) }),
    [categories, eventOptions, hostOptions],
  );

  const openDetail = (id: string) => setParam("agenda", id);
  const closeDetail = () => setParam("agenda", null);

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
        right={
          <div className="flex items-center gap-2">
            <ShareLinksMenu events={shareableEvents} />
            {canManage && (
              <button
                type="button"
                onClick={() => setManualOpen(true)}
                className="inline-flex h-9 items-center rounded-lg bg-primary px-3 text-sm font-medium text-primary-foreground hover:opacity-90"
              >
                + Agendar
              </button>
            )}
            {showConfig && (
              <Link
                href="/dashboard/agenda/configuracion"
                aria-label="Configuración de agenda"
                title="Configuración de agenda"
                className="flex h-9 w-9 items-center justify-center rounded-lg border border-border text-muted-foreground hover:bg-muted hover:text-foreground"
              >
                <Settings className="h-4 w-4" />
              </Link>
            )}
          </div>
        }
        filters={
          <>
            <div className="flex rounded-lg border border-border p-0.5" role="group" aria-label="Vista">
              {VIEWS.map((v) => (
                <button
                  key={v.key}
                  type="button"
                  aria-pressed={view === v.key}
                  onClick={() => setParam("vista", v.key === "list" ? null : v.key)}
                  className={view === v.key ? "rounded-md bg-primary px-3 py-1 text-xs font-medium text-primary-foreground" : "rounded-md px-3 py-1 text-xs text-muted-foreground hover:bg-muted"}
                >
                  {v.label}
                </button>
              ))}
            </div>

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

            <AgendaFiltersMenu filters={filters} categories={categories} events={eventOptions} hosts={scopeAll ? hostOptions : null} utmOptions={utmOptions} />

            <input
              defaultValue={search}
              onBlur={(e) => setParam("q", e.target.value || null)}
              onKeyDown={(e) => {
                if (e.key === "Enter") setParam("q", (e.target as HTMLInputElement).value || null);
              }}
              placeholder="Buscar contacto"
              aria-label="Buscar contacto"
              className="h-8 w-40 rounded-lg border border-input bg-background px-2 text-xs"
            />

            <Link
              href="/dashboard/agenda/configuracion/ajustes"
              className="flex h-8 items-center whitespace-nowrap rounded-lg border border-border px-2.5 text-xs text-muted-foreground hover:bg-muted"
            >
              {timezoneCityLabel(timezone)} ({gmtOffsetLabel(now, timezone)})
            </Link>
          </>
        }
      />
      <ReconnectBanner accounts={brokenAccounts} />
      <AgendaFilterSummary filters={filters} catalog={catalog} />

      <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto px-4 pb-6 pt-3 md:px-6">
        {needsProfile && (
          <p className="rounded-xl border border-border bg-muted/50 p-3 text-sm">
            Todavía no configuraste tu agenda.{" "}
            <Link href="/dashboard/agenda/configuracion/ajustes" className="text-primary underline">
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

        <div className="flex flex-wrap gap-1.5">
          {QUICK_PICK_ORDER.map((key) => (
            <button
              key={key}
              type="button"
              aria-pressed={quick === key}
              onClick={() => setParam("filtro", key === "all" ? null : key)}
              className={
                quick === key
                  ? "rounded-full bg-primary px-3 py-1 text-xs font-medium text-primary-foreground"
                  : "rounded-full border border-border px-3 py-1 text-xs text-muted-foreground hover:bg-muted"
              }
            >
              {QUICK_PICK_LABELS[key]} · <span className="tabular-nums">{counts[key]}</span>
            </button>
          ))}
        </div>

        {isEmptyWorkspace ? (
          <AgendaEmptyWorkspace events={shareableEvents} hasCalendar={hasCalendar} canManage={canManage} onBookManually={() => setManualOpen(true)} />
        ) : isEmpty ? (
          <AgendaEmptyFiltered onClearFilters={clearAll} onShowAll={() => setPeriod({ preset: "todo", from: null, to: null })} />
        ) : view === "list" ? (
          <>
            <BookingsList items={items} hostNames={hostNames} timezone={timezone} timeFormat={timeFormat} now={now} onOpen={openDetail} />
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
            onOpen={openDetail}
            onMove={move}
            onCancelDrop={(id, status) => setCancelDrop({ id, status })}
          />
        ) : (
          <BookingsCalendar
            items={items}
            timezone={timezone}
            timeFormat={timeFormat}
            view={calendarView}
            anchor={calendarAnchor}
            onView={(v) => setParam("cal", v)}
            onAnchor={(d) => setParam("dia", d)}
            onOpen={openDetail}
          />
        )}
      </div>

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

      {detail && (
        <BookingDetailPanel booking={detail} categories={categories} timezone={timezone} timeFormat={timeFormat} canManage={canManage} onClose={closeDetail} />
      )}

      {manualOpen && (
        <BookManualDialog
          events={events}
          timezone={timezone}
          timeFormat={timeFormat}
          onClose={() => setManualOpen(false)}
          searchContacts={(term) => searchContactsForBooking(term)}
          loadSlots={async (eventId, from, to, ignoreMinimumNotice) =>
            (await slotsForManualBooking({ eventTypeId: eventId, from, to, timezone, ignoreMinimumNotice })) as SlotsByDate
          }
        />
      )}
    </div>
  );
}
