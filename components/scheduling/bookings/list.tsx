"use client";

/**
 * La lista de agendas (F33), con la tabla común (`DataTable`, docs/tablas.md). Una fila por agenda; se abre el detalle al
 * hacer clic EN CUALQUIER PARTE de la fila, salvo en el estado: ahí el clic abre el menú para cambiarlo. En el celular la
 * tabla pasa a tarjetas: siete columnas en 390 px no se comprimen, se rompen.
 *
 * Qué columnas se ven, en qué orden, cuáles quedan fijas y cuánto mide cada una lo decide `prefs` (`useTablePrefs`), que
 * comparte la pantalla con el botón «Columnas» de la barra de arriba. El catálogo es `lib/scheduling/agenda-columns.ts`.
 */

import { useMemo, type ReactNode } from "react";
import { ColumnCellContent } from "@/components/attribution/column-cell";
import { LAST_CLICK_COLUMN_KEY, originSummary, type AttributionCellSource } from "@/lib/attribution/columns";
import { LastClickContent } from "@/components/attribution/last-click";
import { metaLinkLine, type MetaLink } from "@/lib/attribution/meta-link";
import { lastClickLine, type BookingTouchView } from "@/lib/attribution/last-touches";
import type { BookingListItem } from "@/lib/scheduling/data/bookings";
import type { BookingStatus } from "@/lib/scheduling/types";
import { needsOutcome } from "@/lib/scheduling/bookings-view";
import { needsCancelModal } from "@/lib/scheduling/kanban";
import { ORIGIN_LABELS } from "@/lib/scheduling/agenda-filters";
import { capitalize, formatDateTimeWithZone } from "@/lib/scheduling/booker/format";
import { AGENDA_BASE_COLUMNS, agendaAttributionColumns } from "@/lib/scheduling/agenda-columns";
import { DataTable, type DataColumn } from "@/components/ui/data-table/data-table";
import type { TablePrefsState } from "@/components/ui/data-table/use-table-prefs";
import { NeedsOutcomeChip, SlotReleasedChip, StatusChip } from "./status-chip";
import { StatusMenu } from "./status-menu";
import { MeetJoinLink } from "./meet-join-link";

const NO_NAMES = { campaign: null, adset: null, ad: null };

function categoryText(item: BookingListItem): string {
  const snap = item.categorySnapshot as { area_name?: string | null; type_name?: string | null } | null;
  if (!snap?.area_name) return "—";
  return snap.type_name ? `${snap.area_name} · ${snap.type_name}` : snap.area_name;
}

export function BookingsList({
  items,
  hostNames,
  timezone,
  timeFormat,
  now,
  metaLinks,
  lastTouches,
  prefs,
  canManage,
  busy = false,
  onOpen,
  onMove,
  onCancelDrop,
}: {
  items: BookingListItem[];
  hostNames: Record<string, string>;
  timezone: string;
  timeFormat: "12h" | "24h";
  now: Date;
  /** El vínculo con Meta de cada reunión de la página. */
  metaLinks: Record<string, MetaLink>;
  lastTouches: Record<string, BookingTouchView[]>;
  /** Las columnas elegidas (las mismas que muestra el botón «Columnas» de la barra). */
  prefs: TablePrefsState;
  /** Quien puede cambiar estados: el chip de estado abre su menu. */
  canManage: boolean;
  /** Se esta guardando un cambio de estado. */
  busy?: boolean;
  onOpen: (id: string) => void;
  onMove: (id: string, status: BookingStatus) => void;
  /** Elegir una cancelación pide el motivo antes de hacer nada. */
  onCancelDrop: (id: string, status: BookingStatus) => void;
}) {
  const columns = useMemo<DataColumn<BookingListItem>[]>(() => {
    const cellSource = (item: BookingListItem): AttributionCellSource => {
      const link = metaLinks[item.id];
      return { attribution: item.attribution, lastClick: lastTouches[item.id], metaNames: link?.names ?? NO_NAMES, metaStatus: link ? (link.inherited ? `${link.statusLabel} · toque anterior` : link.statusLabel) : "" };
    };
    const changeStatus = (item: BookingListItem, to: BookingStatus) => {
      if (needsCancelModal(to)) onCancelDrop(item.id, to);
      else onMove(item.id, to);
    };
    const base: Record<string, Pick<DataColumn<BookingListItem>, "render" | "cellClassName">> = {
      when: { cellClassName: "tabular-nums", render: (item) => capitalize(formatDateTimeWithZone(item.startAt, timezone, timeFormat)) },
      contact: { render: (item) => item.contactName || item.bookerName || "Sin nombre" },
      event: {
        render: (item) => (
          <span className="flex items-center gap-2">
            <span aria-hidden className="h-2 w-2 shrink-0 rounded-full" style={{ background: item.eventColor ?? "var(--muted-foreground)" }} />
            <span className="min-w-0 flex-1 truncate" title={item.title}>
              {item.title}
            </span>
            <MeetJoinLink meetUrl={item.meetUrl} status={item.status} />
          </span>
        ),
      },
      category: { cellClassName: "text-muted-foreground", render: (item) => <span title={categoryText(item)}>{categoryText(item)}</span> },
      host: { cellClassName: "text-muted-foreground", render: (item) => hostNames[item.hostUserId] ?? "—" },
      status: {
        render: (item) => (
          <span className="flex flex-wrap items-center gap-1.5">
            <StatusMenu status={item.status} startAt={item.startAt} now={now} canChange={canManage} busy={busy} onSelect={(to) => changeStatus(item, to)} />
            {needsOutcome({ status: item.status, end_at: item.endAt }, now) && (
              <StatusMenu status={item.status} startAt={item.startAt} now={now} canChange={canManage} busy={busy} variant="needs_outcome" onSelect={(to) => changeStatus(item, to)} />
            )}
            {item.slotReleasedAt && <SlotReleasedChip />}
          </span>
        ),
      },
      origin: { cellClassName: "text-muted-foreground", render: (item) => ORIGIN_LABELS[item.origin as keyof typeof ORIGIN_LABELS] ?? item.origin },
    };
    const baseColumns = AGENDA_BASE_COLUMNS.map((meta): DataColumn<BookingListItem> => ({ ...meta, ...base[meta.key] }));
    const attribution = agendaAttributionColumns().map(
      ({ def, ...meta }): DataColumn<BookingListItem> => ({
        ...meta,
        render: (item): ReactNode => (def.key === LAST_CLICK_COLUMN_KEY ? <LastClickContent touches={lastTouches[item.id]} /> : <ColumnCellContent def={def} row={cellSource(item)} />),
      }),
    );
    return [...baseColumns, ...attribution];
  }, [hostNames, timezone, timeFormat, now, metaLinks, lastTouches, canManage, busy, onMove, onCancelDrop]);

  return (
    <>
      <DataTable className="hidden md:block" columns={columns} rows={items} rowKey={(item) => item.id} state={prefs} caption="Agendas" onRowClick={(item) => onOpen(item.id)} />

      {/* Celular */}
      <ul className="divide-y divide-border rounded-xl border border-border md:hidden">
        {items.map((item) => (
          <li key={item.id} className="relative">
            <MeetJoinLink meetUrl={item.meetUrl} status={item.status} className="absolute right-4 top-4 z-10 h-8 w-8" />
            <button type="button" onClick={() => onOpen(item.id)} className="flex w-full flex-col gap-1.5 p-4 text-left hover:bg-muted/60">
              <span className="text-sm font-medium tabular-nums">{capitalize(formatDateTimeWithZone(item.startAt, timezone, timeFormat))}</span>
              <span className="text-sm">{item.contactName || item.bookerName || "Sin nombre"}</span>
              <span className="text-xs text-muted-foreground">
                {item.title} · {categoryText(item)}
              </span>
              <span className="flex flex-wrap items-center gap-1.5">
                <StatusChip status={item.status} />
                {needsOutcome({ status: item.status, end_at: item.endAt }, now) && <NeedsOutcomeChip />}
                {item.slotReleasedAt && <SlotReleasedChip />}
              </span>
              {lastClickLine(lastTouches[item.id]) && (
                <p className="mt-1 text-xs text-muted-foreground">
                  <span className="font-medium text-foreground">Último click:</span> {lastClickLine(lastTouches[item.id])}
                </p>
              )}
              {(metaLinkLine(metaLinks[item.id]) || originSummary(item.attribution)) && (
                <span className="truncate text-xs text-muted-foreground">
                  <span className="font-medium text-foreground">Origen:</span> {metaLinkLine(metaLinks[item.id]) || originSummary(item.attribution)}
                </span>
              )}
            </button>
          </li>
        ))}
      </ul>
    </>
  );
}
