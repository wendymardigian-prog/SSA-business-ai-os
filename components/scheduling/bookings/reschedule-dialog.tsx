"use client";

/**
 * Reagendar una agenda arrastrandola (Tareas × CRM, R8): SIEMPRE con un modal de confirmacion. Soltar la agenda abre el
 * modal; nada se guarda hasta que la persona confirma. La maquina de estados es `dragConfirmReducer` (pura, con su test);
 * esto solo la conecta con `rescheduleAsHost`, sin tocarlo.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { ArrowRight, Loader2 } from "lucide-react";
import { rescheduleAsHost } from "@/lib/actions/scheduling/bookings";
import { formatDateTimeWithZone } from "@/lib/scheduling/booker/format";
import { dragConfirmReducer, rescheduleEffects, shouldCallAction, type BookingDrop, type DragConfirmEvent, type DragConfirmState } from "@/lib/scheduling/booking-drag";
import type { BookingListItem } from "@/lib/scheduling/data/bookings";
import type { BookingGhost } from "./calendar-grid";

const IDLE: DragConfirmState = { phase: "idle" };

export function useRescheduleDrag({ items, timezone, timeFormat }: { items: BookingListItem[]; timezone: string; timeFormat: "12h" | "24h" }) {
  const router = useRouter();
  const [state, setState] = useState<DragConfirmState>(IDLE);
  // El ultimo estado, para decidir fuera del render (y una sola vez, aunque React corra dos veces) si hay que llamar a la accion.
  const latest = useRef<DragConfirmState>(IDLE);

  const run = useCallback(
    async (next: Extract<DragConfirmState, { phase: "confirming" }>) => {
      const res = await rescheduleAsHost({
        bookingId: next.bookingId,
        startUtc: next.startUtc,
        ignoreAvailability: next.ignoreAvailability || undefined,
        reason: next.reason.trim() || null,
      });
      if (res.ok) {
        send({ type: "succeeded" });
        router.refresh();
        send({ type: "cancel" }); // cierra el modal: done -> idle
      } else {
        send({ type: "failed", error: res.error });
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [router],
  );

  function send(event: DragConfirmEvent) {
    const prev = latest.current;
    const next = dragConfirmReducer(prev, event);
    if (next === prev) return;
    latest.current = next;
    setState(next);
    // La accion se llama SOLO al entrar a «confirmando», que solo se alcanza desde «pendiente» (o un error) con una
    // confirmacion explicita.
    if (shouldCallAction(prev, next) && next.phase === "confirming") void run(next);
  }

  const booking = state.phase !== "idle" && state.phase !== "done" ? items.find((i) => i.id === state.bookingId) : undefined;

  const ghost: BookingGhost | null =
    booking && (state.phase === "pending" || state.phase === "confirming" || state.phase === "error")
      ? {
          bookingId: booking.id,
          startUtc: state.startUtc,
          durationMinutes: Math.max(5, Math.round((new Date(booking.endAt).getTime() - new Date(booking.startAt).getTime()) / 60_000)),
          label: `${booking.contactName || booking.bookerName || "Agenda"} · nuevo horario`,
        }
      : null;

  return {
    ghost,
    onDrop: (item: BookingListItem, drop: BookingDrop, startUtc: string) => send({ type: "drop", bookingId: item.id, drop, startUtc }),
    dialog:
      booking && (state.phase === "pending" || state.phase === "confirming" || state.phase === "error") ? (
        <RescheduleDialog booking={booking} state={state} timezone={timezone} timeFormat={timeFormat} send={send} />
      ) : null,
  };
}

function RescheduleDialog({
  booking,
  state,
  timezone,
  timeFormat,
  send,
}: {
  booking: BookingListItem;
  state: Extract<DragConfirmState, { phase: "pending" | "confirming" | "error" }>;
  timezone: string;
  timeFormat: "12h" | "24h";
  send: (event: DragConfirmEvent) => void;
}) {
  const busy = state.phase === "confirming";
  const error = state.phase === "error" ? state.error : null;
  const offerIgnore = state.phase === "error" && state.offerIgnore;
  const name = booking.contactName || booking.bookerName || "Sin nombre";

  // Esc cancela (menos con la llamada en vuelo).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") send({ type: "cancel" });
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [send]);

  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-black/40 p-4" onClick={() => send({ type: "cancel" })}>
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Reagendar la agenda"
        onClick={(e) => e.stopPropagation()}
        className="max-h-[90vh] w-full max-w-md overflow-y-auto rounded-2xl border border-border bg-card p-4"
      >
        <p className="font-medium">Reagendar la agenda</p>
        <p className="mt-1 text-sm text-muted-foreground">
          {name} · {booking.title}
        </p>

        <dl className="mt-3 space-y-1.5 rounded-lg border border-border bg-muted/40 p-3 text-sm">
          <div className="flex items-start gap-2">
            <dt className="w-8 shrink-0 text-xs font-medium text-muted-foreground">De:</dt>
            <dd>{formatDateTimeWithZone(booking.startAt, timezone, timeFormat)}</dd>
          </div>
          <div className="flex items-start gap-2">
            <dt className="w-8 shrink-0 text-xs font-medium text-muted-foreground">
              <ArrowRight className="h-3.5 w-3.5" aria-hidden />
              <span className="sr-only">A:</span>
            </dt>
            <dd className="font-medium">{formatDateTimeWithZone(state.startUtc, timezone, timeFormat)}</dd>
          </div>
        </dl>

        <label htmlFor="reschedule-reason" className="mt-3 block text-xs text-muted-foreground">
          Motivo (opcional)
        </label>
        <textarea
          id="reschedule-reason"
          value={state.reason}
          onChange={(e) => send({ type: "reason", value: e.target.value })}
          disabled={busy}
          rows={2}
          className="mt-1 w-full rounded-lg border border-input bg-background px-3 py-2 text-sm"
        />

        <div className="mt-3">
          <p className="text-xs font-medium text-muted-foreground">Qué va a pasar</p>
          <ul className="mt-1 list-disc space-y-0.5 pl-4 text-xs text-muted-foreground">
            {rescheduleEffects(booking.syncStatus).map((line) => (
              <li key={line}>{line}</li>
            ))}
          </ul>
        </div>

        {error && (
          <p role="alert" className="mt-3 rounded-lg border border-red-500/40 bg-red-500/10 p-2 text-sm text-red-700 dark:text-red-300">
            {error}
          </p>
        )}
        {offerIgnore && (
          <label className="mt-2 flex cursor-pointer items-start gap-2 text-sm">
            <input type="checkbox" checked={state.ignoreAvailability} onChange={(e) => send({ type: "ignoreAvailability", value: e.target.checked })} className="mt-0.5 h-4 w-4 accent-current" />
            <span>Reagendar igual (ignorar la disponibilidad)</span>
          </label>
        )}

        <div className="mt-4 flex justify-end gap-2">
          <button type="button" onClick={() => send({ type: "cancel" })} disabled={busy} className="rounded-lg border border-border px-3 py-1.5 text-sm hover:bg-muted disabled:opacity-50">
            Cancelar
          </button>
          <button
            type="button"
            onClick={() => send({ type: "confirm" })}
            disabled={busy || (state.phase === "error" && !offerIgnore) || (offerIgnore && !state.ignoreAvailability)}
            className="inline-flex items-center gap-2 rounded-lg bg-primary px-3 py-1.5 text-sm font-semibold text-primary-foreground disabled:opacity-60"
          >
            {busy && <Loader2 className="h-4 w-4 animate-spin" aria-hidden />}
            Confirmar
          </button>
        </div>
      </div>
    </div>
  );
}
