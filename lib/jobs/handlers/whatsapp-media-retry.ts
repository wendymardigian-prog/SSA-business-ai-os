/**
 * Volver a pedir el archivo de un mensaje de WhatsApp que fallo, desde la cola.
 *
 * Lo encola `scripts/recover-whatsapp-media.mjs` para recuperar lo que no se pudo
 * bajar entre el 1/10 y el 20/11/2026 (el pedido a Evolution iba sin la clave del
 * mensaje y contestaba 400). El trabajo es `retryWhatsappMedia`, el mismo del
 * boton «Reintentar»: solo baja y transcribe o describe, sin flujos ni agente.
 *
 * Nunca lanza por Evolution: un archivo que ya no existe queda con su motivo en
 * la burbuja, y reintentarlo desde la cola no lo cambiaria.
 */

import { registerJobHandler, type JobContext } from "@/lib/jobs/registry";
import { retryWhatsappMedia } from "@/lib/chat-media/whatsapp-retry";

export const WHATSAPP_MEDIA_RETRY_JOB = "whatsapp_media_retry";

export function whatsappMediaRetryDedupeKey(messageId: string): string {
  return `${WHATSAPP_MEDIA_RETRY_JOB}:${messageId}`;
}

export async function handleWhatsappMediaRetry({ supabase, job }: JobContext): Promise<void> {
  const messageId = (job.payload as { messageId?: unknown } | null)?.messageId;
  if (typeof messageId !== "string" || messageId.length === 0) return;
  await retryWhatsappMedia({ service: supabase, messageId });
}

export function registerWhatsappMediaRetryHandler(): void {
  registerJobHandler(WHATSAPP_MEDIA_RETRY_JOB, handleWhatsappMediaRetry);
}
