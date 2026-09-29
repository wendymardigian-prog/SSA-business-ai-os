/**
 * La retencion de la media del chat (F5).
 *
 * El bucket no puede crecer sin techo. Pasado el plazo del workspace se borra el
 * ARCHIVO, no el mensaje: el adjunto queda con todos sus metadatos y sin
 * `storagePath`, que es lo que la burbuja lee como "Adjunto ya no disponible".
 *
 * **La transcripcion nunca se borra por retencion.** Es texto, pesa nada, y es
 * el contexto con el que el agente entiende la conversacion: borrarla seria
 * ahorrar bytes a cambio de que el agente se olvide de lo que le dijeron.
 *
 * Modulo PURO: decide que borrar y como queda la columna. Quien borra de verdad
 * es el cron.
 */

import { parseAttachments, toAttachmentsColumn, type ChatAttachment, type ChatAttachments } from "@/lib/messages/attachments";

export interface MessageToClean {
  id: string;
  created_at: string;
  attachments: unknown;
}

export interface CleanupPlan {
  messageId: string;
  /** Los paths a borrar del bucket. */
  paths: string[];
  /** Como queda la columna despues de borrarlos. */
  attachments: ChatAttachments | null;
}

/**
 * Que hay que borrar.
 *
 * Se mira la fecha del MENSAJE y no la del archivo: es la misma cosa (el archivo
 * se copia al recibirlo) y es la unica que esta indexada.
 *
 * `retentionDays === 0` significa "no borrar nunca".
 */
export function planChatMediaCleanup(args: {
  messages: MessageToClean[];
  retentionDays: number;
  now: Date;
}): CleanupPlan[] {
  if (args.retentionDays <= 0) return [];

  const cutoff = args.now.getTime() - args.retentionDays * 24 * 60 * 60 * 1000;
  const plans: CleanupPlan[] = [];

  for (const message of args.messages) {
    const created = new Date(message.created_at).getTime();
    // Una fecha ilegible no se toca: ante la duda, no se borra.
    if (!Number.isFinite(created) || created >= cutoff) continue;

    const items = parseAttachments(message.attachments);
    if (items.length === 0) continue;

    const paths: string[] = [];
    const next: ChatAttachment[] = items.map((item) => {
      // Solo los que tienen archivo NUESTRO. Los adjuntos de email viven en su
      // propio bucket y tienen su propia retencion: no se tocan.
      if (item.status !== "ready" || !item.storagePath) return item;
      if (item.meta?.bucket) return item;

      paths.push(item.storagePath);
      return {
        ...item,
        storagePath: null,
        // "none" y no "failed": no fallo nada. El archivo cumplio su plazo.
        status: "none" as const,
        error: null,
      };
    });

    if (paths.length === 0) continue;
    plans.push({ messageId: message.id, paths, attachments: toAttachmentsColumn(next) });
  }

  return plans;
}
