"use client";

/**
 * El kanban de agendas (F34): una columna por estado, las once siempre.
 *
 * Se arrastra con HTML nativo, como el kanban de contenido: son tarjetas
 * simples y sumar una librería de arrastre sería pagar peso y errores de
 * teclado a cambio de nada. Y como allá, el movimiento se valida ANTES de
 * pedirlo al servidor (`evaluateDrop`, la misma función que usa la acción):
 * una tarjeta que se mueve y vuelve sola, sin explicación, parece un error.
 *
 * Para quien no arrastra, cada tarjeta se abre y el estado se cambia desde el
 * detalle. El arrastre nunca es el único camino.
 */

import { useState } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import type { BookingListItem } from "@/lib/scheduling/data/bookings";
import type { BookingStatus } from "@/lib/scheduling/types";
import { BOOKING_STATUSES, statusDef } from "@/lib/scheduling/booking-status";
import { groupForKanban, needsOutcome } from "@/lib/scheduling/bookings-view";
import { evaluateDrop, needsCancelModal, isDraggable, DEFAULT_COLLAPSED_COLUMNS } from "@/lib/scheduling/kanban";
import { capitalize, formatDateTimeWithZone } from "@/lib/scheduling/booker/format";
import { NeedsOutcomeChip } from "./status-chip";
import { statusDotClass } from "./status-chip";

export function BookingsKanban({
  items,
  timezone,
  timeFormat,
  now,
  canManage,
  onOpen,
  onMove,
  onCancelDrop,
}: {
  items: BookingListItem[];
  timezone: string;
  timeFormat: "12h" | "24h";
  now: Date;
  canManage: boolean;
  onOpen: (id: string) => void;
  onMove: (id: string, status: BookingStatus) => void;
  /** Soltar en una cancelación pide el motivo antes de hacer nada. */
  onCancelDrop: (id: string, status: BookingStatus) => void;
}) {
  const [collapsed, setCollapsed] = useState<Set<BookingStatus>>(new Set(DEFAULT_COLLAPSED_COLUMNS));
  const [dragging, setDragging] = useState<BookingListItem | null>(null);
  const [problem, setProblem] = useState<string | null>(null);

  const columns = groupForKanban(items.map((i) => ({ ...i, status: i.status, start_at: i.startAt })));

  const toggle = (status: BookingStatus) =>
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(status)) next.delete(status);
      else next.add(status);
      return next;
    });

  function drop(to: BookingStatus) {
    const item = dragging;
    setDragging(null);
    if (!item) return;
    const verdict = evaluateDrop({ status: item.status, start_at: item.startAt }, to, now);
    if (!verdict.ok) {
      // `evaluateDrop` ya devuelve el motivo en palabras.
      setProblem(verdict.reason);
      return;
    }
    setProblem(null);
    if (needsCancelModal(to)) onCancelDrop(item.id, to);
    else onMove(item.id, to);
  }

  return (
    <div className="flex flex-col gap-3">
      {problem && (
        <p role="alert" className="rounded-lg border border-amber-500/40 bg-amber-500/10 p-3 text-sm text-amber-700 dark:text-amber-300">
          {problem}
        </p>
      )}

      <div className="flex gap-3 overflow-x-auto pb-2">
        {columns.map(({ status, bookings }) => {
          const def = statusDef(status);
          if (collapsed.has(status)) {
            return (
              <button
                key={status}
                type="button"
                onClick={() => toggle(status)}
                title={`Mostrar ${def.label}`}
                className="flex w-11 shrink-0 flex-col items-center gap-2 rounded-xl border border-border bg-muted/40 py-3 text-xs text-muted-foreground hover:bg-muted"
              >
                <span aria-hidden className={`h-2 w-2 rounded-full ${statusDotClass(status)}`} />
                <span className="[writing-mode:vertical-rl] whitespace-nowrap">{def.label}</span>
                <span className="tabular-nums">{bookings.length}</span>
                <ChevronRight className="h-3.5 w-3.5" aria-hidden />
              </button>
            );
          }
          return (
            <div
              key={status}
              onDragOver={(e) => {
                if (dragging) e.preventDefault();
              }}
              onDrop={() => drop(status)}
              className="flex w-64 shrink-0 flex-col gap-2 rounded-xl border border-border bg-muted/40 p-2.5"
            >
              <h3 className="flex items-center justify-between px-1 text-xs font-medium uppercase tracking-wide text-muted-foreground">
                <span className="flex items-center gap-1.5">
                  <span aria-hidden className={`h-2 w-2 rounded-full ${statusDotClass(status)}`} />
                  {def.label}
                </span>
                <span className="flex items-center gap-1">
                  <span className="tabular-nums">{bookings.length}</span>
                  <button type="button" onClick={() => toggle(status)} aria-label={`Contraer ${def.label}`} className="rounded p-0.5 hover:bg-muted">
                    <ChevronLeft className="h-3.5 w-3.5" />
                  </button>
                </span>
              </h3>

              {bookings.length === 0 && <p className="px-1 py-4 text-center text-xs text-muted-foreground">Vacío</p>}

              {bookings.map((b) => {
                const item = b as unknown as BookingListItem;
                const draggable = canManage && isDraggable({ status: item.status });
                return (
                  <button
                    key={item.id}
                    type="button"
                    draggable={draggable}
                    onDragStart={() => setDragging(item)}
                    onDragEnd={() => setDragging(null)}
                    onClick={() => onOpen(item.id)}
                    className="flex w-full flex-col gap-1.5 rounded-lg border border-border bg-card p-2.5 text-left text-sm hover:border-ring"
                  >
                    <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
                      <span aria-hidden className="h-2 w-2 shrink-0 rounded-full" style={{ background: item.eventColor ?? "currentColor" }} />
                      {item.title}
                    </span>
                    <span className="font-medium">{item.contactName || item.bookerName || "Sin nombre"}</span>
                    <span className="text-xs tabular-nums text-muted-foreground">
                      {capitalize(formatDateTimeWithZone(item.startAt, timezone, timeFormat))}
                    </span>
                    {needsOutcome({ status: item.status, end_at: item.endAt }, now) && <NeedsOutcomeChip />}
                  </button>
                );
              })}
            </div>
          );
        })}
      </div>

      <p className="rounded-lg border border-border p-3 text-xs text-muted-foreground">
        Arrastrá una tarjeta para cambiar su estado. No-show y los resultados se cargan <strong>después de la hora de inicio</strong>; soltar en una
        cancelación pide confirmación. Las columnas se contraen con ‹ y las de cancelación empiezan contraídas.
      </p>
      <span className="sr-only">{BOOKING_STATUSES.length} columnas</span>
    </div>
  );
}
