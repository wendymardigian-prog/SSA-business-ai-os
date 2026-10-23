/**
 * El mensaje que se manda al rechazar una llamada de WhatsApp (00258). Puro.
 * WhatsApp admite textos largos; acá se acota para que siga siendo un aviso.
 */

export const MAX_CALL_MESSAGE = 500;

export const DEFAULT_CALL_MESSAGE = "¡Hola! Ahora no puedo atender llamadas por acá. Escribime y te respondo enseguida.";

/** El mensaje limpio, o null si se pasa del tope. */
export function normalizeCallMessage(value: unknown): string | null {
  const text = typeof value === "string" ? value.replace(/\r\n/g, "\n").trim() : "";
  return text.length > MAX_CALL_MESSAGE ? null : text;
}
