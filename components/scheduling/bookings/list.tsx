"use client";

/**
 * La lista de agendas (F33). Una fila por agenda; se abre el detalle al
 * hacer clic EN CUALQUIER PARTE de la fila, salvo en el estado: ahi el clic
 * abre el menu para cambiarlo. En el celular la tabla pasa a tarjetas: siete
 * columnas en 390 px no se comprimen, se rompen.
 *
 * Las columnas se ajustan arrastrando el borde del encabezado (doble clic o
 * Inicio = ancho normal; con el teclado, flechas izquierda y derecha). Cuales
 * columnas de atribucion se ven lo elige el boton «Columnas» de la barra de
 * arriba, que vive en la pantalla (`useAgendaColumns`).
 */

import { useRef, useState } from "react";
import { ColumnCell } from "@/components/attribution/column-cell";
import { LAST_CLICK_COLUMN_KEY, originSummary, type AttributionCellSource, type ColumnDef } from "@/lib/attribution/columns";
import { LastClickCell } from "@/components/attribution/last-click";
import { metaLinkLine, type MetaLink } from "@/lib/attribution/meta-link";
import { lastClickLine, type BookingTouchView } from "@/lib/attribution/last-touches";
import type { BookingListItem } from "@/lib/scheduling/data/bookings";
import type { BookingStatus } from "@/lib/scheduling/types";
import { needsOutcome } from "@/lib/scheduling/bookings-view";
import { needsCancelModal } from "@/lib/scheduling/kanban";
import { ORIGIN_LABELS } from "@/lib/scheduling/agenda-filters";
import { capitalize, formatDateTimeWithZone } from "@/lib/scheduling/booker/format";
import { BASE_COLUMN_KEYS, columnWidth, totalWidth, type BaseColumnKey, type ColumnWidths } from "@/lib/scheduling/list-columns";
import { ResizeHandle } from "@/components/ui/data-table/resize-handle";
import { NeedsOutcomeChip, SlotReleasedChip, StatusChip } from "./status-chip";
import { StatusMenu } from "./status-menu";
import { MeetJoinLink } from "./meet-join-link";

const NO_NAMES = { campaign: null, adset: null, ad: null };

const BASE_LABELS: Record<BaseColumnKey, string> = {
  when: "Fecha y hora",
  contact: "Contacto",
  event: "Evento",
  category: "Categoría",
  host: "Anfitrión",
  status: "Estado",
  origin: "Origen",
};

function categoryText(item: BookingListItem): string {
  const snap = item.categorySnapshot as { area_name?: string | null; type_name?: string | null } | null;
  if (!snap?.area_name) return "—";
  return snap.type_name ? `${snap.area_name} · ${snap.type_name}` : snap.area_name;
}

/** Lo que la lista necesita saber de las columnas: cuales se ven y cuanto miden (viene de `useAgendaColumns`). */
export interface AgendaListColumns {
  visible: readonly ColumnDef<AttributionCellSource>[];
  widths: ColumnWidths;
  setWidth: (key: string, px: number) => void;
  resetWidth: (key: string) => void;
}

export function BookingsList({
  items,
  hostNames,
  timezone,
  timeFormat,
  now,
  metaLinks,
  lastTouches,
  columns,
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
  columns: AgendaListColumns;
  /** Quien puede cambiar estados: el chip de estado abre su menu. */
  canManage: boolean;
  /** Se esta guardando un cambio de estado. */
  busy?: boolean;
  onOpen: (id: string) => void;
  onMove: (id: string, status: BookingStatus) => void;
  /** Elegir una cancelación pide el motivo antes de hacer nada. */
  onCancelDrop: (id: string, status: BookingStatus) => void;
}) {
  // El ancho de la columna que se esta arrastrando, en vivo; al soltar se guarda.
  const [live, setLive] = useState<{ key: string; width: number } | null>(null);
  const { visible, widths } = columns;

  const cellSource = (item: BookingListItem): AttributionCellSource => {
    const link = metaLinks[item.id];
    return { attribution: item.attribution, lastClick: lastTouches[item.id], metaNames: link?.names ?? NO_NAMES, metaStatus: link ? (link.inherited ? `${link.statusLabel} · toque anterior` : link.statusLabel) : "" };
  };

  const widthOf = (key: string) => (live?.key === key ? live.width : columnWidth(key, widths));
  const allKeys = [...BASE_COLUMN_KEYS, ...visible.map((def) => def.key)];
  const tableWidth = totalWidth(allKeys, widths, live);

  function changeStatus(item: BookingListItem, to: BookingStatus) {
    if (needsCancelModal(to)) onCancelDrop(item.id, to);
    else onMove(item.id, to);
  }

  if (items.length === 0) {
    return <p className="rounded-xl border border-border p-8 text-center text-sm text-muted-foreground">Nada por acá con estos filtros.</p>;
  }

  const handle = (key: string, label: string) => (
    <ResizeHandle
      label={label}
      width={widthOf(key)}
      onLive={(px) => setLive(px === null ? null : { key, width: px })}
      onCommit={(px) => {
        columns.setWidth(key, px);
        setLive(null);
      }}
      onReset={() => {
        columns.resetWidth(key);
        setLive(null);
      }}
    />
  );

  // Sin `overflow-hidden`: el borde que se arrastra sobresale medio pixel del encabezado y se recortaría. El texto se corta solo (`truncate`).
  const th = "relative px-4 py-2 font-medium";

  return (
    <div className="rounded-xl border border-border">
      {/* Escritorio */}
      <div className="hidden overflow-x-auto md:block">
        {/* Anchos fijos por columna (`<col>`); la columna vacía del final se lleva el espacio que sobra. */}
        <table className="text-left text-sm" style={{ tableLayout: "fixed", width: "100%", minWidth: tableWidth }}>
          <colgroup>
            {allKeys.map((key) => (
              <col key={key} style={{ width: widthOf(key) }} />
            ))}
            <col />
          </colgroup>
          <thead className="border-b border-border text-xs uppercase tracking-wide text-muted-foreground">
            <tr>
              {BASE_COLUMN_KEYS.map((key) => (
                <th
                  key={key}
                  // Fijo al desplazar: con tantas columnas, si no se pierde de quién es cada fila.
                  className={key === "contact" ? "sticky left-0 z-10 border-r border-border bg-background px-4 py-2 font-medium" : th}
                >
                  <span className="block truncate">{BASE_LABELS[key]}</span>
                  {handle(key, BASE_LABELS[key])}
                </th>
              ))}
              {visible.map((def) => (
                <th key={def.key} title={def.hint} className={th}>
                  <span className="block truncate">{def.label}</span>
                  {handle(def.key, def.label)}
                </th>
              ))}
              <th aria-hidden className="p-0" />
            </tr>
          </thead>
          <tbody>
            {items.map((item) => (
              <tr
                key={item.id}
                tabIndex={0}
                role="button"
                onClick={() => onOpen(item.id)}
                onKeyDown={(e) => {
                  if (e.target !== e.currentTarget) return;
                  if (e.key === "Enter" || e.key === " ") {
                    e.preventDefault();
                    onOpen(item.id);
                  }
                }}
                className="group cursor-pointer border-b border-border last:border-0 hover:bg-muted/60 focus:bg-muted focus:outline-none"
              >
                <td className="px-4 py-2.5 tabular-nums">{capitalize(formatDateTimeWithZone(item.startAt, timezone, timeFormat))}</td>
                <td className="sticky left-0 z-10 truncate border-r border-border bg-background px-4 py-2.5 group-hover:bg-[color-mix(in_oklab,var(--muted)_60%,var(--background))]">
                  {item.contactName || item.bookerName || "Sin nombre"}
                </td>
                <td className="px-4 py-2.5">
                  <span className="flex items-center gap-2">
                    <span aria-hidden className="h-2 w-2 shrink-0 rounded-full" style={{ background: item.eventColor ?? "var(--muted-foreground)" }} />
                    <span className="min-w-0 flex-1 truncate" title={item.title}>
                      {item.title}
                    </span>
                    <MeetJoinLink meetUrl={item.meetUrl} status={item.status} />
                  </span>
                </td>
                <td className="truncate px-4 py-2.5 text-muted-foreground" title={categoryText(item)}>
                  {categoryText(item)}
                </td>
                <td className="truncate px-4 py-2.5 text-muted-foreground">{hostNames[item.hostUserId] ?? "—"}</td>
                <td className="px-4 py-2.5">
                  <span className="flex flex-wrap items-center gap-1.5">
                    <StatusMenu status={item.status} startAt={item.startAt} now={now} canChange={canManage} busy={busy} onSelect={(to) => changeStatus(item, to)} />
                    {needsOutcome({ status: item.status, end_at: item.endAt }, now) && (
                      <StatusMenu status={item.status} startAt={item.startAt} now={now} canChange={canManage} busy={busy} variant="needs_outcome" onSelect={(to) => changeStatus(item, to)} />
                    )}
                    {item.slotReleasedAt && <SlotReleasedChip />}
                  </span>
                </td>
                <td className="truncate px-4 py-2.5 text-muted-foreground">{ORIGIN_LABELS[item.origin as keyof typeof ORIGIN_LABELS] ?? item.origin}</td>
                {visible.map((def) =>
                  def.key === LAST_CLICK_COLUMN_KEY ? (
                    <LastClickCell key={def.key} touches={lastTouches[item.id]} />
                  ) : (
                    <ColumnCell key={def.key} def={def} row={cellSource(item)} />
                  ),
                )}
                <td aria-hidden className="p-0" />
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Celular */}
      <ul className="divide-y divide-border md:hidden">
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
    </div>
  );
}
