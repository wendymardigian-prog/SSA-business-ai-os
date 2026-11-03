/**
 * Los votos de una encuesta de WhatsApp.
 *
 * LA REGLA: un voto NO es un mensaje. WhatsApp lo manda como un
 * `messages.upsert` comun (con un `pollUpdateMessage` adentro); si siguiera el
 * camino de un mensaje, entraria como un entrante VACIO «📊 Encuesta», sumaria
 * un no leido, despertaria al agente y podria retomar un flujo que espera una
 * respuesta. Por eso el receptor lo ataja ANTES del camino de los mensajes,
 * igual que una reaccion.
 *
 * Como llega (Evolution 2.3.7): Evolution descifra el voto si tiene guardada la
 * encuesta original (la que salio de nuestro numero, por el sistema o por el
 * telefono) y deja los NOMBRES de las opciones elegidas en
 * `pollUpdateMessage.vote.selectedOptions`. Si no la tiene, el voto sigue
 * cifrado (`encPayload` / `encIv`) y no se puede saber que eligio. Una lista
 * vacia es "saco su voto" (o, en un caso raro, que no se pudo descifrar): de las
 * dos maneras no hay nada elegido.
 *
 * Modulo PURO: lo importan el receptor y los tests.
 */

export interface ParsedPollVote {
  /** El id (de WhatsApp) del mensaje de la encuesta que se voto. */
  pollMessageId: string;
  /** Los nombres de las opciones elegidas. Vacio = saco su voto. */
  selectedOptions: string[];
  /** false = el voto llego cifrado: no se sabe que eligio. */
  decrypted: boolean;
}

/** El voto que trae un mensaje de Baileys (el de `data.message`), o null si no es un voto. */
export function parseBaileysPollVote(message: unknown): ParsedPollVote | null {
  if (!message || typeof message !== "object") return null;
  const update = (message as { pollUpdateMessage?: unknown }).pollUpdateMessage;
  if (!update || typeof update !== "object") return null;
  const u = update as { pollCreationMessageKey?: { id?: unknown }; vote?: unknown };
  const pollMessageId = typeof u.pollCreationMessageKey?.id === "string" ? u.pollCreationMessageKey.id : "";

  const vote = u.vote && typeof u.vote === "object" ? (u.vote as { selectedOptions?: unknown }) : null;
  const raw = Array.isArray(vote?.selectedOptions) ? vote.selectedOptions : null;
  // Descifrado = una lista de textos. Cualquier otra forma (sin lista, o los hashes en bytes) es un voto cifrado.
  const decrypted = raw !== null && raw.every((option) => typeof option === "string");
  const selectedOptions = decrypted
    ? Array.from(new Set((raw as string[]).map((option) => option.trim()).filter(Boolean)))
    : [];

  return { pollMessageId, selectedOptions, decrypted };
}
