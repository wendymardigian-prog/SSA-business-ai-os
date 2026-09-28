/**
 * Las condiciones de agenda (F45).
 *
 * Cuatro campos que un nodo Condition puede comparar. Todos aceptan un
 * argumento opcional para acotar a un área, un tipo o un evento: sin él,
 * miran todas las reuniones del contacto.
 *
 *   has_upcoming_booking:            → "true" / "false"
 *   has_upcoming_booking:<id>        → acotado a esa categoría o evento
 *   last_booking_status:             → el estado de la última reunión
 *   last_booking_result:             → el resultado, o "" si todavía no lo tiene
 *   no_show_count:                   → cuántas veces faltó, como número
 *
 * El argumento se compara contra el snapshot de la agenda, no contra la
 * categoría actual: lo mismo que hacen los filtros de los triggers.
 */

import { registerConditionField } from "./registry";
import type { ConditionFieldArgs } from "./types";
import { groupOf, isBookingStatus } from "@/lib/scheduling/booking-status";

interface BookingRow {
  status: string;
  start_at: string;
  event_type_id: string;
  category_snapshot: { area_id?: string | null; type_id?: string | null } | null;
}

/** ¿Esta agenda entra en el filtro? Sin argumento, todas entran. */
function inScope(booking: BookingRow, argument: string): boolean {
  if (!argument) return true;
  const snap = booking.category_snapshot ?? null;
  return booking.event_type_id === argument || snap?.area_id === argument || snap?.type_id === argument;
}

async function bookingsOf(args: ConditionFieldArgs): Promise<BookingRow[]> {
  const { data } = await args.supabase
    .from("bookings")
    .select("status, start_at, event_type_id, category_snapshot")
    .eq("workspace_id", args.context.workspaceId)
    .eq("contact_id", args.context.contactId)
    .order("start_at", { ascending: false })
    .limit(50);
  return ((data ?? []) as unknown as BookingRow[]).filter((b) => inScope(b, args.argument));
}

registerConditionField({
  prefix: "has_upcoming_booking:",
  label: "Tiene una reunión por venir",
  resolve: async (args) => {
    const now = Date.now();
    const bookings = await bookingsOf(args);
    // "Por venir" es activa y todavía no empezó: una reunión de ayer que sigue
    // en "Agendada" porque nadie la cerró no cuenta como próxima.
    const has = bookings.some((b) => isBookingStatus(b.status) && groupOf(b.status) === "active" && Date.parse(b.start_at) > now);
    return String(has);
  },
});

registerConditionField({
  prefix: "last_booking_status:",
  label: "Estado de la última reunión",
  resolve: async (args) => {
    const bookings = await bookingsOf(args);
    return bookings[0]?.status ?? "";
  },
});

registerConditionField({
  prefix: "last_booking_result:",
  label: "Resultado de la última reunión",
  resolve: async (args) => {
    const bookings = await bookingsOf(args);
    // El resultado es el estado solo cuando ya hay uno cargado: una reunión
    // agendada todavía no tiene resultado, y devolver "Agendada" haría que una
    // comparación con "venta" diga que no sin haber preguntado nunca.
    const last = bookings.find((b) => isBookingStatus(b.status) && (groupOf(b.status) === "outcome" || groupOf(b.status) === "no_show"));
    return last?.status ?? "";
  },
});

registerConditionField({
  prefix: "no_show_count:",
  label: "Cuántas veces faltó",
  resolve: async (args) => {
    const bookings = await bookingsOf(args);
    return String(bookings.filter((b) => b.status === "no_show").length);
  },
});
