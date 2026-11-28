"use client";

/**
 * La capa «Clases» del calendario de la Agenda: las clases en vivo del Portal que da cada persona, con el color de la
 * marca (fondo tenue, borde y letra del color de marca legibles en los dos temas). Solo de lectura: no se arrastran.
 * Un clic abre el link de la reunión (si la clase tiene uno); al pasar el mouse, el resumen.
 */
import type { CSSProperties, ReactNode } from "react";
import { GraduationCap } from "lucide-react";
import type { ClassPlaced } from "@/lib/scheduling/calendar-classes";
import { formatSlotLabel } from "@/lib/scheduling/booker/format";
import { clampStyle } from "@/lib/calendar/card-lines";
import { cn } from "@/lib/utils";

type HoverProps = Record<string, unknown>;

function Shell({ item, className, style, hover, children }: { item: ClassPlaced; className: string; style?: CSSProperties; hover: HoverProps; children: ReactNode }) {
  const label = `Clase en vivo: ${item.cls.title}`;
  const classes = cn("overflow-hidden rounded-md border border-primary-edge/40 border-l-2 border-l-primary-edge bg-primary/15 text-left text-primary-ink", className);
  if (item.cls.meetingUrl) {
    return (
      <a href={item.cls.meetingUrl} target="_blank" rel="noopener noreferrer" aria-label={`${label}. Entrar a la reunión`} data-cal-handle style={style} className={cn(classes, "hover:bg-primary/25")} {...hover}>
        {children}
      </a>
    );
  }
  return (
    <div tabIndex={0} role="note" aria-label={label} data-cal-handle style={style} className={classes} {...hover}>
      {children}
    </div>
  );
}

/** En la rejilla de semana o día. */
export function ClassCard({ item, timezone, timeFormat, style, className, lines, hover }: { item: ClassPlaced; timezone: string; timeFormat: "12h" | "24h"; style: CSSProperties; className: string; lines: number; hover: HoverProps }) {
  return (
    <Shell item={item} style={style} className={cn("px-1.5 py-1 text-[11px]", className)} hover={hover}>
      <span className="flex items-start gap-1">
        <GraduationCap className="mt-px h-3 w-3 shrink-0" aria-hidden />
        <span className="min-w-0 flex-1 whitespace-normal break-words font-medium leading-[14px]" style={clampStyle(lines)}>
          <span className="tabular-nums">{formatSlotLabel(item.cls.startAt, timezone, timeFormat)}</span> {item.cls.title}
        </span>
      </span>
    </Shell>
  );
}

/** En el mes y en la lista del celular. */
export function ClassChip({ item, timezone, timeFormat, hover, large = false }: { item: ClassPlaced; timezone: string; timeFormat: "12h" | "24h"; hover: HoverProps; large?: boolean }) {
  return (
    <Shell item={item} className={cn("flex w-full items-center gap-1", large ? "p-2 text-sm" : "px-1.5 py-0.5 text-[11px]")} hover={hover}>
      <GraduationCap className={cn("shrink-0", large ? "h-4 w-4" : "h-3 w-3")} aria-hidden />
      <span className="min-w-0 flex-1 truncate">
        <span className="tabular-nums">{formatSlotLabel(item.cls.startAt, timezone, timeFormat)}</span> {item.cls.title}
      </span>
    </Shell>
  );
}
