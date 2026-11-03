import { isActive } from "./booking-status";
import type { BookingStatus } from "./types";

/**
 * El link para entrar a la reunion (el Meet que guardo Google en
 * `bookings.meet_url`), listo para un `<a href>`. Solo https: un valor raro
 * (vacio, `javascript:`, sin protocolo) no se vuelve un link. Puro.
 */
export function meetJoinHref(url: string | null | undefined): string | null {
  if (!url) return null;
  try {
    const parsed = new URL(url.trim());
    return parsed.protocol === "https:" ? parsed.toString() : null;
  } catch {
    return null;
  }
}

/**
 * Si el panel tiene que esperar el link: la reunion es por Meet, todavia no lo
 * tiene y Google aun no contesto (el job la deja `synced`, `failed` o
 * `not_applicable`).
 */
export function waitingForMeet(booking: { locationType: string | null; meetUrl: string | null; syncStatus: string }): boolean {
  return booking.locationType === "google_meet" && !booking.meetUrl && booking.syncStatus === "pending";
}

/** Si se muestra «Unirse a Meet»: hay un link valido y la reunion sigue activa. */
export function canJoinMeet(booking: { meetUrl: string | null; status: BookingStatus }): boolean {
  return meetJoinHref(booking.meetUrl) !== null && isActive(booking.status);
}
