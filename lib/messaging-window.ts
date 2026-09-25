/**
 * La ventana de mensajeria de un canal: cuantas horas despues del ULTIMO
 * mensaje del lead deja la plataforma responderle.
 *
 * Instagram y Facebook: 24 horas, lo que documenta Meta para la mensajeria
 * estandar. El SDK de Zernio no expone la ventana por conversacion (solo
 * lastMessageAt, que mira las dos direcciones); lo unico que menciona es el tag
 * HUMAN_AGENT para escribir fuera de ella, que es la extension a 7 dias que
 * Meta da solo a apps aprobadas y no se usa.
 *
 * WhatsApp por Evolution (Baileys, no la API oficial) no tiene ventana.
 *
 * channels.messaging_window_hours pisa el default: NULL = default por
 * plataforma, 0 = sin ventana. La misma regla vive en SQL como
 * public.messaging_window_hours() (00070): si cambia una, cambia la otra.
 *
 * Sin dependencias de servidor: lo usan la cola y la bandeja.
 */

const DEFAULT_WINDOW_HOURS: Record<string, number> = {
  instagram: 24,
  facebook: 24,
};

export interface WindowChannel {
  platform: string;
  messaging_window_hours?: number | null;
}

/** Horas de ventana del canal. 0 = sin ventana. */
export function messagingWindowHours(channel: WindowChannel): number {
  const configured = channel.messaging_window_hours;
  if (configured !== null && configured !== undefined) return Math.max(0, configured);
  return DEFAULT_WINDOW_HOURS[channel.platform] ?? 0;
}

/**
 * Hasta cuando se puede responder, contando desde el ultimo mensaje del lead.
 * null = sin ventana (o no hay mensaje del lead del que contar).
 */
export function sendableUntil(lastInboundAt: string | null | undefined, windowHours: number): string | null {
  if (!lastInboundAt || windowHours <= 0) return null;
  const from = new Date(lastInboundAt).getTime();
  if (Number.isNaN(from)) return null;
  return new Date(from + windowHours * 3_600_000).toISOString();
}

/** Si todavia se puede enviar. Sin ventana, siempre. */
export function isSendable(until: string | null | undefined, now: Date = new Date()): boolean {
  if (!until) return true;
  return new Date(until).getTime() > now.getTime();
}
