"use client";

import { useMemo, useState, useTransition } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { buildCalendar, summarize, type CalendarCard, type CalendarPiece } from "@/lib/content/calendar";
import { NetworkBadges } from "./network-badge";
import { movePieceToDay } from "@/lib/actions/content-calendar";
import { drawerHref } from "@/lib/content/drawer-url";

/**
 * El calendario de contenido (F21).
 *
 * En la computadora, una grilla de mes. En el celular, agenda: una grilla de
 * 7 columnas en 390 px deja celdas de 50 px donde no entra ni el titulo, y
 * una lista por dia se lee.
 *
 * Una tarjeta por pieza por dia, con los iconos de sus redes. Lo tentativo va
 * con borde punteado: que algo tenga fecha no quiere decir que este agendado,
 * y confundirlos es creer que va a salir solo algo que no va a salir.
 */
export function ContentCalendar({
  pieces,
  timeZone,
  month,
  countMode,
  canPublish,
}: {
  pieces: CalendarPiece[];
  timeZone: string;
  /** "2026-10" */
  month: string;
  countMode: "pieces" | "publications";
  /** Arrastrar para cambiar la fecha es de quien puede programar. */
  canPublish: boolean;
}) {
  const router = useRouter();
  const params = useSearchParams();
  const [dragging, setDragging] = useState<CalendarCard | null>(null);
  const [moving, startMove] = useTransition();
  const [error, setError] = useState<string | null>(null);

  /**
   * Soltar una tarjeta en otro día cambia la fecha (C14).
   *
   * Conserva la HORA: mover del martes al jueves es "sale el jueves a la
   * misma hora", no "sale el jueves a las 00:00".
   */
  function dropOn(day: string) {
    const card = dragging;
    setDragging(null);
    setError(null);
    if (!card || card.day === day) return;

    startMove(async () => {
      const result = await movePieceToDay({ postId: card.pieceId, fromDay: card.day, toDay: day });
      if (!result.ok) setError(result.error);
      router.refresh();
    });
  }

  const cards = useMemo(() => buildCalendar(pieces, timeZone), [pieces, timeZone]);
  const summary = useMemo(() => summarize(cards, month), [cards, month]);

  const cardsByDay = useMemo(() => {
    const map = new Map<string, typeof cards>();
    for (const card of cards) {
      const list = map.get(card.day) ?? [];
      list.push(card);
      map.set(card.day, list);
    }
    return map;
  }, [cards]);

  const days = useMemo(() => monthGrid(month), [month]);

  // Hoy, en la zona del NEGOCIO y no en la del navegador: alguien que viaja
  // no tiene por qué ver resaltado el día equivocado.
  const today = useMemo(
    () =>
      new Intl.DateTimeFormat("en-CA", {
        timeZone,
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
      }).format(new Date()),
    [timeZone],
  );

  /** Abre la pieza en el drawer, sin perder el mes ni los filtros. */
  const pieceHref = (id: string) => drawerHref(new URLSearchParams(params.toString()), { kind: "piece", id });

  function goToMonth(delta: number) {
    const [y, m] = month.split("-").map(Number);
    const date = new Date(Date.UTC(y, m - 1 + delta, 1));
    const next = new URLSearchParams(params.toString());
    next.set("mes", `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, "0")}`);
    router.push(`/dashboard/content?${next.toString()}`);
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex flex-wrap items-center gap-3 px-4 pt-4 md:px-6">
        <div className="flex items-center gap-1">
          <button
            type="button"
            onClick={() => goToMonth(-1)}
            aria-label="Mes anterior"
            className="flex h-8 w-8 items-center justify-center rounded-lg border border-border hover:bg-accent"
          >
            <ChevronLeft className="h-4 w-4" aria-hidden />
          </button>
          <span className="min-w-36 text-center text-sm font-medium">{monthLabel(month)}</span>
          <button
            type="button"
            onClick={() => goToMonth(1)}
            aria-label="Mes siguiente"
            className="flex h-8 w-8 items-center justify-center rounded-lg border border-border hover:bg-accent"
          >
            <ChevronRight className="h-4 w-4" aria-hidden />
          </button>
        </div>

        <p className="text-xs text-muted-foreground">
          {summary.pieces} {summary.pieces === 1 ? "pieza nueva" : "piezas nuevas"} ·{" "}
          {summary.publications} {summary.publications === 1 ? "publicacion" : "publicaciones"}
          {summary.redistributions > 0 && ` · ${summary.redistributions} ↻`}
          <span className="ml-1 opacity-70">
            (contando {countMode === "pieces" ? "piezas" : "publicaciones"})
          </span>
        </p>
      </div>

      {error && (
        <p role="alert" className="mx-4 mt-2 rounded-lg bg-amber-500/10 p-2 text-xs text-amber-700 md:mx-6 dark:text-amber-300">
          {error}
        </p>
      )}

      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 px-4 pt-2 text-[11px] text-muted-foreground md:px-6">
        {(
          [
            ["tentative", "Fecha tentativa"],
            ["scheduled", "Programada"],
            ["published", "Publicada"],
            ["failed", "Falló"],
          ] as const
        ).map(([tone, label]) => (
          <span key={tone} className="flex items-center gap-1.5">
            <span className={`h-2.5 w-2.5 rounded-sm ${LEGEND[tone]}`} aria-hidden />
            {label}
          </span>
        ))}
        <span>↻ Redistribución</span>
      </div>

      {/* Escritorio: grilla del mes. */}
      <div className="hidden min-h-0 flex-1 overflow-auto p-4 md:block md:p-6">
        <div className="grid grid-cols-7 gap-px rounded-xl bg-border">
          {["Lun", "Mar", "Mie", "Jue", "Vie", "Sab", "Dom"].map((d) => (
            <div key={d} className="bg-card px-2 py-1 text-center text-xs text-muted-foreground">
              {d}
            </div>
          ))}
          {days.map((day) => (
            <div
              key={day.iso}
              onDragOver={(e) => canPublish && e.preventDefault()}
              onDrop={() => canPublish && dropOn(day.iso)}
              className={`min-h-24 bg-card p-1.5 ${day.inMonth ? "" : "opacity-40"} ${
                day.iso === today ? "ring-1 ring-inset ring-primary" : ""
              } ${dragging && canPublish ? "outline-dashed outline-1 outline-border" : ""}`}
            >
              <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
                <span className={day.iso === today ? "font-semibold text-primary" : ""}>
                  {day.number}
                </span>
                {/* El número del día cambia con "Contar": piezas nuevas o
                    publicaciones. Antes el control existía y no cambiaba
                    nada (C14). */}
                {countFor(cardsByDay.get(day.iso) ?? [], countMode) > 0 && (
                  <span className="rounded bg-muted px-1 text-[10px] font-medium">
                    {countFor(cardsByDay.get(day.iso) ?? [], countMode)}
                  </span>
                )}
              </span>
              <div className="mt-1 space-y-1">
                {(cardsByDay.get(day.iso) ?? []).map((card) => (
                  <DayCard
                    key={`${card.pieceId}-${card.day}`}
                    card={card}
                    href={pieceHref(card.pieceId)}
                    draggable={canPublish && !moving}
                    onDragStart={() => setDragging(card)}
                  />
                ))}
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Celular: agenda. */}
      <div className="min-h-0 flex-1 overflow-y-auto p-4 md:hidden">
        {[...cardsByDay.entries()]
          .filter(([day]) => day.startsWith(month))
          .sort(([a], [b]) => a.localeCompare(b))
          .map(([day, list]) => (
            <section key={day} className="mb-4">
              <h3 className="text-xs font-semibold text-muted-foreground">{dayLabel(day)}</h3>
              <div className="mt-1 space-y-1">
                {list.map((card) => (
                  <DayCard key={`${card.pieceId}-${card.day}`} card={card} href={pieceHref(card.pieceId)} />
                ))}
              </div>
            </section>
          ))}
        {cardsByDay.size === 0 && (
          <p className="py-10 text-center text-sm text-muted-foreground">
            Nada agendado este mes.
          </p>
        )}
      </div>
    </div>
  );
}

const TONES: Record<CalendarCard["tone"], string> = {
  tentative: "border-dashed border-border text-muted-foreground",
  scheduled: "border-blue-500/40 bg-blue-500/10",
  published: "border-emerald-500/40 bg-emerald-500/10",
  failed: "border-red-500/50 bg-red-500/10",
  mixed: "border-border bg-muted",
};

const LEGEND: Record<"tentative" | "scheduled" | "published" | "failed", string> = {
  tentative: "border border-dashed border-border",
  scheduled: "bg-blue-500/40",
  published: "bg-emerald-500/40",
  failed: "bg-red-500/50",
};

function DayCard({
  card,
  href,
  draggable,
  onDragStart,
}: {
  card: CalendarCard;
  /** El link que abre el drawer de la pieza (F96). */
  href: string;
  draggable?: boolean;
  onDragStart?: () => void;
}) {
  return (
    <Link
      href={href}
      scroll={false}
      data-card-id={`piece-${card.pieceId}`}
      draggable={draggable}
      onDragStart={onDragStart}
      className={`block rounded-md border px-1.5 py-1 text-[11px] leading-tight ${TONES[card.tone]}`}
      title={card.title}
    >
      <span className="flex items-start gap-1">
        <span className="font-medium tabular-nums opacity-80">{card.time}</span>
        <span className="line-clamp-2 font-medium">
          {card.redistribution && "↻ "}
          {card.title}
        </span>
      </span>
      <span className="mt-0.5 flex items-center gap-1 opacity-90">
        <NetworkBadges platforms={card.networks.map((n) => n.platform)} />
      </span>
    </Link>
  );
}

/** Cuántas cosas cuenta un día, según el control "Contar". */
function countFor(cards: CalendarCard[], mode: "pieces" | "publications"): number {
  return mode === "pieces"
    ? cards.filter((c) => !c.redistribution).length
    : cards.reduce((total, c) => total + c.networks.length, 0);
}

/** Los dias que se dibujan, arrancando el lunes de la primera semana. */
function monthGrid(month: string): Array<{ iso: string; number: number; inMonth: boolean }> {
  const [y, m] = month.split("-").map(Number);
  const first = new Date(Date.UTC(y, m - 1, 1));
  // getUTCDay: 0 es domingo. La semana empieza el lunes.
  const offset = (first.getUTCDay() + 6) % 7;
  const start = new Date(first.getTime() - offset * 86_400_000);

  return Array.from({ length: 42 }, (_, i) => {
    const date = new Date(start.getTime() + i * 86_400_000);
    return {
      iso: date.toISOString().slice(0, 10),
      number: date.getUTCDate(),
      inMonth: date.getUTCMonth() === m - 1,
    };
  });
}

function monthLabel(month: string): string {
  const [y, m] = month.split("-").map(Number);
  return new Intl.DateTimeFormat("es-AR", { month: "long", year: "numeric", timeZone: "UTC" })
    .format(new Date(Date.UTC(y, m - 1, 1)));
}

function dayLabel(iso: string): string {
  return new Intl.DateTimeFormat("es-AR", {
    weekday: "long",
    day: "numeric",
    month: "long",
    timeZone: "UTC",
  }).format(new Date(`${iso}T12:00:00Z`));
}
