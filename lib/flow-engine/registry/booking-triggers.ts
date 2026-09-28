/**
 * Los nueve triggers de agenda en el registro (F43, F44).
 *
 * Acá solo se declaran: qué evento atiende cada uno, cómo se filtra y cuál es
 * su clave de idempotencia. Las reglas viven en
 * `lib/scheduling/automation/triggers.ts`, puras y con sus tests.
 *
 * Los tres relativos (`booking_before_start`, `booking_after_end`,
 * `booking_after_created`) no nacen de un evento del momento: los agenda un
 * job cuando la agenda se crea o se mueve, y ese job emite el evento con el
 * mismo nombre del trigger. Por eso también figuran acá con `eventTypes`.
 */

import { registerTrigger } from "./registry";
import type { TriggerEventArgs } from "./types";
import {
  BOOKING_TRIGGER_LABELS,
  BOOKING_TRIGGER_TYPES,
  bookingDedupeKey,
  bookingEventMatches,
  isRelativeTrigger,
  type BookingForFilter,
  type BookingTriggerConfig,
} from "@/lib/scheduling/automation/triggers";

/** La agenda que llega en `args.booking`, adaptada a lo que los filtros piden. */
function bookingForFilter(args: TriggerEventArgs): BookingForFilter | null {
  const b = args.booking;
  if (!b) return null;
  return {
    event_type_id: String(b.event_type_id ?? ""),
    host_user_id: String(b.host_user_id ?? ""),
    origin: String(b.origin ?? ""),
    status: b.status as BookingForFilter["status"],
    category_snapshot: (b.category_snapshot ?? null) as BookingForFilter["category_snapshot"],
  };
}

for (const type of BOOKING_TRIGGER_TYPES) {
  registerTrigger({
    type,
    label: BOOKING_TRIGGER_LABELS[type],
    // Los relativos los agenda un job; el resto nace de un evento. Los dos
    // casos terminan pasando por la cola de `automation_events`.
    scope: isRelativeTrigger(type) ? "scheduled" : "event",
    // Debajo de `crm_event` (50) a propósito: si algún día un evento de agenda
    // también encajara en uno del CRM, primero corre el específico.
    priority: 45,
    eventTypes: [type],

    eventMatches: (args) => {
      const booking = bookingForFilter(args);
      // Sin la agenda no se puede filtrar, y disparar "por las dudas" mandaría
      // mensajes que la persona no configuró. Se descarta.
      if (!booking) return false;
      return bookingEventMatches(
        type,
        (args.config ?? {}) as BookingTriggerConfig,
        { booking_id: String(args.event.payload.booking_id ?? ""), ...args.event.payload },
        booking,
      );
    },

    dedupeKeyFor: (args) => {
      const bookingId = String(args.event.payload.booking_id ?? args.event.id);
      const count = Number(args.booking?.reschedule_count ?? 0);
      return bookingDedupeKey(type, bookingId, Number.isFinite(count) ? count : 0);
    },
  });
}
