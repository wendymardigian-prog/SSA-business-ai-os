// Adaptado de Cal.diy (https://github.com/calcom/cal.diy), MIT License, Copyright (c) 2020-present Cal.com, Inc.
/**
 * Eventos entre el booker (adentro del iframe) y la página del cliente
 * (F41). Adaptado de `sdk-action-manager.ts` de Cal.diy, reducido a los
 * cinco eventos del plano más los dos internos (cargó, cambió la altura).
 *
 * Seguridad: los mensajes nunca llevan datos del formulario. El iframe
 * valida el origen de los mensajes entrantes y la página valida el origen de
 * los salientes con `isTrustedOrigin`.
 */
import type { Booking } from "@/lib/scheduling/types";

export const EMBED_MESSAGE_SOURCE = "ssa-embed";

/** Eventos públicos, escuchables con `SSA("on", {action, callback})`. */
export const EMBED_EVENTS = [
  "ssa:bookerReady",
  "ssa:slotSelected",
  "ssa:bookingSuccessful",
  "ssa:rescheduleSuccessful",
  "ssa:bookingCancelled",
] as const;
export type EmbedEventName = (typeof EMBED_EVENTS)[number];

/** Eventos internos del protocolo (no se exponen con `on`). */
export const EMBED_INTERNAL_EVENTS = ["ssa:loaded", "ssa:height", "ssa:ui"] as const;
export type EmbedInternalEventName = (typeof EMBED_INTERNAL_EVENTS)[number];

export type EmbedMessageType = EmbedEventName | EmbedInternalEventName;

export interface BookingEventPayload {
  uid: string;
  startTime: string;
  endTime: string;
  eventSlug: string;
  meetUrl?: string;
}

export interface EmbedMessage<T = unknown> {
  source: typeof EMBED_MESSAGE_SOURCE;
  type: EmbedMessageType;
  namespace: string;
  payload: T;
}

export function isEmbedEventName(value: unknown): value is EmbedEventName {
  return typeof value === "string" && (EMBED_EVENTS as readonly string[]).includes(value);
}

/**
 * Lo único que viaja de una agenda: uid, inicio, fin, slug del evento y el
 * Meet si ya está. Nunca email, teléfono ni respuestas.
 */
export function serializeEmbedEvent(
  name: "ssa:bookingSuccessful" | "ssa:rescheduleSuccessful" | "ssa:bookingCancelled",
  booking: Pick<Booking, "uid" | "start_at" | "end_at"> & { meet_url?: string | null },
  eventSlug: string,
): { type: typeof name; payload: BookingEventPayload } {
  const payload: BookingEventPayload = {
    uid: booking.uid,
    startTime: booking.start_at,
    endTime: booking.end_at,
    eventSlug,
  };
  if (booking.meet_url) payload.meetUrl = booking.meet_url;
  return { type: name, payload };
}

export function embedMessage<T>(type: EmbedMessageType, payload: T, namespace = ""): EmbedMessage<T> {
  return { source: EMBED_MESSAGE_SOURCE, type, namespace, payload };
}

/** Lee un `MessageEvent.data` y devuelve el mensaje si es nuestro; null si no. */
export function parseEmbedMessage(data: unknown): EmbedMessage | null {
  if (typeof data !== "object" || data === null) return null;
  const d = data as Record<string, unknown>;
  if (d.source !== EMBED_MESSAGE_SOURCE || typeof d.type !== "string") return null;
  const all: readonly string[] = [...EMBED_EVENTS, ...EMBED_INTERNAL_EVENTS];
  if (!all.includes(d.type)) return null;
  return {
    source: EMBED_MESSAGE_SOURCE,
    type: d.type as EmbedMessageType,
    namespace: typeof d.namespace === "string" ? d.namespace : "",
    payload: d.payload,
  };
}

/** Compara orígenes (esquema + host + puerto), tolerando una barra final. */
export function isTrustedOrigin(origin: string, allowed: string | string[]): boolean {
  const list = Array.isArray(allowed) ? allowed : [allowed];
  let o: string;
  try {
    o = new URL(origin).origin;
  } catch {
    return false;
  }
  return list.some((a) => {
    try {
      return new URL(a).origin === o;
    } catch {
      return false;
    }
  });
}
