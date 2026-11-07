/**
 * El tope UNICO de un numero de WhatsApp (decision del 7/11/2026): todo lo que sale por un numero conectado por
 * Evolution cuenta en el mismo contador, `claim_automated_send` (00037), una fila por canal y por hora de reloj.
 *
 * Lo usan `sendChannelMessage` (flujos, secuencias, agente, broadcasts), «Enviar WhatsApp a un número»,
 * «Enviar encuesta» y los avisos al equipo (`lib/notifications/team-whatsapp.ts`). Puro: sin base ni red.
 */

/** Mensajes por hora y por numero de WhatsApp. */
export const WHATSAPP_HOURLY_LIMIT = 200;

/**
 * Cuando se libera el contador: `claim_automated_send` cuenta por `date_trunc('hour', now())` en la base (UTC), asi
 * que lo que llego al tope vuelve a entrar al inicio de la hora siguiente.
 */
export function nextHourlyWindowStart(now: Date): Date {
  const next = new Date(now.getTime());
  next.setUTCMinutes(0, 0, 0);
  next.setUTCHours(next.getUTCHours() + 1);
  return next;
}
