/**
 * Los nueve triggers de agenda (F43, F44) y sus filtros, como funciones puras.
 *
 * El registro (`lib/flow-engine/registry/booking-triggers.ts`) los declara; la
 * lógica de "¿este evento le corresponde a este trigger?" vive acá para poder
 * probarla sin base ni cron.
 *
 * Los filtros se evalúan contra el SNAPSHOT de categoría de la agenda, no
 * contra la categoría actual: si mañana renombran o archivan una categoría, un
 * flujo que filtraba por ella sigue disparando para las agendas viejas, que es
 * lo que la persona esperaba cuando lo configuró.
 */

import type { BookingStatus, StatusGroup } from "../types";
import { groupOf, isBookingStatus } from "../booking-status";

/** Los nueve tipos, en el orden en que se ofrecen en el editor. */
export const BOOKING_TRIGGER_TYPES = [
  "booking_created",
  "booking_rescheduled",
  "booking_cancelled",
  "booking_updated",
  "booking_ended",
  "booking_status_changed",
  "booking_before_start",
  "booking_after_end",
  "booking_after_created",
] as const;

export type BookingTriggerType = (typeof BOOKING_TRIGGER_TYPES)[number];

export const BOOKING_TRIGGER_LABELS: Record<BookingTriggerType, string> = {
  booking_created: "Se agendó una reunión",
  booking_rescheduled: "Cambiaron la fecha",
  booking_cancelled: "Se canceló",
  booking_updated: "Se editó la reunión",
  booking_ended: "Terminó la reunión",
  booking_status_changed: "Cambió el estado",
  booking_before_start: "Antes de la reunión",
  booking_after_end: "Después de la reunión",
  booking_after_created: "Después de agendar",
};

/** Los tres que necesitan un job: se calculan contra la hora de la reunión. */
export const RELATIVE_TRIGGER_TYPES: BookingTriggerType[] = ["booking_before_start", "booking_after_end", "booking_after_created"];

export function isBookingTriggerType(value: unknown): value is BookingTriggerType {
  return typeof value === "string" && (BOOKING_TRIGGER_TYPES as readonly string[]).includes(value);
}

export function isRelativeTrigger(type: string): boolean {
  return (RELATIVE_TRIGGER_TYPES as string[]).includes(type);
}

/** Lo que el evento de automatización trae de la agenda. */
export interface BookingEventPayload {
  booking_id: string;
  event_type_id?: string | null;
  host_user_id?: string | null;
  origin?: string | null;
  by_whom?: string | null;
  from_status?: string | null;
  to_status?: string | null;
  [key: string]: unknown;
}

/** Los datos de la agenda que hacen falta para filtrar. */
export interface BookingForFilter {
  event_type_id: string;
  host_user_id: string;
  origin: string;
  status: BookingStatus;
  category_snapshot?: { area_id?: string | null; type_id?: string | null } | null;
}

/** La configuración del trigger, tal como la guarda el editor. */
export interface BookingTriggerConfig {
  /** Ids de área o de tipo. Un área incluye sus tipos. */
  category_ids?: string[] | null;
  event_type_ids?: string[] | null;
  host_user_ids?: string[] | null;
  /** `public_page`, `embed`, `manual`, `agent`, `api`. */
  origins?: string[] | null;
  /** Quién hizo la acción: `invitee`, `host`, `system`. */
  by_whom?: string[] | null;
  /** Solo para "cambió el estado". Vacío = cualquiera. */
  to_status?: string[] | null;
  from_status?: string[] | null;
  to_group?: StatusGroup[] | null;
  /** Para los relativos: minutos antes o después. Siempre positivo. */
  offset_minutes?: number | null;
}

function listMatches(allowed: string[] | null | undefined, actual: string | null | undefined): boolean {
  if (!allowed || allowed.length === 0) return true;
  return typeof actual === "string" && allowed.includes(actual);
}

/**
 * Los filtros comunes a todos los triggers de agenda: categoría, evento,
 * anfitrión y origen. Vacío quiere decir "cualquiera", nunca "ninguno".
 */
export function matchesCommonFilters(config: BookingTriggerConfig, booking: BookingForFilter): boolean {
  if (!listMatches(config.event_type_ids, booking.event_type_id)) return false;
  if (!listMatches(config.host_user_ids, booking.host_user_id)) return false;
  if (!listMatches(config.origins, booking.origin)) return false;

  if (config.category_ids && config.category_ids.length > 0) {
    const snap = booking.category_snapshot ?? null;
    const ids = [snap?.area_id, snap?.type_id].filter(Boolean) as string[];
    if (!ids.some((id) => config.category_ids!.includes(id))) return false;
  }
  return true;
}

/**
 * ¿Este evento le corresponde a este trigger?
 *
 * Los filtros propios de cada tipo (quién canceló, a qué estado pasó) se
 * evalúan sobre el payload del evento, no sobre la agenda: la agenda ya
 * cambió y el payload es lo que cuenta qué pasó.
 */
export function bookingEventMatches(
  triggerType: string,
  config: BookingTriggerConfig,
  payload: BookingEventPayload,
  booking: BookingForFilter,
): boolean {
  if (!matchesCommonFilters(config, booking)) return false;

  if (triggerType === "booking_cancelled" || triggerType === "booking_rescheduled") {
    if (!listMatches(config.by_whom, payload.by_whom)) return false;
  }

  if (triggerType === "booking_status_changed") {
    if (!listMatches(config.to_status, payload.to_status)) return false;
    if (!listMatches(config.from_status, payload.from_status)) return false;
    if (config.to_group && config.to_group.length > 0) {
      const to = payload.to_status;
      if (!isBookingStatus(to) || !config.to_group.includes(groupOf(to))) return false;
    }
  }

  return true;
}

/**
 * La clave de idempotencia del disparo.
 *
 * Lleva el número de reagendas: si la reunión se mueve, el recordatorio de
 * "24 h antes" tiene que volver a poder dispararse para la fecha nueva. Sin
 * eso, mover una reunión dejaba al invitado sin aviso.
 */
export function bookingDedupeKey(triggerType: string, bookingId: string, rescheduleCount = 0): string {
  return isRelativeTrigger(triggerType) ? `${triggerType}:${bookingId}:${rescheduleCount}` : `${triggerType}:${bookingId}`;
}

/**
 * Cuándo tiene que correr un trigger relativo, en UTC.
 *
 * `booking_before_start` resta de la hora de inicio; `booking_after_end` suma
 * a la de fin; `booking_after_created` suma a cuándo se agendó.
 */
export function relativeRunAt(
  triggerType: string,
  offsetMinutes: number,
  booking: { start_at: string; end_at: string; created_at: string },
): Date | null {
  const minutes = Math.abs(Math.round(offsetMinutes));
  switch (triggerType) {
    case "booking_before_start":
      return new Date(Date.parse(booking.start_at) - minutes * 60_000);
    case "booking_after_end":
      return new Date(Date.parse(booking.end_at) + minutes * 60_000);
    case "booking_after_created":
      return new Date(Date.parse(booking.created_at) + minutes * 60_000);
    default:
      return null;
  }
}

export interface PlannedJob {
  triggerId: string;
  triggerType: string;
  bookingId: string;
  runAt: string;
  dedupeKey: string;
}

export interface TriggerForPlanning {
  id: string;
  type: string;
  is_active: boolean;
  config: BookingTriggerConfig;
}

/**
 * Qué avisos relativos hay que agendar para una reunión (F44).
 *
 * Puro: recibe la agenda, los triggers activos y `now`, y devuelve la lista.
 * Un aviso cuya hora ya pasó NO se agenda: mandar "te recuerdo la reunión de
 * mañana" cuando la reunión fue ayer es peor que no mandar nada.
 */
export function planRelativeJobs(
  booking: BookingForFilter & { id: string; start_at: string; end_at: string; created_at: string; reschedule_count?: number },
  triggers: TriggerForPlanning[],
  now: Date = new Date(),
): PlannedJob[] {
  const out: PlannedJob[] = [];

  for (const trigger of triggers) {
    if (!trigger.is_active || !isRelativeTrigger(trigger.type)) continue;
    if (!matchesCommonFilters(trigger.config, booking)) continue;

    const offset = trigger.config.offset_minutes;
    if (typeof offset !== "number" || !Number.isFinite(offset)) continue;

    const runAt = relativeRunAt(trigger.type, offset, booking);
    if (!runAt || runAt.getTime() <= now.getTime()) continue;

    out.push({
      triggerId: trigger.id,
      triggerType: trigger.type,
      bookingId: booking.id,
      runAt: runAt.toISOString(),
      dedupeKey: bookingDedupeKey(trigger.type, booking.id, booking.reschedule_count ?? 0),
    });
  }

  return out.sort((a, b) => Date.parse(a.runAt) - Date.parse(b.runAt));
}

/** Las opciones de "cuánto antes / cuánto después" del editor (F44). */
export const OFFSET_OPTIONS: Array<{ minutes: number; label: string }> = [
  { minutes: 15, label: "15 minutos" },
  { minutes: 30, label: "30 minutos" },
  { minutes: 60, label: "1 hora" },
  { minutes: 120, label: "2 horas" },
  { minutes: 240, label: "4 horas" },
  { minutes: 1440, label: "1 día" },
  { minutes: 2880, label: "2 días" },
  { minutes: 10080, label: "1 semana" },
];

/** "24 horas antes de la reunión", para el resumen del editor. */
export function describeTrigger(type: string, config: BookingTriggerConfig): string {
  if (!isRelativeTrigger(type)) return BOOKING_TRIGGER_LABELS[type as BookingTriggerType] ?? type;
  const minutes = Math.abs(Math.round(config.offset_minutes ?? 0));
  const label = OFFSET_OPTIONS.find((o) => o.minutes === minutes)?.label ?? `${minutes} minutos`;
  switch (type) {
    case "booking_before_start":
      return `${label} antes de la reunión`;
    case "booking_after_end":
      return `${label} después de la reunión`;
    default:
      return `${label} después de agendar`;
  }
}
