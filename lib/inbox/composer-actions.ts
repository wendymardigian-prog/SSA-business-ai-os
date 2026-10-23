/**
 * Que botones muestra el composer de la bandeja.
 *
 * El composer llego a tener seis botones sueltos (emoji, stickers, sugerir,
 * recursos, adjuntar, microfono) mas enviar, y competian con la caja de texto,
 * sobre todo en el telefono. Ahora a la vista quedan tres cosas, en todos los
 * anchos:
 *
 *   [ caja de texto ] [ ⋯ ] [ principal ]
 *
 *  - El boton PRINCIPAL cambia como en WhatsApp: con la caja vacia es el
 *    microfono (mandar un audio es lo mas frecuente despues de escribir), y en
 *    cuanto hay algo para mandar (texto o un adjunto) es enviar. Grabar y
 *    escribir son excluyentes, asi que nunca hacen falta los dos a la vez.
 *  - El "⋯" agrupa lo demas, en este orden: recursos guardados, adjuntar,
 *    emoji, stickers y sugerir respuesta.
 *
 * Esta funcion decide QUE aplica en cada estado; los componentes solo lo
 * componen. Puro.
 */

export interface ComposerInput {
  /** Hay un archivo elegido para mandar (el textarea pasa a ser su texto). */
  hasAttachment: boolean;
  /** Hay texto escrito. */
  hasText: boolean;
  /** El agente puede sugerir una respuesta en esta conversacion. */
  canSuggest: boolean;
  /** El canal admite stickers (hoy, WhatsApp). */
  canSticker?: boolean;
}

export type ComposerMenuAction = "library" | "attach" | "emoji" | "sticker" | "suggest";

export interface ComposerPlan {
  /** El boton que queda a la vista al lado del "⋯". */
  primary: "mic" | "send";
  /** Lo que va adentro del "⋯", en orden. Vacio = no se muestra el "⋯". */
  menu: ComposerMenuAction[];
}

/** El orden fijo del menu: lo mas usado arriba. */
const MENU_ORDER: readonly ComposerMenuAction[] = ["library", "attach", "emoji", "sticker", "suggest"];

export function planComposerActions(input: ComposerInput): ComposerPlan {
  const free = !input.hasAttachment;
  const available: Record<ComposerMenuAction, boolean> = {
    // Con un adjunto elegido solo queda el texto que lo acompana (y un emoji para ese texto).
    library: free,
    attach: free,
    emoji: true,
    sticker: free && !!input.canSticker,
    suggest: free && input.canSuggest,
  };
  // El microfono solo con el cuadro vacio y sin adjunto: si hay algo para mandar, el principal es enviar.
  const primary = free && !input.hasText ? "mic" : "send";
  return { primary, menu: MENU_ORDER.filter((action) => available[action]) };
}
