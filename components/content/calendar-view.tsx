"use client";

import { useMemo } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { buildCalendar, summarize, type CalendarPiece } from "@/lib/content/calendar";

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
}: {
  pieces: CalendarPiece[];
  timeZone: string;
  /** "2026-10" */
  month: string;
  countMode: "pieces" | "publications";
}) {
  const router = useRouter();
  const params = useSearchParams();

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
              className={`min-h-24 bg-card p-1.5 ${day.inMonth ? "" : "opacity-40"}`}
            >
              <span className="text-xs text-muted-foreground">{day.number}</span>
              <div className="mt-1 space-y-1">
                {(cardsByDay.get(day.iso) ?? []).map((card) => (
                  <DayCard key={`${card.pieceId}-${card.day}`} card={card} />
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
                  <DayCard key={`${card.pieceId}-${card.day}`} card={card} />
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

function DayCard({ card }: { card: ReturnType<typeof buildCalendar>[number] }) {
  return (
    <Link
      href={`/dashboard/content/${card.pieceId}`}
      className={`block rounded-md px-1.5 py-1 text-[11px] leading-tight ${
        card.tentative
          ? "border border-dashed border-border text-muted-foreground"
          : "border border-transparent bg-muted"
      }`}
      title={card.title}
    >
      <span className="line-clamp-2 font-medium">
        {card.redistribution && "↻ "}
        {card.title}
      </span>
      <span className="mt-0.5 block truncate opacity-70">
        {card.networks.map((n) => n.platform).join(" · ")}
      </span>
    </Link>
  );
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
