"use client";

import { useMemo } from "react";
import { cn } from "@/lib/utils";
import { BusinessTimeNote, useBusinessTimeZone } from "@/components/ui/business-time-note";
import { formatInstantIn, zoneLabel } from "@/lib/business-time";
import {
  describeSchedule,
  MAX_LATE_MINUTES,
  nextOccurrence,
  parseScheduleConfig,
  WEEKDAY_LABELS,
  weekdayShort,
  type ScheduleRepeat,
} from "@/lib/scheduled-flows/schedule";

const REPEAT_OPTIONS: Array<{ value: ScheduleRepeat; label: string }> = [
  { value: "once", label: "Una vez" },
  { value: "daily", label: "Todos los días" },
  { value: "weekly", label: "Cada semana" },
  { value: "monthly", label: "Cada mes" },
];

/** La semana como se lee acá: de lunes a domingo. */
const WEEK_ORDER = [1, 2, 3, 4, 5, 6, 0];

const inputClass =
  "w-full rounded-lg border border-border bg-card px-3 py-2 text-sm text-foreground focus:border-ring focus:outline-none focus:ring-1 focus:ring-ring";

/**
 * El panel de «En una fecha y hora». La hora es la del NEGOCIO (`workspaces.timezone`): es una regla del flujo, no
 * depende de quién la armó. El panel lo dice y muestra la próxima vez, también en la hora de quien mira si es otra.
 */
export function ScheduledTriggerPanel({ data, onChange }: { data: Record<string, unknown>; onChange: (data: Record<string, unknown>) => void }) {
  const businessZone = useBusinessTimeZone();
  const config = parseScheduleConfig(data);

  const next = useMemo(() => (businessZone ? nextOccurrence(data, new Date(), businessZone) : null), [data, businessZone]);

  const set = (patch: Record<string, unknown>) => {
    const out = { ...data, ...patch };
    for (const [key, value] of Object.entries(patch)) if (value === undefined) delete out[key];
    onChange(out);
  };

  const setRepeat = (repeat: ScheduleRepeat) =>
    set({
      repeat,
      date: repeat === "once" ? config.date ?? undefined : undefined,
      weekdays: repeat === "weekly" ? (config.weekdays.length > 0 ? config.weekdays : [1]) : undefined,
      monthDay: repeat === "monthly" ? config.monthDay ?? 1 : undefined,
    });

  const toggleDay = (day: number) => {
    const days = config.weekdays.includes(day) ? config.weekdays.filter((d) => d !== day) : [...config.weekdays, day].sort((a, b) => a - b);
    set({ weekdays: days.length > 0 ? days : undefined });
  };

  return (
    <div className="space-y-4 rounded-lg border border-border p-3">
      <div>
        <p className="mb-2 text-xs font-semibold text-foreground">Cuándo</p>
        <div className="grid grid-cols-2 gap-1 rounded-lg border border-border bg-muted p-1" role="radiogroup" aria-label="Cada cuánto">
          {REPEAT_OPTIONS.map((option) => (
            <button
              key={option.value}
              type="button"
              role="radio"
              aria-checked={config.repeat === option.value}
              onClick={() => setRepeat(option.value)}
              className={cn(
                "rounded-md px-2 py-1.5 text-xs font-medium transition-colors",
                config.repeat === option.value ? "bg-card text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground",
              )}
            >
              {option.label}
            </button>
          ))}
        </div>
      </div>

      {config.repeat === "once" && (
        <div>
          <label htmlFor="st-date" className="mb-1.5 block text-xs font-medium text-foreground">Fecha</label>
          <input id="st-date" type="date" value={config.date ?? ""} onChange={(e) => set({ date: e.target.value || undefined })} className={inputClass} />
        </div>
      )}

      {config.repeat === "weekly" && (
        <fieldset>
          <legend className="mb-1.5 text-xs font-medium text-foreground">Qué días</legend>
          <div className="flex flex-wrap gap-1">
            {WEEK_ORDER.map((day) => {
              const on = config.weekdays.includes(day);
              return (
                <button
                  key={day}
                  type="button"
                  aria-pressed={on}
                  aria-label={WEEKDAY_LABELS[day]}
                  onClick={() => toggleDay(day)}
                  className={cn(
                    "min-w-10 rounded-md border px-2 py-1.5 text-xs font-medium capitalize transition-colors",
                    on ? "border-primary-edge bg-primary text-primary-foreground" : "border-border bg-card text-muted-foreground hover:text-foreground",
                  )}
                >
                  {weekdayShort(day)}
                </button>
              );
            })}
          </div>
        </fieldset>
      )}

      {config.repeat === "monthly" && (
        <div>
          <label htmlFor="st-month-day" className="mb-1.5 block text-xs font-medium text-foreground">Qué día del mes</label>
          <select id="st-month-day" value={config.monthDay ?? 1} onChange={(e) => set({ monthDay: Number(e.target.value) })} className={inputClass}>
            {Array.from({ length: 31 }, (_, i) => i + 1).map((d) => (
              <option key={d} value={d}>
                {d}
              </option>
            ))}
          </select>
          {(config.monthDay ?? 1) > 28 && <p className="mt-1 text-[11px] text-muted-foreground">Los meses que no tienen ese día, corre el último día del mes.</p>}
        </div>
      )}

      <div>
        <label htmlFor="st-time" className="mb-1.5 block text-xs font-medium text-foreground">Hora</label>
        <input id="st-time" type="time" value={config.time ?? ""} onChange={(e) => set({ time: e.target.value || undefined })} className={inputClass} />
        <BusinessTimeNote className="mt-1.5" instant={next} times={[config.time]} />
      </div>

      <div className="rounded-md bg-muted px-3 py-2 text-xs text-foreground">
        <p className="font-medium">{describeSchedule(data)}</p>
        {businessZone && (
          next ? (
            <p className="mt-0.5 text-muted-foreground">
              Próxima vez: {formatInstantIn(next, businessZone)} ({zoneLabel(businessZone, next)})
            </p>
          ) : (
            config.repeat === "once" && config.date && config.time && <p className="mt-0.5 text-amber-700 dark:text-amber-400">Esa fecha y hora ya pasó: no va a correr.</p>
          )
        )}
      </div>

      <p className="text-[11px] text-muted-foreground/80">
        Corre sin contacto: sirve para mandar una encuesta a un grupo de WhatsApp, avisar al equipo o mandar un email a una dirección fija. Se agenda al publicar; si cambiás la fecha, publicá de nuevo. Quedan disponibles {"{{schedule.date}}"}, {"{{schedule.weekday}}"} y {"{{schedule.time}}"}. Si el sistema no pudo correrla a tiempo, la corre hasta {MAX_LATE_MINUTES / 60} horas tarde; después saltea esa vez.
      </p>
    </div>
  );
}
