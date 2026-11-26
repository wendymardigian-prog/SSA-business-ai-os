"use client";

/**
 * Las piezas de Google Calendar en el calendario de la Agenda (00510): el interruptor «Google», la tarjeta de un evento
 * y el chip del mes o de la franja «Todo el día». Distintas de las reuniones a simple vista: fondo del color del
 * calendario, sin borde de estado; lo «Disponible» más tenue y lo de otras personas, gris con rayas («Ocupado»).
 */
import type { CSSProperties, DragEvent } from "react";
import { RefreshCw } from "lucide-react";
import { googleTitle, type GooglePlaced } from "@/lib/google-calendar/agenda";
import { formatSlotLabel } from "@/lib/scheduling/booker/format";
import { cn } from "@/lib/utils";
import { clampStyle } from "@/lib/calendar/card-lines";
import { Tip } from "@/components/ui/tooltip";

/** El logo de Google Calendar como un cuadradito de color: sin marca ajena dibujada. */
function GoogleDot({ color }: { color: string | null }) {
  return <span aria-hidden className="h-2 w-2 shrink-0 rounded-sm" style={{ backgroundColor: color ?? "#4285f4" }} />;
}

/** Actualizar los eventos de Google (al lado de «Qué mostrar», con la capa prendida). */
export function GoogleRefresh({ refreshing, onRefresh, note }: { refreshing: boolean; onRefresh: () => void; note: string | null }) {
  return (
    <span className="flex items-center gap-1.5">
      <Tip asChild content="Actualizar los eventos de Google">
        <button
          type="button"
          onClick={onRefresh}
          disabled={refreshing}
          aria-label="Actualizar los eventos de Google"
          className="grid h-8 w-8 place-items-center rounded-md border border-border hover:bg-muted disabled:opacity-50"
        >
          <RefreshCw className={cn("h-3.5 w-3.5", refreshing && "animate-spin")} aria-hidden />
        </button>
      </Tip>
      {note && <span className="hidden text-[11px] text-muted-foreground lg:inline">{note}</span>}
    </span>
  );
}

export function GoogleToggle({
  on,
  onToggle,
  refreshing,
  onRefresh,
  note,
}: {
  on: boolean;
  onToggle: (on: boolean) => void;
  refreshing: boolean;
  onRefresh: () => void;
  /** Un aviso corto al lado (sin actualizar, falta la primera lectura). */
  note: string | null;
}) {
  return (
    <div className="flex items-center gap-1.5" role="group" aria-label="Google Calendar en el calendario">
      <button
        type="button"
        aria-pressed={on}
        onClick={() => onToggle(!on)}
        className={cn(
          "inline-flex items-center gap-1.5 rounded-md border px-2.5 py-1 text-xs font-medium",
          on ? "border-primary-edge bg-primary/10 text-foreground" : "border-border text-muted-foreground hover:bg-muted",
        )}
      >
        <GoogleDot color={null} /> Google
      </button>
      {on && (
        <Tip content="Actualizar los eventos de Google">
          <button
            type="button"
            onClick={onRefresh}
            disabled={refreshing}
            aria-label="Actualizar los eventos de Google"
            className="grid h-7 w-7 place-items-center rounded-md border border-border hover:bg-muted disabled:opacity-50"
          >
            <RefreshCw className={cn("h-3.5 w-3.5", refreshing && "animate-spin")} aria-hidden />
          </button>
        </Tip>
      )}
      {on && note && <span className="hidden text-[11px] text-muted-foreground lg:inline">{note}</span>}
    </div>
  );
}

const BUSY_STYLE: CSSProperties = {
  backgroundImage: "repeating-linear-gradient(135deg, transparent 0 6px, rgba(120,120,120,0.12) 6px 12px)",
};

/**
 * Lo que está solo en Google se ve en gris muy clarito, con letra gris: así se distingue enseguida de lo que está en el
 * sistema. El único color es el puntito del calendario. «Disponible», todavía más tenue y con borde punteado; el
 * «Ocupado» de otra persona, con rayas.
 */
function cardClasses(item: GooglePlaced): string {
  if (item.kind === "busy") return "border-dashed border-border bg-muted/40 text-muted-foreground";
  if (item.event.transparency === "transparent") return "border-dashed border-border bg-muted/20 text-muted-foreground";
  return "border-border bg-muted/50 text-muted-foreground";
}

/** Lo que se le pasa a un bloque para la tarjeta al pasar el mouse (de `useCalendarHover`). */
type HoverProps = Record<string, unknown>;

interface CardProps {
  item: GooglePlaced;
  timezone: string;
  timeFormat: "12h" | "24h";
  ownerName?: string;
  draggable: boolean;
  onOpen: (id: string) => void;
  onDragStart: (id: string, e: DragEvent<HTMLElement>) => void;
  onDragEnd: () => void;
  style?: CSSProperties;
  className?: string;
  /** Cuántas líneas de título entran en el alto del bloque. */
  lines?: number;
  hover?: HoverProps;
}

/** Un evento en la rejilla horaria. Los de otra persona no se abren. */
export function GoogleCard({ item, timezone, timeFormat, ownerName, draggable, onOpen, onDragStart, onDragEnd, style, className, lines = 1, hover }: CardProps) {
  const title = googleTitle(item, ownerName);
  const time = item.kind === "event" ? formatSlotLabel(item.event.startAt, timezone, timeFormat) : formatSlotLabel(item.busy.startAt, timezone, timeFormat);
  const common = cn("overflow-hidden rounded-md border px-1.5 py-1 text-left text-[11px] leading-[14px]", cardClasses(item), item.kind === "event" && "hover:ring-1 hover:ring-ring", className);
  const text = (
    <span className="min-w-0 flex-1 whitespace-normal break-words" style={clampStyle(lines)}>
      <span className="tabular-nums">{time}</span> <span className="font-medium">{title}</span>
    </span>
  );
  if (item.kind === "busy") {
    return (
      <div aria-label={`${title}, ${time}`} tabIndex={0} {...hover} style={{ ...BUSY_STYLE, ...style }} className={common}>
        <span className="flex items-start gap-1">{text}</span>
      </div>
    );
  }
  return (
    <button
      type="button"
      onClick={() => onOpen(item.event.id)}
      draggable={draggable || undefined}
      onDragStart={draggable ? (e) => onDragStart(item.event.id, e) : undefined}
      onDragEnd={draggable ? onDragEnd : undefined}
      aria-label={`${title}, ${time}, ${item.event.calendarName}`}
      {...hover}
      style={style}
      className={common}
    >
      <span className="flex items-start gap-1">
        <span className="mt-[3px] shrink-0">
          <GoogleDot color={item.event.calendarColor} />
        </span>
        {text}
      </span>
    </button>
  );
}

/** Un evento en una celda del mes o en la franja «Todo el día» (una línea). */
export function GoogleChip({
  item,
  timezone,
  timeFormat,
  ownerName,
  onOpen,
  hover,
}: {
  item: GooglePlaced;
  timezone: string;
  timeFormat: "12h" | "24h";
  ownerName?: string;
  onOpen: (id: string) => void;
  hover?: HoverProps;
}) {
  const title = googleTitle(item, ownerName);
  const time = item.timed ? `${formatSlotLabel(item.kind === "event" ? item.event.startAt : item.busy.startAt, timezone, timeFormat)} ` : "";
  const cls = cn("flex w-full items-center gap-1 truncate rounded border px-1.5 py-0.5 text-left text-[11px]", cardClasses(item));
  if (item.kind === "busy") {
    return (
      <span tabIndex={0} aria-label={`${time}${title}`} {...hover} style={BUSY_STYLE} className={cls}>
        <span className="truncate">
          {time}
          {title}
        </span>
      </span>
    );
  }
  return (
    <button type="button" onClick={() => onOpen(item.event.id)} aria-label={`${time}${title}, ${item.event.calendarName}`} {...hover} className={cn(cls, "hover:ring-1 hover:ring-ring")}>
      <GoogleDot color={item.event.calendarColor} />
      <span className="truncate">
        {time}
        {title}
      </span>
    </button>
  );
}
