import { parseAttachments, type AttachmentKind } from "@/lib/messages/attachments";

/**
 * Un envio de la bandeja que no salio (00262). Modulo PURO: lo usan la ruta de
 * envio y la burbuja.
 *
 * Antes el motivo PISABA el texto del mensaje: la pantalla mostraba solo "No se
 * pudo enviar" (el motivo se tiraba en el navegador) y, al recargar, lo que la
 * persona habia escrito ya no estaba. Ahora el texto queda como se escribio y el
 * motivo va en `messages.send_error`.
 */

/** El motivo y que hacer, en una sola frase para guardar y mostrar. */
export function sendErrorText(failure: { message?: string | null; hint?: string | null } | null | undefined): string {
  const message = failure?.message?.trim() || "No se pudo enviar el mensaje.";
  const hint = failure?.hint?.trim();
  return hint ? `${message} ${hint}` : message;
}

/**
 * Si un mensaje fallido se puede reintentar desde la bandeja: un saliente de
 * una persona que guardo el motivo aparte. Las filas viejas (sin `send_error`)
 * tienen el motivo en el texto: reintentarlas le mandaria el motivo al
 * contacto, asi que no se ofrece.
 */
export function canRetrySend(message: {
  direction: string;
  status: string;
  origin?: string | null;
  send_error?: string | null;
}): boolean {
  return (
    message.direction === "outbound" &&
    message.status === "failed" &&
    message.origin === "user" &&
    typeof message.send_error === "string" &&
    message.send_error.length > 0
  );
}

/** El adjunto de un envio fallido, para volver a mandarlo por el mismo camino (y la misma validacion). */
export interface RetryMedia {
  storagePath: string;
  kind: AttachmentKind;
  mime: string | null;
  filename: string | null;
  durationSeconds: number | null;
}

export function retryMediaFrom(attachments: unknown): RetryMedia | null {
  const first = parseAttachments(attachments)[0];
  if (!first?.storagePath) return null;
  return {
    storagePath: first.storagePath,
    kind: first.kind,
    mime: first.mime,
    filename: first.filename,
    durationSeconds: first.durationSeconds,
  };
}
