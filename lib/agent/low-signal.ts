import { parseAttachments } from "@/lib/messages/attachments";

/**
 * Cuando una conversacion no tiene nada que resumir ni clasificar.
 *
 * El resumen y la clasificacion al cierre cuestan una llamada al modelo. En una
 * conversacion donde el lead nunca contesto, o solo le dijo "si" a la
 * automatizacion que le ofrecio una guia, la llamada no aporta nada y ademas
 * hace dano: pisa la memoria del contacto con un resumen vacio y puede proponer
 * temperatura, etiquetas o un seguimiento sin ninguna base.
 *
 * Es una regla deterministica y conservadora: ante cualquier senal de que el
 * lead dijo algo (una pregunta, una palabra que no sea un "si" o un "gracias",
 * un audio, una foto) la conversacion NO es de poca senal y sigue al modelo.
 * Lo que ella no atrapa, por ejemplo la respuesta automatica de otro negocio,
 * lo resuelve el prompt.
 *
 * No se mide por largo: en los datos reales, entre 20 y 59 caracteres hay
 * consultas de verdad ("quiero mas info", "no encuentro el enlace") y hasta
 * "no me llego nada" tiene 16.
 */

/** Hasta cuantos mensajes del lead pueden ser "solo una respuesta corta". */
export const LOW_SIGNAL_MAX_LEAD_MESSAGES = 2;

/**
 * Palabras que, solas, no dicen nada: afirmar, agradecer, saludar. Genericas a
 * proposito (nada de un negocio en el codigo): una palabra que no esta aca
 * cuenta como contenido y la conversacion sigue al modelo.
 */
const ACKNOWLEDGMENT_WORD =
  /^(hola+|buen[ao]s|dias|tardes|noches|s+i+|sip|ok|okey|oki|dale|gra+c+i+a+s+|muchas|mil|muy|envi?amelo|mandamelo|pasamelo|por|favor|porfa|genial|perfecto|listo|bueno|super|claro|bien|hey|hi|hello|thanks|thank|you|yes|y|e|jaja+|me|interesa|quiero|el|la|a)$/;

export interface LowSignalMessage {
  direction: string;
  /** El texto que se le mostraria al modelo (texto, transcripcion o descripcion). */
  text: string | null;
  attachments?: unknown;
}

/** Palabras en minuscula, sin tildes, signos ni emojis. */
function wordsOf(text: string): string[] {
  return text
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z\s]/g, " ")
    .split(/\s+/)
    .filter(Boolean);
}

export function isLowSignalConversation(messages: LowSignalMessage[]): boolean {
  const lead = messages.filter((m) => m.direction === "inbound");

  // El lead nunca escribio: lo unico que hay es lo que mando el negocio.
  if (lead.length === 0) return true;

  if (lead.length > LOW_SIGNAL_MAX_LEAD_MESSAGES) return false;

  // Un audio, una foto o un archivo del lead es contenido, aunque no tenga texto.
  // Un sticker o un GIF no: el agente tampoco los lee como una consulta.
  if (lead.some((m) => parseAttachments(m.attachments).some((a) => a.kind !== "sticker" && a.kind !== "gif"))) return false;

  const texts = lead.map((m) => m.text ?? "");
  // Una pregunta pide una respuesta: es la senal mas clara de que no es un "si".
  if (texts.some((t) => t.includes("?") || t.includes("¿"))) return false;

  // Poca senal solo si TODO lo que dijo son afirmaciones y agradecimientos.
  return texts.every((t) => wordsOf(t).every((w) => ACKNOWLEDGMENT_WORD.test(w)));
}
