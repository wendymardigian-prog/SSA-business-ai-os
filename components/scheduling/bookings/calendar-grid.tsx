"use client";

/**
 * El calendario de agendas (F35): día, semana y mes.
 *
 * La colocación la hace `placeInCalendar` (núcleo): acá solo se dibuja. Las
 * canceladas no se muestran, como en el prototipo.
 *
 * En el celular la semana no entra: pasa a una agenda por día, que es lo que
 * hace la vista de contenido de la Etapa 2.
 */

import { useMemo } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import type { BookingListItem } from "@/lib/scheduling/data/bookings";
import { placeInCalendar, type CalendarView } from "@/lib/scheduling/calendar-view";
import { rangeFor, shiftAnchor } from "@/lib/scheduling/calendar-range";
import { capitalize, formatSlotLabel } from "@/lib/scheduling/booker/format";

const VIEWS: Array<{ key: CalendarView; label: string }> = [
  { key: "day", label: "Día" },
  { key: "week", label: "Semana" },
  { key: "month", label: "Mes" },
];

/** La franja que se dibuja: de 7 a 21, como el prototipo. */
const FIRST_HOUR = 7;
const LAST_HOUR = 21;
const HOUR_PX = 44;

function dayLabel(date: string): string {
  const [y, m, d] = date.split("-").map(Number);
  return capitalize(new Intl.DateTimeFormat("es", { weekday: "short", day: "numeric", timeZone: "UTC" }).format(new Date(Date.UTC(y, m - 1, d))));
}

export function BookingsCalendar({
  items,
  timezone,
  timeFormat,
  view,
  anchor,
  onView,
  onAnchor,
  onOpen,
}: {
  items: BookingListItem[];
  timezone: string;
  timeFormat: "12h" | "24h";
  view: CalendarView;
  /** Fecha `YYYY-MM-DD` del día (o del día dentro de la semana o el mes). */
  anchor: string;
  onView: (view: CalendarView) => void;
  onAnchor: (date: string) => void;
  onOpen: (id: string) => void;
}) {
  const range = useMemo(() => rangeFor(view, anchor), [view, anchor]);

  const placement = useMemo(
    () =>
      placeInCalendar(
        items.map((i) => ({ ...i, status: i.status, start_at: i.startAt, end_at: i.endAt, event_color: i.eventColor })),
        timezone,
        view,
        { range },
      ),
    [items, range, timezone, view],
  );

  const days = Object.keys(placement.byDate).sort();

  return (
    <div className="rounded-xl border border-border">
      <div className="flex flex-wrap items-center gap-2 border-b border-border p-3">
        <h3 className="text-sm font-semibold">{titleFor(view, range)}</h3>
        <span className="text-xs text-muted-foreground">Las canceladas no se muestran</span>
        <div className="ml-auto flex items-center gap-2">
          <button type="button" onClick={() => onAnchor(shiftAnchor(view, anchor, -1))} aria-label="Anterior" className="grid h-8 w-8 place-items-center rounded-md border border-border hover:bg-muted">
            <ChevronLeft className="h-4 w-4" />
          </button>
          <button type="button" onClick={() => onAnchor(shiftAnchor(view, anchor, 1))} aria-label="Siguiente" className="grid h-8 w-8 place-items-center rounded-md border border-border hover:bg-muted">
            <ChevronRight className="h-4 w-4" />
          </button>
          <div className="flex rounded-lg border border-border p-0.5" role="group" aria-label="Vista del calendario">
            {VIEWS.map((v) => (
              <button
                key={v.key}
                type="button"
                aria-pressed={view === v.key}
                onClick={() => onView(v.key)}
                className={view === v.key ? "rounded-md bg-primary px-2.5 py-1 text-xs font-medium text-primary-foreground" : "rounded-md px-2.5 py-1 text-xs text-muted-foreground hover:bg-muted"}
              >
                {v.label}
              </button>
            ))}
          </div>
        </div>
      </div>

      {view === "month" ? (
        <div className="grid grid-cols-7 gap-px bg-border p-px">
          {days.map((date) => (
            <div key={date} className="min-h-24 bg-card p-1.5">
              <p className="mb-1 text-xs text-muted-foreground">{dayLabel(date)}</p>
              <div className="flex flex-col gap-1">
                {(placement.byDate[date] ?? []).map((it) => {
                  const item = it.booking as unknown as BookingListItem;
                  return (
                    <button
                      key={item.id}
                      type="button"
                      onClick={() => onOpen(item.id)}
                      style={{ borderLeftColor: it.eventColor ?? "var(--primary)" }}
                      className="truncate rounded border-l-2 bg-muted/60 px-1.5 py-0.5 text-left text-[11px] hover:bg-muted"
                    >
                      {formatSlotLabel(item.startAt, timezone, timeFormat)} {item.contactName || item.bookerName || ""}
                    </button>
                  );
                })}
              </div>
            </div>
          ))}
        </div>
      ) : (
        <>
          {/* Escritorio: rejilla por hora */}
          <div className="hidden overflow-x-auto md:block">
            <div className="grid min-w-[640px]" style={{ gridTemplateColumns: `56px repeat(${days.length}, minmax(0, 1fr))` }}>
              <div />
              {days.map((date) => (
                <div key={date} className="border-b border-border p-2 text-center text-xs font-medium">
                  {dayLabel(date)}
                </div>
              ))}
              <div>
                {Array.from({ length: LAST_HOUR - FIRST_HOUR }, (_, i) => (
                  <div key={i} className="border-t border-border pr-2 text-right text-[11px] text-muted-foreground" style={{ height: HOUR_PX }}>
                    {String(FIRST_HOUR + i).padStart(2, "0")}:00
                  </div>
                ))}
              </div>
              {days.map((date) => (
                <div key={date} className="relative border-l border-border">
                  {Array.from({ length: LAST_HOUR - FIRST_HOUR }, (_, i) => (
                    <div key={i} className="border-t border-border" style={{ height: HOUR_PX }} />
                  ))}
                  {(placement.byDate[date] ?? []).map((it) => {
                    const item = it.booking as unknown as BookingListItem;
                    const top = ((it.startMinutes - FIRST_HOUR * 60) / 60) * HOUR_PX;
                    const height = Math.max(26, ((it.endMinutes - it.startMinutes) / 60) * HOUR_PX);
                    return (
                      <button
                        key={item.id}
                        type="button"
                        onClick={() => onOpen(item.id)}
                        style={{ top, height, borderLeftColor: it.eventColor ?? "var(--primary)" }}
                        className="absolute inset-x-1 overflow-hidden rounded-md border border-border border-l-2 bg-card px-1.5 py-1 text-left text-[11px] hover:border-ring"
                      >
                        <span className="block truncate font-medium tabular-nums">
                          {formatSlotLabel(item.startAt, timezone, timeFormat)} {item.contactName || item.bookerName || ""}
                        </span>
                        <span className="block truncate text-muted-foreground">{it.statusLabel}</span>
                      </button>
                    );
                  })}
                </div>
              ))}
            </div>
          </div>

          {/* Celular: una agenda por día */}
          <ul className="divide-y divide-border md:hidden">
            {days.map((date) => (
              <li key={date} className="p-3">
                <p className="mb-1.5 text-xs font-medium text-muted-foreground">{dayLabel(date)}</p>
                {(placement.byDate[date] ?? []).length === 0 && <p className="text-xs text-muted-foreground">Sin agendas</p>}
                <div className="flex flex-col gap-1.5">
                  {(placement.byDate[date] ?? []).map((it) => {
                    const item = it.booking as unknown as BookingListItem;
                    return (
                      <button
                        key={item.id}
                        type="button"
                        onClick={() => onOpen(item.id)}
                        style={{ borderLeftColor: it.eventColor ?? "var(--primary)" }}
                        className="rounded-md border border-border border-l-2 p-2 text-left text-sm hover:bg-muted"
                      >
                        <span className="block tabular-nums">{formatSlotLabel(item.startAt, timezone, timeFormat)}</span>
                        <span className="block text-xs text-muted-foreground">
                          {item.contactName || item.bookerName || "Sin nombre"} · {it.statusLabel}
                        </span>
                      </button>
                    );
                  })}
                </div>
              </li>
            ))}
          </ul>
        </>
      )}
    </div>
  );
}

function titleFor(view: CalendarView, range: { from: string; to: string }): string {
  if (view === "day") return capitalize(new Intl.DateTimeFormat("es", { weekday: "long", day: "numeric", month: "long", timeZone: "UTC" }).format(new Date(`${range.from}T12:00:00Z`)));
  if (view === "week") {
    const from = new Date(`${range.from}T12:00:00Z`);
    const to = new Date(`${range.to}T12:00:00Z`);
    const fmt = new Intl.DateTimeFormat("es", { day: "numeric", month: "long", timeZone: "UTC" });
    return `Semana del ${fmt.format(from)} al ${fmt.format(to)}`;
  }
  return capitalize(new Intl.DateTimeFormat("es", { month: "long", year: "numeric", timeZone: "UTC" }).format(new Date(`${range.from}T12:00:00Z`)));
}
