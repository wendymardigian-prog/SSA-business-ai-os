"use client";

import { useState } from "react";
import { Plus, Trash2, Copy } from "lucide-react";
import { Switch } from "@/components/ui/switch";
import { TimeSelect } from "./time-select";
import { WEEKDAY_LONG, WEEKDAY_KEYS, findOverlap } from "@/lib/scheduling/availability-schema";
import type { TimeRange, WeekdayKey, WeeklyHours } from "@/lib/scheduling/types";

/**
 * Editor semanal (F11). Adaptado de Cal.diy
 * (https://github.com/calcom/cal.diy), MIT License, Copyright (c) 2020-present
 * Cal.com, Inc. (ScheduleComponent): una fila por dia con switch, rangos y
 * "copiar a…", sin react-hook-form ni react-select.
 */

const DEFAULT_RANGE: TimeRange = { start: "09:00", end: "17:00" };
/** Lunes primero, como todo el modulo. */
const ORDER: WeekdayKey[] = ["1", "2", "3", "4", "5", "6", "0"];

export function WeeklyEditor({
  value,
  onChange,
  errorDay,
  disabled,
}: {
  value: WeeklyHours;
  onChange: (next: WeeklyHours) => void;
  /** Dia con error de validacion ("1"), para marcarlo. */
  errorDay?: string | null;
  disabled?: boolean;
}) {
  const [copyFrom, setCopyFrom] = useState<WeekdayKey | null>(null);
  const [copyTo, setCopyTo] = useState<Set<WeekdayKey>>(new Set());
  const [remembered, setRemembered] = useState<Partial<Record<WeekdayKey, TimeRange[]>>>({});

  const set = (day: WeekdayKey, ranges: TimeRange[]) => onChange({ ...value, [day]: ranges });

  return (
    <div className="space-y-2">
      {ORDER.map((day) => {
        const ranges = value[day] ?? [];
        const on = ranges.length > 0;
        const overlap = on ? findOverlap(ranges) : null;
        const hasError = errorDay === day || overlap !== null;
        return (
          <div key={day} className={`flex flex-col gap-2 rounded-lg border p-2 sm:flex-row sm:items-start ${hasError ? "border-red-400" : "border-border"}`}>
            <div className="flex w-32 shrink-0 items-center gap-2 pt-1">
              <Switch
                checked={on}
                disabled={disabled}
                label={`${WEEKDAY_LONG[Number(day)]} disponible`}
                onChange={(next) => {
                  if (next) set(day, remembered[day]?.length ? remembered[day]! : [DEFAULT_RANGE]);
                  else {
                    setRemembered((r) => ({ ...r, [day]: ranges }));
                    set(day, []);
                  }
                }}
              />
              <span className="text-sm font-medium">{WEEKDAY_LONG[Number(day)]}</span>
            </div>
            <div className="min-w-0 flex-1 space-y-1">
              {!on && <p className="pt-1 text-sm text-muted-foreground">No disponible</p>}
              {ranges.map((r, i) => (
                <div key={i} className="flex flex-wrap items-center gap-1.5">
                  <TimeSelect label={`Inicio ${i + 1} de ${WEEKDAY_LONG[Number(day)]}`} value={r.start} disabled={disabled} onChange={(start) => set(day, ranges.map((x, j) => (j === i ? { ...x, start } : x)))} />
                  <span className="text-muted-foreground">–</span>
                  <TimeSelect label={`Fin ${i + 1} de ${WEEKDAY_LONG[Number(day)]}`} value={r.end} isEnd disabled={disabled} onChange={(end) => set(day, ranges.map((x, j) => (j === i ? { ...x, end } : x)))} />
                  <button type="button" disabled={disabled} aria-label="Quitar rango" onClick={() => set(day, ranges.filter((_, j) => j !== i))} className="rounded p-1 text-muted-foreground hover:bg-muted hover:text-foreground">
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                </div>
              ))}
              {overlap && <p className="text-xs text-red-600">Dos rangos se superponen ({overlap[0].start}–{overlap[0].end} y {overlap[1].start}–{overlap[1].end}).</p>}
            </div>
            {on && (
              <div className="flex shrink-0 items-center gap-1 text-xs">
                <button
                  type="button"
                  disabled={disabled}
                  onClick={() => {
                    const last = ranges[ranges.length - 1];
                    const start = last ? last.end === "24:00" ? "23:00" : last.end : "09:00";
                    const [h] = start.split(":").map(Number);
                    const end = h + 1 >= 24 ? "24:00" : `${String(h + 1).padStart(2, "0")}:${start.split(":")[1]}`;
                    set(day, [...ranges, { start, end }]);
                  }}
                  className="inline-flex items-center gap-1 rounded px-1.5 py-1 text-muted-foreground hover:bg-muted hover:text-foreground"
                >
                  <Plus className="h-3.5 w-3.5" /> Rango
                </button>
                <button type="button" disabled={disabled} onClick={() => { setCopyFrom(day); setCopyTo(new Set()); }} className="inline-flex items-center gap-1 rounded px-1.5 py-1 text-muted-foreground hover:bg-muted hover:text-foreground">
                  <Copy className="h-3.5 w-3.5" /> Copiar a…
                </button>
              </div>
            )}
          </div>
        );
      })}

      {copyFrom && (
        <div role="dialog" aria-label="Copiar horario a otros días" className="rounded-lg border border-border bg-muted/40 p-3 text-sm">
          <p className="font-medium">Copiar {WEEKDAY_LONG[Number(copyFrom)]} a:</p>
          <div className="mt-2 flex flex-wrap gap-2">
            {WEEKDAY_KEYS.filter((d) => d !== copyFrom).map((d) => (
              <label key={d} className="inline-flex items-center gap-1.5 rounded-lg border border-border px-2 py-1">
                <input
                  type="checkbox"
                  checked={copyTo.has(d)}
                  onChange={(e) => {
                    const next = new Set(copyTo);
                    if (e.target.checked) next.add(d);
                    else next.delete(d);
                    setCopyTo(next);
                  }}
                />
                {WEEKDAY_LONG[Number(d)]}
              </label>
            ))}
          </div>
          <div className="mt-2 flex gap-2">
            <button
              type="button"
              className="rounded-lg bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground disabled:opacity-50"
              disabled={copyTo.size === 0}
              onClick={() => {
                const src = value[copyFrom] ?? [];
                const next = { ...value };
                for (const d of copyTo) next[d] = src.map((r) => ({ ...r }));
                onChange(next);
                setCopyFrom(null);
              }}
            >
              Copiar
            </button>
            <button type="button" className="rounded-lg border border-border px-3 py-1.5 text-xs" onClick={() => setCopyFrom(null)}>
              Cancelar
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
