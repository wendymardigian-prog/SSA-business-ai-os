"use client";

/**
 * La lista de agendas (F33). Una fila por agenda; se abre el detalle al
 * hacer clic. En el celular la tabla pasa a tarjetas: siete columnas en 390
 * px no se comprimen, se rompen.
 */

import { useMemo } from "react";
import { ColumnCell } from "@/components/attribution/column-cell";
import { ColumnsMenu, useColumnPrefs } from "@/components/attribution/columns-menu";
import { ATTRIBUTION_COLUMN_GROUPS, attributionColumnDefs, originSummary, type AttributionCellSource } from "@/lib/attribution/columns";
import { metaLinkLine, type MetaLink } from "@/lib/attribution/meta-link";
import type { BookingListItem } from "@/lib/scheduling/data/bookings";
import { needsOutcome } from "@/lib/scheduling/bookings-view";
import { ORIGIN_LABELS } from "@/lib/scheduling/agenda-filters";
import { capitalize, formatDateTimeWithZone } from "@/lib/scheduling/booker/format";
import { NeedsOutcomeChip, SlotReleasedChip, StatusChip } from "./status-chip";
import { MeetJoinLink } from "./meet-join-link";

const COLUMNS_STORAGE_KEY = "agenda-list-columns";
/** Lo que se ve al abrir la lista: es más angosta que la de respuestas, el resto se prende desde «Columnas». */
const DEFAULT_COLUMNS: ReadonlySet<string> = new Set(["attr:utm_source", "attr:utm_campaign", "meta:campaign", "meta:adset", "meta:ad", "meta:status"]);
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
  onOpen,
}: {
  items: BookingListItem[];
  hostNames: Record<string, string>;
  timezone: string;
  timeFormat: "12h" | "24h";
  now: Date;
  /** El vínculo con Meta de cada reunión de la página. */
  metaLinks: Record<string, MetaLink>;
  onOpen: (id: string) => void;
}) {
  const columnDefs = useMemo(() => attributionColumnDefs(DEFAULT_COLUMNS), []);
  const { visible, toggle, showAll, reset } = useColumnPrefs<AttributionCellSource>(COLUMNS_STORAGE_KEY, columnDefs);
  const cellSource = (item: BookingListItem): AttributionCellSource => {
    const link = metaLinks[item.id];
    return { attribution: item.attribution, metaNames: link?.names ?? NO_NAMES, metaStatus: link ? (link.inherited ? `${link.statusLabel} · toque anterior` : link.statusLabel) : "" };
  };

  if (items.length === 0) {
    return <p className="rounded-xl border border-border p-8 text-center text-sm text-muted-foreground">Nada por acá con estos filtros.</p>;
  }

  return (
    <div>
    <div className="mb-2 hidden justify-end md:flex">
      <ColumnsMenu defs={columnDefs} groups={ATTRIBUTION_COLUMN_GROUPS} visible={visible} onToggle={toggle} onShowAll={showAll} onReset={reset} />
    </div>
    <div className="rounded-xl border border-border">
      {/* Escritorio */}
      <div className="hidden overflow-x-auto md:block">
      <table className="w-full text-left text-sm">
        <thead className="border-b border-border text-xs uppercase tracking-wide text-muted-foreground">
          <tr>
            <th className="whitespace-nowrap px-4 py-2 font-medium">Fecha y hora</th>
            {/* Fijo al desplazar: con tantas columnas, si no se pierde de quién es cada fila. */}
            <th className="sticky left-0 z-10 border-r border-border bg-background px-4 py-2 font-medium">Contacto</th>
            <th className="px-4 py-2 font-medium">Evento</th>
            <th className="px-4 py-2 font-medium">Categoría</th>
            <th className="px-4 py-2 font-medium">Anfitrión</th>
            <th className="px-4 py-2 font-medium">Estado</th>
            <th className="px-4 py-2 font-medium">Origen</th>
            {visible.map((def) => (
              <th key={def.key} title={def.hint} className="whitespace-nowrap px-3 py-2 font-medium">
                {def.label}
              </th>
            ))}
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
                if (e.key === "Enter" || e.key === " ") {
                  e.preventDefault();
                  onOpen(item.id);
                }
              }}
              className="group cursor-pointer border-b border-border last:border-0 hover:bg-muted/60 focus:bg-muted focus:outline-none"
            >
              <td className="whitespace-nowrap px-4 py-2.5 tabular-nums">{capitalize(formatDateTimeWithZone(item.startAt, timezone, timeFormat))}</td>
              <td className="sticky left-0 z-10 max-w-[14rem] truncate border-r border-border bg-background px-4 py-2.5 group-hover:bg-[color-mix(in_oklab,var(--muted)_60%,var(--background))]">{item.contactName || item.bookerName || "Sin nombre"}</td>
              <td className="px-4 py-2.5">
                <span className="inline-flex items-center gap-2">
                  <span aria-hidden className="h-2 w-2 shrink-0 rounded-full" style={{ background: item.eventColor ?? "var(--muted-foreground)" }} />
                  {item.title}
                  <MeetJoinLink meetUrl={item.meetUrl} status={item.status} />
                </span>
              </td>
              <td className="px-4 py-2.5 text-muted-foreground">{categoryText(item)}</td>
              <td className="px-4 py-2.5 text-muted-foreground">{hostNames[item.hostUserId] ?? "—"}</td>
              <td className="px-4 py-2.5">
                <span className="inline-flex flex-wrap items-center gap-1.5">
                  <StatusChip status={item.status} />
                  {needsOutcome({ status: item.status, end_at: item.endAt }, now) && <NeedsOutcomeChip />}
                  {item.slotReleasedAt && <SlotReleasedChip />}
                </span>
              </td>
              <td className="whitespace-nowrap px-4 py-2.5 text-muted-foreground">{ORIGIN_LABELS[item.origin as keyof typeof ORIGIN_LABELS] ?? item.origin}</td>
              {visible.map((def) => (
                <ColumnCell key={def.key} def={def} row={cellSource(item)} />
              ))}
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
    </div>
  );
}
