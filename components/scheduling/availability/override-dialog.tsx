"use client";

import { useMemo, useState, useTransition } from "react";
import { ContentDialog } from "@/components/content/dialog";
import { TimeSelect } from "./time-select";
import { buildMonthView, addMonths, monthOf } from "@/lib/scheduling/booker/month-view";
import { findOverlap, WEEKDAY_SHORT } from "@/lib/scheduling/availability-schema";
import { dateInTz } from "@/lib/scheduling/time/tz";
import { formatDateLong } from "@/lib/scheduling/booker/format";
import { shortTime, joinSpanish } from "@/lib/scheduling/schedules";
import { saveOverrides } from "@/lib/actions/scheduling/schedules";
import type { DateOverride, TimeRange, WeeklyHours } from "@/lib/scheduling/types";

/**
 * Modal "Nueva excepcion" (F12). Adaptado de Cal.diy
 * (https://github.com/calcom/cal.diy), MIT License, Copyright (c) 2020-present
 * Cal.com, Inc. (DateOverrideInputDialog): eligir uno o varios dias, decidir
 * que pasa esos dias, resumen en vivo. Aplica SOLO a este horario.
 */
export function OverrideDialog({
  scheduleId,
  scheduleName,
  timezone,
  weeklyHours,
  editing,
  onClose,
  onSaved,
}: {
  scheduleId: string;
  scheduleName: string;
  timezone: string;
  weeklyHours: WeeklyHours;
  /** Editar una excepcion existente: ese dia viene cargado. */
  editing?: DateOverride | null;
  onClose: () => void;
  onSaved: (message: string) => void;
}) {
  const today = dateInTz(new Date(), timezone);
  const [month, setMonth] = useState(monthOf(editing?.date ?? today));
  const [days, setDays] = useState<Set<string>>(new Set(editing ? [editing.date] : []));
  const [mode, setMode] = useState<"off" | "hours">(editing && editing.ranges.length > 0 ? "hours" : "off");
  const [ranges, setRanges] = useState<TimeRange[]>(editing?.ranges.length ? editing.ranges : [{ start: "10:00", end: "12:00" }]);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  const view = useMemo(() => buildMonthView({}, month, timezone), [month, timezone]);
  const sorted = [...days].sort();
  const overlap = mode === "hours" ? findOverlap(ranges) : null;
  const rawMonth = new Intl.DateTimeFormat("es", { month: "long", year: "numeric", timeZone: "UTC" }).format(new Date(`${month}-01T00:00:00Z`));
  const monthLabel = rawMonth.charAt(0).toUpperCase() + rawMonth.slice(1);

  const summaryDays = sorted.map((d) => `${WEEKDAY_SHORT[new Date(`${d}T12:00:00Z`).getUTCDay()].toLowerCase()} ${formatDateLong(new Date(`${d}T12:00:00Z`), "UTC").replace(/^[^,]+,\s*/, "").replace(/ de \d{4}$/, "")}`);
  const summary = sorted.length === 0 ? "Elegí al menos un día" : `${joinSpanish(summaryDays)} · ${mode === "off" ? "no disponible" : `solo ${ranges.map((r) => `${shortTime(r.start)}–${shortTime(r.end)}`).join(" y ")}`}`;

  function save() {
    setError(null);
    start(async () => {
      const result = await saveOverrides({ scheduleId, overrides: sorted.map((date) => ({ date, ranges: mode === "off" ? [] : ranges })) });
      if (!result.ok) {
        setError(result.error);
        return;
      }
      onSaved(`Excepción guardada en ${sorted.length} ${sorted.length === 1 ? "día" : "días"} · solo para ${scheduleName}`);
    });
  }

  return (
    <ContentDialog
      title={
        <span>
          {editing ? "Editar excepción" : "Nueva excepción"}
          <span className="block text-xs font-normal text-muted-foreground">
            Solo para el horario <strong>{scheduleName}</strong> · los demás horarios no cambian
          </span>
        </span>
      }
      label={editing ? "Editar excepción" : "Nueva excepción"}
      onClose={onClose}
      footer={
        <div className="flex w-full flex-wrap items-center gap-2">
          <span className="text-xs text-muted-foreground">Zona horaria: {timezone.replace(/_/g, " ")}</span>
          <span className="flex-1" />
          <button type="button" data-close onClick={onClose} className="rounded-lg border border-border px-3 py-2 text-sm">
            Cancelar
          </button>
          <button type="button" onClick={save} disabled={pending || sorted.length === 0 || overlap !== null} className="rounded-lg bg-primary px-3 py-2 text-sm font-medium text-primary-foreground disabled:opacity-50">
            Guardar excepción
          </button>
        </div>
      }
    >
      <div className="grid gap-5 md:grid-cols-2">
        <div>
          <p className="text-xs font-semibold">1. Elegí uno o varios días</p>
          <div className="mt-2 flex items-center justify-between">
            <button type="button" aria-label="Mes anterior" onClick={() => setMonth(addMonths(month, -1))} className="rounded px-2 py-1 text-sm hover:bg-muted">‹</button>
            <span className="text-sm font-medium">{monthLabel}</span>
            <button type="button" aria-label="Mes siguiente" onClick={() => setMonth(addMonths(month, 1))} className="rounded px-2 py-1 text-sm hover:bg-muted">›</button>
          </div>
          <div className="mt-2 grid grid-cols-7 gap-1 text-center text-xs">
            {["L", "M", "M", "J", "V", "S", "D"].map((d, i) => (
              <span key={i} className="text-muted-foreground">{d}</span>
            ))}
            {view.weeks.flat().map((day) => {
              const works = (weeklyHours[String(new Date(`${day.date}T12:00:00Z`).getUTCDay()) as keyof WeeklyHours] ?? []).length > 0;
              const past = day.date < today;
              const selected = days.has(day.date);
              return (
                <button
                  key={day.date}
                  type="button"
                  disabled={!day.isCurrentMonth || past || (!!editing && !selected)}
                  aria-pressed={selected}
                  aria-label={day.date}
                  onClick={() => {
                    const next = new Set(days);
                    if (selected) next.delete(day.date);
                    else next.add(day.date);
                    setDays(next);
                  }}
                  className={`h-8 rounded-lg text-sm tabular-nums ${!day.isCurrentMonth ? "opacity-20" : past ? "text-muted-foreground/50" : selected ? "bg-primary text-primary-foreground" : works ? "font-medium hover:bg-muted" : "text-muted-foreground hover:bg-muted"}`}
                >
                  {day.dayOfMonth}
                </button>
              );
            })}
          </div>
          <p className="mt-2 text-[11px] text-muted-foreground">Los días que el horario no trabaja también se pueden elegir (sirve para abrir un sábado puntual).</p>
        </div>
        <div className="space-y-3">
          <p className="text-xs font-semibold">2. ¿Qué pasa esos días?</p>
          <div role="radiogroup" aria-label="Qué pasa esos días" className="space-y-2">
            {[
              ["off", "No disponible todo el día", "No se ofrecen horarios"],
              ["hours", "Horario distinto", "Reemplaza el horario semanal de ese día"],
            ].map(([key, title, sub]) => (
              <button key={key} type="button" role="radio" aria-checked={mode === key} onClick={() => setMode(key as "off" | "hours")} className={`flex w-full items-start gap-2 rounded-lg border p-2 text-left ${mode === key ? "border-primary bg-primary/10" : "border-border"}`}>
                <span className={`mt-1 h-3 w-3 shrink-0 rounded-full border ${mode === key ? "border-primary bg-primary" : "border-muted-foreground"}`} />
                <span>
                  <span className="block text-sm font-medium">{title}</span>
                  <span className="block text-xs text-muted-foreground">{sub}</span>
                </span>
              </button>
            ))}
          </div>
          {mode === "hours" && (
            <div className="space-y-1">
              {ranges.map((r, i) => (
                <div key={i} className="flex items-center gap-1.5">
                  <TimeSelect label={`Inicio ${i + 1}`} value={r.start} onChange={(start) => setRanges(ranges.map((x, j) => (j === i ? { ...x, start } : x)))} />
                  <span>–</span>
                  <TimeSelect label={`Fin ${i + 1}`} value={r.end} isEnd onChange={(end) => setRanges(ranges.map((x, j) => (j === i ? { ...x, end } : x)))} />
                  {ranges.length > 1 && (
                    <button type="button" aria-label="Quitar rango" onClick={() => setRanges(ranges.filter((_, j) => j !== i))} className="text-xs text-muted-foreground">✕</button>
                  )}
                </div>
              ))}
              <button type="button" onClick={() => setRanges([...ranges, { start: ranges[ranges.length - 1]?.end ?? "14:00", end: "18:00" }])} className="text-xs text-primary">+ Rango</button>
              {overlap && <p className="text-xs text-red-600">Dos rangos se superponen.</p>}
            </div>
          )}
          <div className="rounded-lg border border-border bg-muted/40 p-3">
            <p className="text-xs font-semibold">Resumen</p>
            <p className="mt-1 text-sm text-muted-foreground">{summary}</p>
          </div>
          {error && <p className="text-sm text-red-600">{error}</p>}
        </div>
      </div>
    </ContentDialog>
  );
}
