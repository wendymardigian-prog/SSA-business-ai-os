/**
 * Que botones muestra el composer de la bandeja.
 *
 * El composer tenia cuatro botones fijos mas el de enviar, y en el telefono
 * competian con la caja de texto. Ahora, en pantallas chicas, los secundarios
 * (recursos guardados, adjuntar, sugerir respuesta) viven detras de un "+"; el
 * emoji, el microfono y enviar quedan a la vista. En pantallas grandes se ven
 * todos. Esta funcion decide QUE aplica en cada estado; el ancho lo resuelve
 * el CSS (`sm:`).
 *
 * Puro.
 */

export interface ComposerInput {
  /** Hay un archivo elegido para mandar (el textarea pasa a ser su texto). */
  hasAttachment: boolean;
  /** Hay texto escrito. */
  hasText: boolean;
  /** El agente puede sugerir una respuesta en esta conversacion. */
  canSuggest: boolean;
}

export interface ComposerPlan {
  showLibrary: boolean;
  showAttach: boolean;
  showMic: boolean;
  showSuggest: boolean;
  /** ¿Hay algo para el menu "+" del telefono? */
  hasMoreMenu: boolean;
}

export function planComposerActions(input: ComposerInput): ComposerPlan {
  const showLibrary = !input.hasAttachment;
  const showAttach = !input.hasAttachment;
  // El microfono solo con el cuadro vacio: grabar y escribir son excluyentes.
  const showMic = !input.hasAttachment && !input.hasText;
  const showSuggest = input.canSuggest && !input.hasAttachment;
  return { showLibrary, showAttach, showMic, showSuggest, hasMoreMenu: showLibrary || showAttach || showSuggest };
}
