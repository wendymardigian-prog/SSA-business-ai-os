"use client";

/**
 * La pantalla de Agendas (F33 a F37): lista, kanban y calendario sobre los
 * mismos datos, con los filtros arriba.
 *
 * Los filtros viven en la URL: así se comparte un link con lo que uno está
 * mirando y el botón de atrás hace lo que se espera. La vista elegida también.
 */

import { useCallback, useMemo, useState, useTransition } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import { CalendarDays, Settings } from "lucide-react";
import { PageHeader } from "@/components/page-header";
import { ReconnectBanner } from "../reconnect-banner";
import { BookingsList } from "./list";
import { BookingsKanban } from "./kanban-board";
import { BookingsCalendar } from "./calendar-grid";
import { BookingDetailPanel, type BookingDetailData } from "./detail-panel";
import { BookManualDialog, type ManualEventOption } from "./book-manual-dialog";
import type { BookingListItem } from "@/lib/scheduling/data/bookings";
import type { BookingStatus, SlotsByDate } from "@/lib/scheduling/types";
import type { CalendarView } from "@/lib/scheduling/calendar-view";
import type { CategoryRow } from "@/lib/scheduling/categories";
import { categoryTree } from "@/lib/scheduling/categories";
import { QUICK_FILTER_LABELS, type QuickFilter } from "@/lib/scheduling/bookings-view";
import { gmtOffsetLabel, timezoneCityLabel } from "@/lib/scheduling/booker/format";
import { changeBookingStatus, cancelBookingAsHost, searchContactsForBooking, slotsForManualBooking } from "@/lib/actions/scheduling/bookings";

const QUICK_ORDER: QuickFilter[] = ["upcoming", "needs_outcome", "with_outcome", "cancelled"];
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
  detail,
  view,
  quick,
  calendarView,
  calendarAnchor,
  filters,
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
  counts: Record<QuickFilter, number>;
  hostNames: Record<string, string>;
  categories: CategoryRow[];
  events: ManualEventOption[];
  detail: BookingDetailData | null;
  view: "list" | "kanban" | "calendar";
  quick: QuickFilter;
  calendarView: CalendarView;
  calendarAnchor: string;
  filters: { categoryId: string | null; hostUserId: string | null; search: string };
  timezone: string;
  timeFormat: "12h" | "24h";
  scopeAll: boolean;
  canManage: boolean;
  showConfig: boolean;
  brokenAccounts: string[];
  needsProfile: boolean;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const [manualOpen, setManualOpen] = useState(false);
  const [cancelDrop, setCancelDrop] = useState<{ id: string; status: BookingStatus } | null>(null);
  const [reason, setReason] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  const now = useMemo(() => new Date(), []);

  const setParam = useCallback(
    (patch: Record<string, string | null>) => {
      const next = new URLSearchParams(params.toString());
      for (const [key, value] of Object.entries(patch)) {
        if (value === null || value === "") next.delete(key);
        else next.set(key, value);
      }
      // Cambiar de filtro vuelve a la primera página: quedarse en la 3 de una
      // lista que ahora tiene una página es una pantalla vacía sin motivo.
      if (!("pagina" in patch)) next.delete("pagina");
      router.push(`${pathname}?${next.toString()}`);
    },
    [params, pathname, router],
  );

  const openDetail = (id: string) => setParam({ agenda: id });
  const closeDetail = () => setParam({ agenda: null });

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

  return (
    <div className="flex h-full min-h-0 flex-col">
      <PageHeader
        route="/dashboard/agenda"
        right={
          <div className="flex items-center gap-2">
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
      />
      <ReconnectBanner accounts={brokenAccounts} />

      <div className="flex flex-wrap items-center gap-2 px-4 py-2 text-xs text-muted-foreground md:px-6">
        <span className="rounded-full border border-border px-2.5 py-0.5">{scopeAll ? "Todas las agendas del equipo" : "Solo tus agendas"}</span>
        <Link href="/dashboard/agenda/configuracion/ajustes" className="rounded-full border border-border px-2.5 py-0.5 hover:bg-muted">
          Hora de {timezoneCityLabel(timezone)} ({gmtOffsetLabel(now, timezone)})
        </Link>
      </div>

      <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto px-4 pb-6 md:px-6">
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

        {/* Vista y filtros */}
        <div className="flex flex-wrap items-center gap-2">
          <div className="flex rounded-lg border border-border p-0.5" role="group" aria-label="Vista">
            {VIEWS.map((v) => (
              <button
                key={v.key}
                type="button"
                aria-pressed={view === v.key}
                onClick={() => setParam({ vista: v.key === "list" ? null : v.key })}
                className={view === v.key ? "rounded-md bg-primary px-3 py-1 text-xs font-medium text-primary-foreground" : "rounded-md px-3 py-1 text-xs text-muted-foreground hover:bg-muted"}
              >
                {v.label}
              </button>
            ))}
          </div>

          <select
            aria-label="Área o tipo"
            value={filters.categoryId ?? ""}
            onChange={(e) => setParam({ categoria: e.target.value || null })}
            className="h-8 rounded-lg border border-input bg-background px-2 text-xs"
          >
            <option value="">Todas las áreas</option>
            {categoryTree(categories).map(({ area, types }) => (
              <optgroup key={area.id} label={area.name}>
                <option value={area.id}>{area.name} (todo)</option>
                {types.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.name}
                  </option>
                ))}
              </optgroup>
            ))}
          </select>

          {scopeAll && (
            <select
              aria-label="Anfitrión"
              value={filters.hostUserId ?? ""}
              onChange={(e) => setParam({ anfitrion: e.target.value || null })}
              className="h-8 rounded-lg border border-input bg-background px-2 text-xs"
            >
              <option value="">Todos los anfitriones</option>
              {Object.entries(hostNames).map(([id, name]) => (
                <option key={id} value={id}>
                  {name}
                </option>
              ))}
            </select>
          )}

          <input
            defaultValue={filters.search}
            onBlur={(e) => setParam({ q: e.target.value || null })}
            onKeyDown={(e) => {
              if (e.key === "Enter") setParam({ q: (e.target as HTMLInputElement).value || null });
            }}
            placeholder="Buscar contacto"
            aria-label="Buscar contacto"
            className="h-8 w-40 rounded-lg border border-input bg-background px-2 text-xs"
          />
        </div>

        {view === "list" && (
          <div className="flex flex-wrap gap-1.5">
            {QUICK_ORDER.map((key) => (
              <button
                key={key}
                type="button"
                aria-pressed={quick === key}
                onClick={() => setParam({ filtro: key === "upcoming" ? null : key })}
                className={
                  quick === key
                    ? "rounded-full bg-primary px-3 py-1 text-xs font-medium text-primary-foreground"
                    : "rounded-full border border-border px-3 py-1 text-xs text-muted-foreground hover:bg-muted"
                }
              >
                {QUICK_FILTER_LABELS[key]} · <span className="tabular-nums">{counts[key]}</span>
              </button>
            ))}
          </div>
        )}

        {items.length === 0 && view !== "calendar" ? (
          <div className="flex flex-col items-center gap-3 rounded-xl border border-border p-10 text-center">
            <span aria-hidden className="grid h-12 w-12 place-items-center rounded-full bg-muted text-muted-foreground">
              <CalendarDays className="h-6 w-6" />
            </span>
            <h2 className="text-base font-semibold">Todavía no hay agendas</h2>
            <p className="max-w-md text-sm text-muted-foreground">
              Compartí el link de un evento o agendá a mano. Si todavía no conectaste tu Google Calendar, empezá por la configuración.
            </p>
            <div className="flex flex-wrap justify-center gap-2">
              <Link href="/dashboard/agenda/configuracion/calendarios" className="rounded-lg border border-border px-3 py-1.5 text-sm hover:bg-muted">
                Conectar Google Calendar
              </Link>
              {canManage && (
                <button type="button" onClick={() => setManualOpen(true)} className="rounded-lg bg-primary px-3 py-1.5 text-sm font-semibold text-primary-foreground">
                  + Agendar
                </button>
              )}
            </div>
          </div>
        ) : view === "list" ? (
          <>
            <BookingsList items={items} hostNames={hostNames} timezone={timezone} timeFormat={timeFormat} now={now} onOpen={openDetail} />
            {pages > 1 && (
              <div className="flex items-center justify-between text-xs text-muted-foreground">
                <span>
                  {total} agendas · página {page} de {pages}
                </span>
                <span className="flex gap-2">
                  <button type="button" disabled={page <= 1} onClick={() => setParam({ pagina: String(page - 1) })} className="rounded-lg border border-border px-2 py-1 disabled:opacity-40">
                    Anterior
                  </button>
                  <button type="button" disabled={page >= pages} onClick={() => setParam({ pagina: String(page + 1) })} className="rounded-lg border border-border px-2 py-1 disabled:opacity-40">
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
            onView={(v) => setParam({ cal: v })}
            onAnchor={(d) => setParam({ dia: d })}
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
