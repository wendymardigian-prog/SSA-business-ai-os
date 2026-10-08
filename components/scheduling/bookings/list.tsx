"use client";

/**
 * La lista de agendas (F33). Una fila por agenda; se abre el detalle al
 * hacer clic. En el celular la tabla pasa a tarjetas: siete columnas en 390
 * px no se comprimen, se rompen.
 */

import type { BookingListItem } from "@/lib/scheduling/data/bookings";
import { needsOutcome } from "@/lib/scheduling/bookings-view";
import { ORIGIN_LABELS } from "@/lib/scheduling/agenda-filters";
import { capitalize, formatDateTimeWithZone } from "@/lib/scheduling/booker/format";
import { NeedsOutcomeChip, StatusChip } from "./status-chip";

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
  onOpen,
}: {
  items: BookingListItem[];
  hostNames: Record<string, string>;
  timezone: string;
  timeFormat: "12h" | "24h";
  now: Date;
  onOpen: (id: string) => void;
}) {
  if (items.length === 0) {
    return <p className="rounded-xl border border-border p-8 text-center text-sm text-muted-foreground">Nada por acá con estos filtros.</p>;
  }

  return (
    <div className="rounded-xl border border-border">
      {/* Escritorio */}
      <table className="hidden w-full text-left text-sm md:table">
        <thead className="border-b border-border text-xs uppercase tracking-wide text-muted-foreground">
          <tr>
            <th className="px-4 py-2 font-medium">Fecha y hora</th>
            <th className="px-4 py-2 font-medium">Contacto</th>
            <th className="px-4 py-2 font-medium">Evento</th>
            <th className="px-4 py-2 font-medium">Categoría</th>
            <th className="px-4 py-2 font-medium">Anfitrión</th>
            <th className="px-4 py-2 font-medium">Estado</th>
            <th className="px-4 py-2 font-medium">Origen</th>
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
              className="cursor-pointer border-b border-border last:border-0 hover:bg-muted/60 focus:bg-muted focus:outline-none"
            >
              <td className="px-4 py-2.5 tabular-nums">{capitalize(formatDateTimeWithZone(item.startAt, timezone, timeFormat))}</td>
              <td className="px-4 py-2.5">{item.contactName || item.bookerName || "Sin nombre"}</td>
              <td className="px-4 py-2.5">
                <span className="inline-flex items-center gap-2">
                  <span aria-hidden className="h-2 w-2 shrink-0 rounded-full" style={{ background: item.eventColor ?? "var(--muted-foreground)" }} />
                  {item.title}
                </span>
              </td>
              <td className="px-4 py-2.5 text-muted-foreground">{categoryText(item)}</td>
              <td className="px-4 py-2.5 text-muted-foreground">{hostNames[item.hostUserId] ?? "—"}</td>
              <td className="px-4 py-2.5">
                <span className="inline-flex flex-wrap items-center gap-1.5">
                  <StatusChip status={item.status} />
                  {needsOutcome({ status: item.status, end_at: item.endAt }, now) && <NeedsOutcomeChip />}
                </span>
              </td>
              <td className="px-4 py-2.5 text-muted-foreground">{ORIGIN_LABELS[item.origin as keyof typeof ORIGIN_LABELS] ?? item.origin}</td>
            </tr>
          ))}
        </tbody>
      </table>

      {/* Celular */}
      <ul className="divide-y divide-border md:hidden">
        {items.map((item) => (
          <li key={item.id}>
            <button type="button" onClick={() => onOpen(item.id)} className="flex w-full flex-col gap-1.5 p-4 text-left hover:bg-muted/60">
              <span className="text-sm font-medium tabular-nums">{capitalize(formatDateTimeWithZone(item.startAt, timezone, timeFormat))}</span>
              <span className="text-sm">{item.contactName || item.bookerName || "Sin nombre"}</span>
              <span className="text-xs text-muted-foreground">
                {item.title} · {categoryText(item)}
              </span>
              <span className="flex flex-wrap items-center gap-1.5">
                <StatusChip status={item.status} />
                {needsOutcome({ status: item.status, end_at: item.endAt }, now) && <NeedsOutcomeChip />}
              </span>
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}
