// Adaptado de Cal.diy (https://github.com/calcom/cal.diy), MIT License, Copyright (c) 2020-present Cal.com, Inc.
"use client";

/**
 * El booker (F25). Adaptado de `apps/web/modules/bookings/components/Booker`:
 * se quita la store de zustand (30+ campos para layouts, asientos y equipos
 * que no usamos) y queda un `useReducer` con lo que hay: zona, mes, dia,
 * horario y paso.
 *
 * Tres columnas en escritorio (evento | calendario | horarios) y una sola
 * columna apilada en el celular, como el prototipo.
 *
 * Reagendar usa el MISMO componente: cambia que manda a otra ruta y que el
 * horario propio no cuenta como ocupado (eso lo resuelve el servidor).
 */

import { useCallback, useEffect, useMemo, useReducer, useState } from "react";
import { useRouter } from "next/navigation";
import type { Slot, SlotsByDate, UnavailableKey } from "@/lib/scheduling/types";
import type { EmbedParams } from "@/lib/scheduling/booker/embed-params";
import { addMonths, buildMonthView, daysInMonth, monthOf } from "@/lib/scheduling/booker/month-view";
import { getViewerTimezone } from "@/lib/scheduling/viewer-timezone";
import { capitalize, formatSlotSummary } from "@/lib/scheduling/booker/format";
import { countryFromTimezone } from "@/lib/scheduling/phone-countries";
import type { BookerEvent } from "./types";
import { EventMeta } from "./event-meta";
import { DatePicker } from "./date-picker";
import { AvailableTimeSlots } from "./available-time-slots";
import { BookForm, type BookFormValues } from "./book-form";
import { UnavailableState } from "./states";
import { useEmbedBridge } from "./use-embed-bridge";

type Step = "pick" | "form";

interface State {
  timezone: string;
  month: string;
  slots: SlotsByDate;
  /** Los meses ya consultados: no se vuelven a pedir. */
  fetched: string[];
  selectedDate: string | null;
  selectedSlot: Slot | null;
  step: Step;
  loading: boolean;
  submitting: boolean;
  unavailable: UnavailableKey | null;
  error: string | null;
  fieldErrors: Record<string, string>;
}

type Action =
  | { type: "timezone"; timezone: string }
  | { type: "month"; month: string }
  | { type: "loading" }
  | { type: "slots"; month: string; slots: SlotsByDate }
  | { type: "unavailable"; which: UnavailableKey }
  | { type: "pickDate"; date: string }
  | { type: "pickSlot"; slot: Slot }
  | { type: "back" }
  | { type: "submitting" }
  | { type: "failed"; message: string | null; fields?: Record<string, string> }
  | { type: "retry" };

function reducer(state: State, action: Action): State {
  switch (action.type) {
    case "timezone":
      // Cambiar de zona no cambia los momentos, pero sí en qué día caen.
      return { ...state, timezone: action.timezone, slots: {}, fetched: [], selectedDate: null, selectedSlot: null, step: "pick", loading: true };
    case "month":
      return { ...state, month: action.month, selectedDate: null, selectedSlot: null, loading: !state.fetched.includes(action.month) };
    case "loading":
      return { ...state, loading: true, unavailable: null };
    case "slots":
      return {
        ...state,
        slots: { ...state.slots, ...action.slots },
        fetched: state.fetched.includes(action.month) ? state.fetched : [...state.fetched, action.month],
        loading: false,
        unavailable: null,
      };
    case "unavailable":
      return { ...state, loading: false, unavailable: action.which };
    case "pickDate":
      return { ...state, selectedDate: action.date, selectedSlot: null };
    case "pickSlot":
      return { ...state, selectedSlot: action.slot, step: "form", error: null, fieldErrors: {} };
    case "back":
      return { ...state, step: "pick", selectedSlot: null, error: null, fieldErrors: {} };
    case "submitting":
      return { ...state, submitting: true, error: null, fieldErrors: {} };
    case "failed":
      return { ...state, submitting: false, error: action.message, fieldErrors: action.fields ?? {} };
    case "retry":
      return { ...state, slots: {}, fetched: [], unavailable: null, loading: true };
    default:
      return state;
  }
}

/** El rango que se pide para un mes: desde hoy si es el mes actual. */
function monthRange(month: string, now = new Date()) {
  const [year, m] = month.split("-").map(Number);
  const firstOfMonth = new Date(Date.UTC(year, m - 1, 1));
  const last = new Date(Date.UTC(year, m - 1, daysInMonth(month), 23, 59, 59));
  const from = firstOfMonth.getTime() < now.getTime() ? new Date(now.getTime() - 24 * 60 * 60 * 1000) : firstOfMonth;
  return { from: from.toISOString(), to: last.toISOString() };
}

export function Booker({
  username,
  slug,
  event,
  initialTimezone,
  initialMonth,
  initialSlots,
  initialUnavailable,
  embed,
  /** Si viene, la pagina reagenda esa agenda en vez de crear una nueva (F28). */
  rescheduleUid,
}: {
  username: string;
  slug: string;
  event: BookerEvent;
  initialTimezone: string;
  initialMonth: string;
  initialSlots: SlotsByDate;
  initialUnavailable: UnavailableKey | null;
  embed: EmbedParams;
  rescheduleUid?: string;
}) {
  const router = useRouter();
  const [forcedUi, setForcedUi] = useState<{ theme?: string; brandColor?: string }>({});
  // Solo hace algo dentro de un iframe: avisa que cargó, manda la altura y
  // emite los eventos que la página del cliente puede escuchar.
  const bridge = useEmbedBridge(embed.embed, setForcedUi);
  const [state, dispatch] = useReducer(reducer, {
    timezone: initialTimezone,
    month: embed.month ?? (embed.date ? monthOf(embed.date) : initialMonth),
    slots: initialSlots,
    fetched: initialUnavailable ? [] : [initialMonth],
    selectedDate: embed.date ?? null,
    selectedSlot: null,
    step: "pick",
    loading: false,
    submitting: false,
    unavailable: initialUnavailable,
    error: null,
    fieldErrors: {},
  } satisfies State);

  // La zona del navegador gana sobre la que vino del servidor, salvo que el
  // embed haya pedido una fija.
  useEffect(() => {
    if (embed.timezone) return;
    const browser = (() => {
      try {
        return Intl.DateTimeFormat().resolvedOptions().timeZone;
      } catch {
        return null;
      }
    })();
    const viewer = getViewerTimezone({ browserTimezone: browser, workspaceTimezone: initialTimezone });
    if (viewer && viewer !== initialTimezone) dispatch({ type: "timezone", timezone: viewer });
  }, [embed.timezone, initialTimezone]);

  const fetchMonth = useCallback(
    async (month: string, timezone: string) => {
      const { from, to } = monthRange(month);
      const params = new URLSearchParams({ user: username, event: slug, from, to, tz: timezone });
      try {
        const res = await fetch(`/api/public/scheduling/slots?${params}`, { cache: "no-store" });
        if (!res.ok) {
          dispatch({ type: "unavailable", which: "load_error" });
          return;
        }
        const body = (await res.json()) as { slots?: SlotsByDate; unavailableReason?: string };
        if (body.unavailableReason) {
          dispatch({ type: "unavailable", which: "unavailable" });
          return;
        }
        dispatch({ type: "slots", month, slots: body.slots ?? {} });
      } catch {
        dispatch({ type: "unavailable", which: "load_error" });
      }
    },
    [slug, username],
  );

  // Pide el mes cuando hace falta: al cambiar de mes, de zona o al reintentar.
  useEffect(() => {
    if (state.fetched.includes(state.month) || state.unavailable) return;
    void fetchMonth(state.month, state.timezone);
  }, [fetchMonth, state.fetched, state.month, state.timezone, state.unavailable]);

  const view = useMemo(() => buildMonthView(state.slots, state.month, state.timezone), [state.month, state.slots, state.timezone]);

  const daySlots = state.selectedDate ? state.slots[state.selectedDate] ?? [] : [];

  async function submit(values: BookFormValues) {
    if (!state.selectedSlot) return;
    dispatch({ type: "submitting" });

    const endpoint = rescheduleUid
      ? `/api/public/scheduling/bookings/${encodeURIComponent(rescheduleUid)}/reschedule`
      : "/api/public/scheduling/bookings";
    const payload = rescheduleUid
      ? { startUtc: state.selectedSlot.startUtc }
      : {
          user: username,
          event: slug,
          startUtc: state.selectedSlot.startUtc,
          timezone: state.timezone,
          responses: values.responses,
          website: values.honeypot,
          embed: embed.embed ? "1" : null,
          utm: { ...embed.utm, ...embed.clickIds },
          referrer: typeof document !== "undefined" ? document.referrer || null : null,
          // La página donde se reservó (Agenda v2): en el embed, la página del
          // cliente donde vive el widget (`embed.landingPage`, la manda el
          // script); en la página pública directa, ella misma.
          landingPage: embed.landingPage ?? (typeof window !== "undefined" ? window.location.href : null),
        };

    try {
      const res = await fetch(endpoint, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(payload),
      });
      const body = (await res.json()) as { uid?: string; redirectUrl?: string | null; message?: string; fields?: Record<string, string>; reason?: string };

      if (!res.ok) {
        dispatch({ type: "failed", message: body.message ?? messageFor(body.reason), fields: body.fields });
        // Si el horario se ocupó, los horarios que se ven ya no sirven.
        if (body.reason === "slot_taken" || body.reason === "slot_unavailable") dispatch({ type: "retry" });
        return;
      }

      bridge.emit(rescheduleUid ? "agenda:rescheduleSuccessful" : "agenda:bookingSuccessful", {
        // Nunca datos del formulario: solo el código público y el rango.
        uid: body.uid ?? rescheduleUid,
        startTime: state.selectedSlot.startUtc,
        endTime: new Date(new Date(state.selectedSlot.startUtc).getTime() + event.durationMinutes * 60_000).toISOString(),
        eventSlug: slug,
      });

      if (body.redirectUrl) {
        window.location.href = body.redirectUrl;
        return;
      }
      router.push(`/calendario/agenda/${body.uid ?? rescheduleUid}`);
    } catch {
      dispatch({ type: "failed", message: "No pude agendar. Probá de nuevo en un momento." });
    }
  }

  // El padre puede cambiar el tema y el color en vivo con `Agenda("ui", …)`.
  const theme = (forcedUi.theme as typeof embed.theme | undefined) ?? embed.theme;
  const themeAttr = theme === "auto" ? undefined : theme;
  const brandColor = forcedUi.brandColor ?? embed.color;
  const shell = embed.embed ? "p-0" : "mx-auto w-full max-w-5xl px-4 py-6 md:py-10";

  return (
    /*
     * `bg-background text-foreground` van acá y no solo en el layout: con un
     * tema forzado (`?theme=`), el color del texto lo hereda del body, que
     * sigue el tema del navegador. Sin esto, un booker claro dentro de un
     * navegador oscuro queda con el título blanco sobre blanco.
     */
    <div
      data-theme={themeAttr}
      className={`min-h-dvh bg-background text-foreground ${shell}`}
      style={brandColor ? ({ "--primary": brandColor, "--color-primary": brandColor } as React.CSSProperties) : undefined}
    >
      <div className="overflow-hidden rounded-2xl border border-border bg-card md:grid md:grid-cols-[280px_minmax(0,1fr)_240px]">
        <EventMeta
          event={event}
          timezone={state.timezone}
          onTimezoneChange={(tz) => dispatch({ type: "timezone", timezone: tz })}
          compact={embed.hideEventTypeDetails}
        />

        {state.unavailable ? (
          <div className="md:col-span-2">
            <UnavailableState
              messages={event.unavailableMessages}
              which={state.unavailable}
              eventTitle={event.title}
              hostName={event.hostName}
              onRetry={() => dispatch({ type: "retry" })}
            />
          </div>
        ) : state.step === "form" && state.selectedSlot && rescheduleUid ? (
          <div className="md:col-span-2">
            <RescheduleConfirm
              slot={state.selectedSlot}
              timezone={state.timezone}
              timeFormat={event.timeFormat}
              submitting={state.submitting}
              error={state.error}
              onBack={() => dispatch({ type: "back" })}
              onConfirm={() => void submit({ responses: {}, honeypot: "" })}
            />
          </div>
        ) : state.step === "form" && state.selectedSlot ? (
          <div className="md:col-span-2">
            <BookForm
              fields={event.fields}
              slot={state.selectedSlot}
              timezone={state.timezone}
              timeFormat={event.timeFormat}
              prefill={embed.prefill}
              defaultCountry={countryFromTimezone(state.timezone) ?? "CR"}
              submitting={state.submitting}
              error={state.error}
              fieldErrors={state.fieldErrors}
              onBack={() => dispatch({ type: "back" })}
              onSubmit={submit}
            />
          </div>
        ) : !state.loading && !view.hasAnySlots && state.fetched.length > 0 ? (
          <div className="md:col-span-2">
            <UnavailableState messages={event.unavailableMessages} which="no_slots" eventTitle={event.title} hostName={event.hostName} />
          </div>
        ) : (
          <>
            <div className="p-5">
              <DatePicker
                view={view}
                selected={state.selectedDate}
                onSelect={(date) => dispatch({ type: "pickDate", date })}
                onMonthChange={(month) => dispatch({ type: "month", month })}
                loading={state.loading}
              />
              <MonthNav month={state.month} onChange={(m) => dispatch({ type: "month", month: m })} loading={state.loading} />
            </div>
            <AvailableTimeSlots
              date={state.selectedDate}
              slots={daySlots}
              timezone={state.timezone}
              timeFormat={event.timeFormat}
              onPick={(slot) => {
                bridge.emit("agenda:slotSelected", { startTime: slot.startUtc, endTime: slot.endUtc, eventSlug: slug });
                dispatch({ type: "pickSlot", slot });
              }}
              loading={state.loading}
            />
          </>
        )}
      </div>
    </div>
  );
}

/**
 * Las flechas del calendario saltan al mes siguiente CON horarios; esto
 * permite igualmente mirar el mes de al lado, aunque esté vacío.
 */
function MonthNav({ month, onChange, loading }: { month: string; onChange: (month: string) => void; loading: boolean }) {
  const thisMonth = monthOf(new Date().toISOString().slice(0, 10));
  return (
    <div className="mt-3 flex items-center justify-between text-xs text-muted-foreground">
      <button
        type="button"
        disabled={loading || month <= thisMonth}
        onClick={() => onChange(addMonths(month, -1))}
        className="rounded px-2 py-1 hover:bg-muted disabled:opacity-40"
      >
        ‹ Mes anterior
      </button>
      <button type="button" disabled={loading} onClick={() => onChange(addMonths(month, 1))} className="rounded px-2 py-1 hover:bg-muted disabled:opacity-40">
        Mes siguiente ›
      </button>
    </div>
  );
}

/**
 * Reagendar no vuelve a pedir el formulario: los datos del invitado ya estan.
 * Solo se confirma el horario nuevo.
 */
function RescheduleConfirm({
  slot,
  timezone,
  timeFormat,
  submitting,
  error,
  onBack,
  onConfirm,
}: {
  slot: Slot;
  timezone: string;
  timeFormat: "12h" | "24h";
  submitting: boolean;
  error: string | null;
  onBack: () => void;
  onConfirm: () => void;
}) {
  return (
    <div className="flex flex-col gap-3 p-5">
      <p className="text-sm text-muted-foreground">La reunión queda:</p>
      <p className="text-base font-semibold tabular-nums">{capitalize(formatSlotSummary(slot.startUtc, slot.endUtc, timezone, timeFormat))}</p>
      {error && (
        <p role="alert" className="rounded-lg border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive">
          {error}
        </p>
      )}
      <div className="mt-1 flex gap-2">
        <button type="button" onClick={onBack} className="rounded-lg border border-border px-4 py-2 text-sm font-medium hover:bg-muted">
          Atrás
        </button>
        <button
          type="button"
          onClick={onConfirm}
          disabled={submitting}
          className="rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground hover:opacity-90 disabled:opacity-60"
        >
          {submitting ? "Cambiando…" : "Confirmar el cambio"}
        </button>
      </div>
    </div>
  );
}

function messageFor(reason: string | undefined): string {
  switch (reason) {
    case "slot_taken":
      return "Ese horario se acaba de ocupar. Elegí otro.";
    case "slot_unavailable":
      return "Ese horario ya no está disponible. Elegí otro.";
    case "rate_limited":
      return "Demasiados intentos. Probá de nuevo en un rato.";
    case "temporarily_unavailable":
      return "No pude confirmar la agenda ahora. Probá de nuevo en un momento.";
    default:
      return "Revisá los datos e intentá de nuevo.";
  }
}
