// Adaptado de Cal.diy (https://github.com/calcom/cal.diy), MIT License, Copyright (c) 2020-present Cal.com, Inc.
"use client";

/**
 * El calendario del booker (F25). Adaptado de
 * `packages/features/calendars/components/DatePicker.tsx`: se quitan dayjs en
 * la vista, `@calcom/ui` y los layouts de columnas; la grilla la calcula
 * `buildMonthView` (nucleo) y acá solo se dibuja.
 *
 * La semana arranca el lunes, como el resto del sistema.
 */

import { ChevronLeft, ChevronRight } from "lucide-react";
import type { MonthView } from "@/lib/scheduling/booker/month-view";
import { capitalize } from "@/lib/scheduling/booker/format";

const WEEKDAYS = ["lun", "mar", "mié", "jue", "vie", "sáb", "dom"];

function monthLabel(month: string): string {
  const [year, m] = month.split("-").map(Number);
  const text = new Intl.DateTimeFormat("es", { month: "long", year: "numeric", timeZone: "UTC" }).format(new Date(Date.UTC(year, m - 1, 1)));
  return capitalize(text);
}

export function DatePicker({
  view,
  selected,
  onSelect,
  onMonthChange,
  loading,
}: {
  view: MonthView;
  selected: string | null;
  onSelect: (date: string) => void;
  onMonthChange: (month: string) => void;
  loading: boolean;
}) {
  const prev = view.prevMonthWithSlots;
  const next = view.nextMonthWithSlots;

  return (
    <div>
      <div className="mb-3 flex items-center gap-2">
        <h2 className="text-base font-semibold">{monthLabel(view.month)}</h2>
        <div className="ml-auto flex gap-1">
          <button
            type="button"
            onClick={() => prev && onMonthChange(prev)}
            disabled={!prev || loading}
            aria-label="Mes anterior con horarios"
            className="grid h-8 w-8 place-items-center rounded-md border border-border text-muted-foreground hover:bg-muted disabled:opacity-40"
          >
            <ChevronLeft className="h-4 w-4" />
          </button>
          <button
            type="button"
            onClick={() => next && onMonthChange(next)}
            disabled={!next || loading}
            aria-label="Mes siguiente con horarios"
            className="grid h-8 w-8 place-items-center rounded-md border border-border text-muted-foreground hover:bg-muted disabled:opacity-40"
          >
            <ChevronRight className="h-4 w-4" />
          </button>
        </div>
      </div>

      <div className="grid grid-cols-7 gap-1" role="grid" aria-label="Días con horarios">
        {WEEKDAYS.map((d) => (
          <span key={d} className="pb-1 text-center text-xs font-medium text-muted-foreground">
            {d}
          </span>
        ))}
        {view.weeks.flat().map((day) => {
          if (!day.available) {
            return (
              <span
                key={day.date}
                aria-disabled
                className={`grid h-10 place-items-center rounded-md text-sm text-muted-foreground ${day.isCurrentMonth ? "" : "opacity-30"}`}
              >
                {day.dayOfMonth}
              </span>
            );
          }
          const isSelected = selected === day.date;
          return (
            <button
              key={day.date}
              type="button"
              onClick={() => onSelect(day.date)}
              aria-pressed={isSelected}
              aria-label={`${day.dayOfMonth}, ${day.slotCount} ${day.slotCount === 1 ? "horario" : "horarios"}`}
              className={
                isSelected
                  ? "grid h-10 place-items-center rounded-md bg-primary text-sm font-semibold text-primary-foreground"
                  : `grid h-10 place-items-center rounded-md border border-border text-sm font-medium hover:bg-muted ${day.isToday ? "ring-1 ring-ring" : ""}`
              }
            >
              {day.dayOfMonth}
            </button>
          );
        })}
      </div>
    </div>
  );
}
