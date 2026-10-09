"use client";

import { useEffect, useRef, useState } from "react";
import { Calendar, ChevronLeft, ChevronRight } from "lucide-react";
import { cn } from "@/lib/utils";
import {
  WEEKDAYS_SHORT, civilRangeToIso, compareCivil, formatMonth, formatRange, isoRangeToCivil,
  monthGrid, nextMonth, periodButtonLabel, pickDay, previousMonth, sameCivil, todayIn,
  type CivilDate, type CivilRange,
} from "@/lib/dashboards/chat/date-range";

/**
 * El período: los atajos del que llama y un calendario de dos meses.
 * Genérico en `P`, el tipo del atajo: el dashboard de Chat pasa `PeriodPreset`
 * (`lib/dashboards/period.ts`), Agenda pasa `AgendaPeriod`
 * (`lib/scheduling/agenda-period.ts`). Este componente no sabe nada de ninguno
 * de los dos catálogos: `presets` y `labels` son del que llama.
 *
 * Lo que hace distinto a un `<select>` de atajos:
 *
 *   - Se puede elegir un rango a mano, en cualquier orden.
 *   - Los días futuros están bloqueados por defecto (no hay datos del
 *     futuro); `allowFuture` lo saca para una pantalla que sí mira adelante
 *     (Agenda: una reunión se agenda antes de que pase).
 *   - Nada se aplica hasta tocar "Aplicar": mientras se elige el rango, la
 *     pantalla no se recarga tres veces.
 *
 * Los días se cortan en la zona que pasa el que llama (`workspaces.timezone`
 * para el dashboard; la de la pantalla para Agenda), no en la del navegador.
 *
 * Se cierra solo al hacer clic afuera y con Esc (desde donde este el foco).
 *
 * En la computadora el panel va `fixed` y su posicion se calcula al abrir, no
 * `absolute` pegado al boton: son ~790 px de ancho y el boton esta a la
 * izquierda de la barra, asi que anclarlo a su borde derecho lo sacaba por la
 * izquierda de la pantalla y las columnas del calendario se apretaban hasta
 * quedar sin espacio.
 */

/** El ancho del panel en la computadora: 170 de atajos + dos meses de 266 + el relleno. Fijo, asi la posicion se calcula sin medirlo. */
const PANEL_WIDTH = 790;
const EDGE_GAP = 16;

export function PeriodPopover<P extends string>({
  preset,
  presets,
  labels,
  from,
  to,
  timezone,
  allowFuture,
  onApply,
}: {
  preset: P;
  /** Los atajos a mostrar, en el orden en que se dibujan. */
  presets: readonly P[];
  labels: Record<P, string>;
  /** El rango a medida que vino de la URL, si hay. */
  from: string | null;
  to: string | null;
  timezone: string;
  /** true: el calendario no bloquea los días futuros. Default false. */
  allowFuture?: boolean;
  onApply: (next: { preset: P | null; from: string | null; to: string | null }) => void;
}) {
  const [open, setOpen] = useState(false);
  // Donde cae el panel en la computadora (en el telefono es una hoja `fixed inset-x-4`).
  const [pos, setPos] = useState<{ left: number; top: number } | null>(null);
  const wrapperRef = useRef<HTMLDivElement>(null);
  const today = todayIn(timezone);
  const urlCivil = isoRangeToCivil(from, to, timezone);

  // Clic afuera, Esc y cambio de tamaño cierran el panel.
  useEffect(() => {
    if (!open) return;
    const onPointerDown = (e: MouseEvent | TouchEvent) => {
      if (!wrapperRef.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    const onResize = () => setOpen(false);
    document.addEventListener("mousedown", onPointerDown);
    document.addEventListener("touchstart", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    window.addEventListener("resize", onResize);
    return () => {
      document.removeEventListener("mousedown", onPointerDown);
      document.removeEventListener("touchstart", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("resize", onResize);
    };
  }, [open]);

  function toggle() {
    if (open) {
      setOpen(false);
      return;
    }
    const rect = wrapperRef.current?.getBoundingClientRect();
    if (rect) {
      // Alineado a la izquierda del boton, pero sin salirse de la pantalla por ningun lado.
      const left = Math.max(EDGE_GAP, Math.min(rect.left, window.innerWidth - PANEL_WIDTH - EDGE_GAP));
      setPos({ left, top: rect.bottom + 8 });
    }
    setOpen(true);
  }

  return (
    <div className="relative" ref={wrapperRef}>
      <button
        type="button"
        aria-haspopup="dialog"
        aria-expanded={open}
        onClick={toggle}
        className={cn(
          "flex h-8 items-center gap-2 whitespace-nowrap rounded-lg border px-3 text-[13px] font-medium transition-colors",
          urlCivil ? "border-primary bg-primary/10" : "border-input bg-background hover:border-muted-foreground/60",
        )}
      >
        <Calendar className="h-4 w-4 shrink-0" aria-hidden />
        {/* Con un tope: "Ultimos 7 + proximos 30 dias" mide 190 px y la barra de
            Agenda no tiene de sobra. El texto completo queda en el tooltip. */}
        <span className="max-w-[10.5rem] truncate xl:max-w-[14rem]" title={periodButtonLabel(urlCivil ? null : labels[preset], urlCivil)}>
          {periodButtonLabel(urlCivil ? null : labels[preset], urlCivil)}
        </span>
      </button>

      {open && (
        <PeriodPanel
          preset={preset}
          presets={presets}
          labels={labels}
          initial={urlCivil}
          today={today}
          timezone={timezone}
          allowFuture={allowFuture ?? false}
          pos={pos}
          onClose={() => setOpen(false)}
          onApply={(next) => {
            setOpen(false);
            onApply(next);
          }}
        />
      )}
    </div>
  );
}

function PeriodPanel<P extends string>({
  preset,
  presets,
  labels,
  initial,
  today,
  timezone,
  allowFuture,
  pos,
  onClose,
  onApply,
}: {
  preset: P;
  presets: readonly P[];
  labels: Record<P, string>;
  initial: { from: CivilDate; to: CivilDate } | null;
  today: CivilDate;
  timezone: string;
  allowFuture: boolean;
  pos: { left: number; top: number } | null;
  onClose: () => void;
  onApply: (next: { preset: P | null; from: string | null; to: string | null }) => void;
}) {
  // Lo elegido vive aca hasta que se aplica: el dashboard no se recarga
  // mientras se prueba un rango.
  const [draftPreset, setDraftPreset] = useState<P | null>(initial ? null : preset);
  const [draftRange, setDraftRange] = useState<CivilRange | null>(initial ? { from: initial.from, to: initial.to } : null);
  const [base, setBase] = useState(() => previousMonth(today.year, today.month));

  const right = nextMonth(base.year, base.month);

  function apply() {
    if (draftPreset) {
      onApply({ preset: draftPreset, from: null, to: null });
      return;
    }
    if (draftRange?.to) {
      const iso = civilRangeToIso({ from: draftRange.from, to: draftRange.to }, timezone);
      onApply({ preset: null, from: iso.from, to: iso.to });
      return;
    }
    onClose();
  }

  return (
    <div
      role="dialog"
      aria-label="Elegir período"
      onKeyDown={(e) => {
        if (e.key === "Escape") {
          e.preventDefault();
          onClose();
        }
      }}
      // En la computadora: `fixed` en la posicion calculada al abrir (`pos`), de ancho
      // fijo. En el telefono: una hoja de lado a lado, que ignora `pos`.
      style={pos ? ({ "--panel-left": `${pos.left}px`, "--panel-top": `${pos.top}px` } as React.CSSProperties) : undefined}
      className="fixed inset-x-4 top-28 z-50 max-h-[75vh] overflow-auto rounded-xl border border-border bg-popover shadow-lg topbar:inset-x-auto topbar:left-[var(--panel-left,1rem)] topbar:top-[var(--panel-top,7rem)] topbar:grid topbar:w-[790px] topbar:grid-cols-[170px_1fr]"
    >
      {/* Los atajos */}
      <div className="flex flex-wrap gap-1 border-b border-border p-2.5 topbar:flex-col topbar:flex-nowrap topbar:gap-px topbar:border-b-0 topbar:border-r">
        {presets.map((p) => (
          <button
            key={p}
            type="button"
            aria-pressed={draftPreset === p}
            onClick={() => {
              setDraftPreset(p);
              setDraftRange(null);
            }}
            className={cn(
              "rounded-lg px-2.5 py-1.5 text-left text-[13px] font-medium transition-colors hover:bg-accent",
              draftPreset === p && "bg-accent",
            )}
          >
            {labels[p]}
          </button>
        ))}
      </div>

      <div className="flex min-w-0 flex-col gap-3 p-4">
        <div className="flex flex-wrap items-baseline justify-between gap-4">
          <span className="font-medium text-muted-foreground">Rango personalizado</span>
          <span className="text-[13px] tabular-nums text-muted-foreground">{formatRange(draftRange)}</span>
        </div>

        <div className="relative grid gap-6 rounded-xl border border-border p-3 topbar:grid-cols-2">
          <button
            type="button"
            aria-label="Mes anterior"
            onClick={() => setBase(previousMonth(base.year, base.month))}
            className="absolute left-3 top-3 grid h-[30px] w-[30px] place-items-center rounded-lg border border-input text-muted-foreground hover:bg-accent hover:text-foreground"
          >
            <ChevronLeft className="h-4 w-4" aria-hidden />
          </button>
          <button
            type="button"
            aria-label="Mes siguiente"
            onClick={() => setBase(nextMonth(base.year, base.month))}
            className="absolute right-3 top-3 grid h-[30px] w-[30px] place-items-center rounded-lg border border-input text-muted-foreground hover:bg-accent hover:text-foreground"
          >
            <ChevronRight className="h-4 w-4" aria-hidden />
          </button>

          <MonthCalendar
            year={base.year}
            month={base.month}
            today={today}
            range={draftRange}
            allowFuture={allowFuture}
            onPick={(d) => {
              setDraftRange((r) => pickDay(r, d));
              setDraftPreset(null);
            }}
          />
          {/* El segundo mes se esconde en el telefono: no entran catorce columnas. */}
          <div className="hidden topbar:block">
            <MonthCalendar
              year={right.year}
              month={right.month}
              today={today}
              range={draftRange}
              allowFuture={allowFuture}
              onPick={(d) => {
                setDraftRange((r) => pickDay(r, d));
                setDraftPreset(null);
              }}
            />
          </div>
        </div>

        <button
          type="button"
          onClick={apply}
          disabled={!draftPreset && !draftRange?.to}
          className="h-10 rounded-[10px] bg-primary font-semibold text-primary-foreground transition-colors hover:bg-primary/90 disabled:opacity-50"
        >
          Aplicar
        </button>
      </div>
    </div>
  );
}

function MonthCalendar({
  year,
  month,
  today,
  range,
  allowFuture,
  onPick,
}: {
  year: number;
  month: number;
  today: CivilDate;
  range: CivilRange | null;
  allowFuture: boolean;
  onPick: (day: CivilDate) => void;
}) {
  const cells = monthGrid(year, month, today);
  const end = range?.to ?? range?.from ?? null;

  return (
    // Ancho fijo en la computadora (7 columnas de 38 px): sin esto cada columna
    // medía lo que su numero y el calendario quedaba apretado.
    <div className="w-full topbar:w-[266px]">
      <p className="mb-1.5 flex h-[30px] items-center justify-center font-semibold">{formatMonth(year, month)}</p>
      <div className="grid grid-cols-7 gap-y-1">
        {WEEKDAYS_SHORT.map((d) => (
          <span key={d} className="h-[26px] text-center text-xs leading-[26px] text-muted-foreground">
            {d}
          </span>
        ))}
        {cells.map((cell) => {
          if (!cell.inMonth) {
            return (
              <span key={cell.key} className="grid h-[34px] place-items-center text-[13px] tabular-nums text-muted-foreground/45">
                {cell.date.day}
              </span>
            );
          }
          if (cell.isFuture && !allowFuture) {
            return (
              <span
                key={cell.key}
                aria-disabled
                title="Todavía no pasó"
                className="grid h-[34px] cursor-not-allowed place-items-center text-[13px] tabular-nums text-muted-foreground/40"
              >
                {cell.date.day}
              </span>
            );
          }
          const isStart = sameCivil(cell.date, range?.from ?? null);
          const isEnd = sameCivil(cell.date, end);
          const inside =
            range !== null &&
            end !== null &&
            compareCivil(cell.date, range.from) >= 0 &&
            compareCivil(cell.date, end) <= 0;

          return (
            <button
              key={cell.key}
              type="button"
              onClick={() => onPick(cell.date)}
              aria-pressed={isStart || isEnd}
              className={cn(
                "grid h-[34px] place-items-center text-[13px] tabular-nums transition-colors",
                inside && !isStart && !isEnd && "bg-primary/15 text-primary",
                isStart && !isEnd && "rounded-l-lg bg-primary text-primary-foreground",
                isEnd && !isStart && "rounded-r-lg bg-primary text-primary-foreground",
                isStart && isEnd && "rounded-lg bg-primary text-primary-foreground",
                !inside && !isStart && !isEnd && "rounded-lg hover:bg-accent",
                cell.isToday && !isStart && !isEnd && "rounded-lg ring-1 ring-inset ring-muted-foreground",
              )}
            >
              {cell.date.day}
            </button>
          );
        })}
      </div>
    </div>
  );
}
