/**
 * El texto de la fila en la lista de la bandeja (00262).
 *
 * La fila muestra el ultimo mensaje de la conversacion, sea del contacto o
 * nuestro. Si fue nuestro (una persona del equipo, el agente, un flow o una
 * herramienta de afuera como ManyChat) arranca con "Vos:": sin eso, una charla
 * que ya respondimos parece esperando respuesta. El prefijo es de la pantalla,
 * no se guarda: el buscador sigue mirando el texto.
 */
export const EMPTY_PREVIEW = "Sin mensajes todavía";
export const OUTBOUND_PREFIX = "Vos: ";

export function conversationListPreview(row: {
  last_message_preview: string | null;
  last_message_direction?: "inbound" | "outbound" | null;
}): string {
  const preview = row.last_message_preview?.trim() ?? "";
  if (!preview) return EMPTY_PREVIEW;
  return row.last_message_direction === "outbound" ? `${OUTBOUND_PREFIX}${preview}` : preview;
}
