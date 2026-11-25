/**
 * Que se puede comparar de una reunion en un camino condicional
 * ("Condiciones"). PURO.
 *
 * Son las mismas variables que `{{booking.*}}` (`BOOKING_VARIABLE_KEYS`) y todas
 * se comparan como TEXTO (salvo `days_since_end`, que es un número): ya vienen formateadas para leerse ("12 de octubre de
 * 2026", "30 minutos"), asi que un "mayor que" sobre ellas no tendria sentido.
 * Las respuestas de la reserva (`booking.answers.<clave>`) salen de las preguntas de los eventos que elige el
 * disparador (o de todos los eventos del negocio, si no elige ninguno): `bookingAnswerSchema` (24/11/2026).
 */
import type { ConditionFieldSpec } from "@/lib/flow-engine/condition-eval";
import { BOOKING_VARIABLE_KEYS } from "./variables";

export const BOOKING_GROUP = "De la reunión";

const LABELS: Record<(typeof BOOKING_VARIABLE_KEYS)[number], string> = {
  event_title: "Título del evento",
  category_area: "Área de la reunión",
  category_type: "Tipo de la reunión",
  start_invitee: "Cuándo empieza (para el invitado)",
  start_host: "Cuándo empieza (para quien atiende)",
  date_invitee: "Fecha (para el invitado)",
  time_invitee: "Hora (para el invitado)",
  invitee_timezone: "Zona horaria del invitado",
  duration: "Duración",
  location: "Dónde es",
  meeting_place: "Dónde es, con el link si es un Meet",
  meet_url: "Link de la videollamada",
  host_name: "Quién atiende",
  reschedule_url: "Link para reagendar",
  cancel_url: "Link para cancelar",
  cancellation_reason: "Motivo de la cancelación",
  status: "Estado de la reunión",
  days_since_end: "Días desde que terminó la reunión",
};

/** Los días desde que terminó la reunión son un NÚMERO (se compara con «mayor que», «menor que»…); el resto, texto. */
const NUMBER_KEYS: ReadonlyArray<(typeof BOOKING_VARIABLE_KEYS)[number]> = ["days_since_end"];

export function bookingVariableSchema(): ConditionFieldSpec[] {
  return BOOKING_VARIABLE_KEYS.map((key) => ({
    path: `booking.${key}`,
    label: LABELS[key],
    type: NUMBER_KEYS.includes(key) ? ("number" as const) : ("text" as const),
    group: BOOKING_GROUP,
    ...(key === "days_since_end" ? { hint: "0 si la reunión todavía no terminó. Se cuenta al momento en que arranca la automatización." } : {}),
  }));
}

/** Lo que hace falta de un evento para ofrecer sus preguntas. */
export interface EventTypeFields {
  booking_fields: unknown;
}

/**
 * Las preguntas propias del formulario de la agenda (no nombre, email ni teléfono, que ya son del contacto), sin
 * repetir la misma clave entre eventos. La ruta es la real (`booking.answers.<clave>`); el selector la muestra con su
 * nombre nuevo (`booking.answer.<clave>`).
 */
export function bookingAnswerSchema(eventTypes: readonly EventTypeFields[]): ConditionFieldSpec[] {
  const out: ConditionFieldSpec[] = [];
  const seen = new Set<string>();
  for (const event of eventTypes) {
    const fields = Array.isArray(event.booking_fields) ? (event.booking_fields as Array<Record<string, unknown>>) : [];
    for (const field of fields) {
      const identifier = typeof field.identifier === "string" ? field.identifier : "";
      if (!identifier || field.system === true || seen.has(identifier)) continue;
      seen.add(identifier);
      const label = typeof field.label === "string" && field.label.trim() ? field.label.trim() : identifier;
      out.push({ path: `booking.answers.${identifier}`, label: `Respuesta: ${label}`, type: "text", group: BOOKING_GROUP });
    }
  }
  return out;
}
