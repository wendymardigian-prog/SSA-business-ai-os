/**
 * El vínculo de una venta con la agenda de origen (plano F24). Puro.
 *
 * Una venta puede nacer de una agenda del MISMO contacto y que ya ocurrió. «Cargar venta»
 * desde la ficha de la agenda aparece cuando su estado es del grupo de resultado
 * (`outcome`: seguimiento, venta, no califica…): ya hubo reunión y hay un resultado.
 */
import { groupOf } from "@/lib/scheduling/booking-status";
import type { BookingStatus } from "@/lib/scheduling/types";

export interface BookingRef {
  id: string;
  contact_id: string | null;
  start_at: string;
  status: string;
  host_user_id: string | null;
  event_type_id?: string | null;
  event_type_title?: string | null;
}

/** Las agendas pasadas de ese contacto, de la más nueva a la más vieja. */
export function eligibleBookings(bookings: readonly BookingRef[], contactId: string | null, now: Date): BookingRef[] {
  if (!contactId) return [];
  return bookings
    .filter((b) => b.contact_id === contactId && Date.parse(b.start_at) < now.getTime())
    .sort((a, b) => Date.parse(b.start_at) - Date.parse(a.start_at));
}

/** Lo que valida el servidor: del mismo contacto y ya ocurrida. */
export function bookingBelongsToSale(booking: BookingRef | null | undefined, contactId: string, now: Date): boolean {
  return !!booking && booking.contact_id === contactId && Date.parse(booking.start_at) < now.getTime();
}

/** El botón «Cargar venta» de la ficha de la agenda: solo con un resultado, y cancelada no. */
export function canLoadSaleFromBooking(booking: Pick<BookingRef, "status" | "contact_id" | "start_at">, now: Date): boolean {
  if (!booking.contact_id || Date.parse(booking.start_at) >= now.getTime()) return false;
  try {
    return groupOf(booking.status as BookingStatus) === "outcome";
  } catch {
    return false;
  }
}

export interface BookingPrefill {
  contactId: string;
  bookingId: string;
  /** El anfitrión, si es del equipo, queda de vendedor. */
  vendedorId: string | null;
}

export function prefillFromBooking(booking: BookingRef, teamMemberIds: ReadonlySet<string>): BookingPrefill | null {
  if (!booking.contact_id) return null;
  return {
    contactId: booking.contact_id,
    bookingId: booking.id,
    vendedorId: booking.host_user_id && teamMemberIds.has(booking.host_user_id) ? booking.host_user_id : null,
  };
}

/** La condición de flujo «el tipo de evento de la agenda es X»: solo ventas con agenda de ese tipo. */
export function saleHasEventType(sale: { booking_id: string | null }, bookings: ReadonlyMap<string, { event_type_id: string | null }>, eventTypeId: string): boolean {
  if (!sale.booking_id) return false;
  return bookings.get(sale.booking_id)?.event_type_id === eventTypeId;
}
