/**
 * Que se puede comparar de una reunion en un camino condicional
 * ("Condiciones"). PURO.
 *
 * Son las mismas variables que `{{booking.*}}` (`BOOKING_VARIABLE_KEYS`) y todas
 * se comparan como TEXTO: ya vienen formateadas para leerse ("12 de octubre de
 * 2026", "30 minutos"), asi que un "mayor que" sobre ellas no tendria sentido.
 * Las respuestas de la reserva (`booking.answers.<clave>`) no se
 * ofrecen: cambian por tipo de evento y hoy no hay una lista confiable.
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
  meet_url: "Link de la videollamada",
  host_name: "Quién atiende",
  reschedule_url: "Link para reagendar",
  cancel_url: "Link para cancelar",
  cancellation_reason: "Motivo de la cancelación",
  status: "Estado de la reunión",
};

export function bookingVariableSchema(): ConditionFieldSpec[] {
  return BOOKING_VARIABLE_KEYS.map((key) => ({ path: `booking.${key}`, label: LABELS[key], type: "text" as const, group: BOOKING_GROUP }));
}
