/**
 * La confirmacion no sale antes que el link de Meet.
 *
 * El email (cron de `automation_events`) y el evento de Google (cola de jobs) son
 * dos procesos independientes que corren cada minuto, sin orden entre ellos. Si
 * ganaba el email, salia una confirmacion de un Meet sin link.
 *
 * El evento queda sin procesar hasta que Google responda, con un tope: si Google
 * tarda o falla, la confirmacion sale igual, porque es peor que no salga.
 *
 * Puro.
 */

export const MEET_WAIT_MS = 3 * 60_000;

export function shouldWaitForMeet(input: {
  eventType: string;
  /** Cuando se creo el evento de automatizacion. */
  createdAt: string | null | undefined;
  booking: { location_type?: unknown; meet_url?: unknown; google_sync_status?: unknown } | null;
  now?: Date;
}): boolean {
  if (input.eventType !== "booking_created" || !input.booking) return false;
  if (input.booking.location_type !== "google_meet") return false;
  if (input.booking.meet_url) return false;
  // `not_applicable` (sin calendario), `failed` o `synced`: ya no va a llegar un link.
  if (input.booking.google_sync_status !== "pending") return false;
  const created = Date.parse(input.createdAt ?? "");
  if (Number.isNaN(created)) return false;
  return (input.now ?? new Date()).getTime() - created < MEET_WAIT_MS;
}
