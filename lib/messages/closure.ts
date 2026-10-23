/**
 * ¿El ultimo mensaje del lead pide una respuesta, o solo cierra la charla?
 *
 * "Gracias", "ok, genial", "👍" o un sticker no esperan nada de nosotros: una
 * conversacion que termina asi no esta "esperando respuesta". Esta es la regla
 * que lo decide SIN IA, al instante y para todos los canales.
 *
 * Es GEMELA de `public.chat_is_closure_message` (SQL, 00259), que es la que
 * corre de verdad: el trigger de `messages` la aplica a cada mensaje que entra.
 * Las dos comparten los casos de `closure.cases.json` (este archivo los corre en
 * vitest, `scripts/verify-chat-awaiting.mjs` contra la base). Si se cambia una
 * regla, se cambia en las dos y se suma el caso.
 *
 * La regla es conservadora a proposito: ante la duda, el mensaje PIDE respuesta.
 *
 *   - Un "?" o "¿" en el mensaje: pide respuesta.
 *   - Si nuestra ultima respuesta fue una pregunta, nada cierra: "dale" o "👍"
 *     despues de "¿te paso el link?" es un si, y hay que mandarlo.
 *   - Si nuestra ultima respuesta PROMETIA algo ("dame un momento", "ya te lo
 *     paso", "en breve"), tampoco: el "gracias" es por adelantado y el lead sigue
 *     esperando eso. Paso de verdad: un bot dijo "Voy a buscar el link, dame un
 *     momento", el link nunca llego y la conversacion se daba por cerrada.
 *   - Solo emojis o simbolos (sin letras): cierra.
 *   - Texto: cierra si TODAS las palabras son de cierre ("gracias", "genial",
 *     "chau", "de nada"...) y son 10 o menos. Una sola palabra fuera de la lista
 *     ("gracias, me interesa") alcanza para que pida respuesta.
 *   - Sin texto: cierra solo si todos los adjuntos son stickers o GIFs. Un audio,
 *     una foto o un video piden respuesta.
 *
 * Modulo PURO, sin dependencias: lo usan los tests y el agente.
 */

/**
 * Las palabras que, solas o combinadas, cierran una charla. Ya normalizadas:
 * minusculas, sin tildes y con las letras repetidas colapsadas ("graciasss" ->
 * "gracias"). Mismo orden y misma lista que el array de la funcion SQL.
 */
export const CLOSURE_WORDS: readonly string[] = [
  // Agradecer
  "gracias", "graciass", "gracia", "grax", "thanks", "thank", "thx", "ty", "you",
  "mil", "muchas", "muchisimas", "muchisimo", "mucho", "infinitas",
  // Devolver el saludo
  "de", "nada", "igualmente", "vos", "tambien", "ti", "a", "para", "el", "la", "lo", "y", "me", "te",
  // Despedirse
  "chau", "chao", "adios", "bye", "saludos", "saludo", "abrazo", "abrazos", "abrazote",
  "beso", "besos", "besito", "besitos", "hasta", "luego", "pronto", "manana", "nos", "vemos", "hablamos",
  "buen", "buena", "buenas", "dia", "dias", "noches", "tardes", "finde", "semana", "que", "tengas",
  // Confirmar o celebrar sin pedir nada
  "ok", "okey", "oki", "okis", "oka", "okay", "dale", "perfecto", "perfecta", "genial", "listo", "lista",
  "joya", "buenisimo", "buenisima", "barbaro", "barbara", "copado", "super", "bien", "bueno", "excelente",
  "entendido", "claro", "re", "muy", "todo", "ah", "oh", "wow", "amo", "love", "hermoso", "hermosa",
  "lindo", "linda", "encanta", "encanto", "gusto", "un", "una", "sos", "crack", "idola", "idolo",
  "increible", "fantastico", "no",
];

const CLOSURE_SET = new Set(CLOSURE_WORDS);

/**
 * Frases de una respuesta nuestra que dejan algo pendiente. Se buscan en el
 * texto normalizado (minusculas, sin tildes). Mismo orden y misma lista que el
 * SQL.
 */
export const PENDING_PROMISE_PHRASES: readonly string[] = [
  "dame un momento",
  "dame un segundo",
  "un momentito",
  "un segundito",
  "en breve",
  "enseguida te",
  "ya te lo paso",
  "ya te la paso",
  "ya te paso",
  "ya te lo mando",
  "ya te la mando",
  "ahora te lo",
  "ahora te la",
  "te aviso",
];

/** Tope de palabras: un mensaje largo casi nunca es solo un "gracias". */
export const CLOSURE_MAX_WORDS = 10;

/** Los adjuntos que, sin texto, no piden respuesta. */
export const CLOSURE_ATTACHMENT_KINDS: readonly string[] = ["sticker", "gif"];

/** Risas: "jaja", "jajaja", "jeje", "haha". Cuentan como palabra de cierre. */
const LAUGH = /^(?:ja|je|ji|ha|he)+j?$/;

/**
 * Solo emojis o simbolos. Los mismos rangos que el SQL: simbolos y flechas
 * (U+2000-U+2BFF, ahi estan ❤ ✨ ☺), el selector de variante, el ZWJ y los
 * planos de emojis (U+1F000-U+1FAFF, con los tonos de piel).
 */
const SYMBOLS_ONLY = /^[ -⯿️‍\u{1F000}-\u{1FAFF}]+$/u;

/** Puntuacion que se ignora al decidir si quedan solo simbolos. */
const PUNCTUATION = /[\s.,;:!¡'"()\-_*~…]/g;

/** Minusculas, sin tildes (con la MISMA tabla que el `translate` del SQL) y sin letras repetidas de mas. */
export function normalizeClosureText(text: string): string {
  const from = "áéíóúüñàèìòù";
  const to = "aeiouunaeiou";
  let out = "";
  for (const ch of text.toLowerCase()) {
    const i = from.indexOf(ch);
    out += i >= 0 ? to[i] : ch;
  }
  return out.replace(/([a-z])\1{2,}/g, "$1");
}

/** ¿Nuestra respuesta dejo algo pendiente? (una pregunta o una promesa) */
export function leavesSomethingPending(lastReplyText: string | null | undefined): boolean {
  if (!lastReplyText) return false;
  if (asksSomething(lastReplyText)) return true;
  const normalized = normalizeClosureText(lastReplyText);
  return PENDING_PROMISE_PHRASES.some((phrase) => normalized.includes(phrase));
}

/** ¿Un texto es un pedido de respuesta? Lo es si tiene un signo de pregunta. */
export function asksSomething(text: string | null | undefined): boolean {
  return Boolean(text && (text.includes("?") || text.includes("¿")));
}

/** ¿Este texto, solo, cierra la charla? (Sin mirar nuestra ultima respuesta.) */
export function isClosureText(text: string): boolean {
  if (asksSomething(text)) return false;
  const normalized = normalizeClosureText(text.trim());
  if (!normalized) return false;

  const symbols = normalized.replace(PUNCTUATION, "");
  if (symbols && !/[a-z0-9]/.test(symbols)) return SYMBOLS_ONLY.test(symbols);

  const words = normalized.split(/[^a-z]+/).filter(Boolean);
  if (words.length === 0 || words.length > CLOSURE_MAX_WORDS) return false;
  // Un numero ("2", "100") no es una palabra de cierre: "quiero 2" pide algo.
  if (/[0-9]/.test(normalized)) return false;
  return words.every((w) => CLOSURE_SET.has(w) || LAUGH.test(w));
}

export interface ClosureMessage {
  text: string | null;
  /** Los `kind` de los adjuntos del mensaje (formato v2). Vacio = sin adjuntos. */
  attachmentKinds?: readonly string[];
}

/**
 * ¿Este mensaje del lead cierra la charla?
 *
 * `lastReplyText` es el texto de nuestra ultima respuesta en la conversacion
 * (null si nunca respondimos o fue solo un adjunto).
 */
export function isClosureMessage(message: ClosureMessage, lastReplyText: string | null): boolean {
  if (leavesSomethingPending(lastReplyText)) return false;
  const text = message.text?.trim() ?? "";
  if (text) return isClosureText(text);
  const kinds = message.attachmentKinds ?? [];
  return kinds.length > 0 && kinds.every((k) => CLOSURE_ATTACHMENT_KINDS.includes(k));
}

/**
 * ¿Toda la tanda sin responder cierra la charla? Basta un mensaje que pida algo
 * para que la conversacion siga esperando: "¿cuanto sale?" seguido de "gracias"
 * sigue necesitando una respuesta.
 */
export function isClosureRun(messages: readonly ClosureMessage[], lastReplyText: string | null): boolean {
  return messages.length > 0 && messages.every((m) => isClosureMessage(m, lastReplyText));
}
