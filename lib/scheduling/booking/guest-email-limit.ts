/**
 * Tope de emails al invitado POR DIRECCION en una reserva publica (seguridad, noviembre 2026).
 *
 * La pagina de la agenda es publica y el tope por IP no alcanza: cambiando de IP, alguien podia usar las reservas
 * para llenarle la bandeja a un tercero con confirmaciones (los flujos de la agenda mandan aunque haya "no
 * contactar") y con invitaciones de Google. Pasado el tope, la reserva SE GUARDA igual (al publico no se le dice
 * nada distinto) pero queda marcada en `bookings.metadata` y al invitado no le sale nada: ni la invitacion de
 * Google (`booking-sync`) ni los emails de los flujos que van al contacto (`send_email`).
 *
 * Puro: la clave y la lectura de la marca. El conteo lo hace `checkLimit` (`bump_rate_limit`).
 */
import { hashIp } from "@/lib/scheduling/antispam";

/** Reservas publicas por dia, por evento y por direccion, que todavia le mandan emails al invitado. */
export const GUEST_EMAIL_LIMITS = { perAddressPerDay: 3 } as const;
export const GUEST_EMAIL_WINDOW_MS = 24 * 60 * 60 * 1000;

/** La marca en `bookings.metadata` (y en las variables del flujo, `booking_guest_emails_suppressed`). */
export const GUEST_EMAILS_SUPPRESSED = "guest_emails_suppressed";

/** La direccion viaja hasheada: nunca queda en `rate_limits`. */
export function guestEmailLimitKey(eventTypeId: string, email: string): string {
  return `scheduling:guest-email:${eventTypeId}:${hashIp(email.trim().toLowerCase())}`;
}

/** Si la reserva quedo sin emails al invitado. */
export function guestEmailsSuppressed(metadata: unknown): boolean {
  return !!metadata && typeof metadata === "object" && (metadata as Record<string, unknown>)[GUEST_EMAILS_SUPPRESSED] === true;
}
