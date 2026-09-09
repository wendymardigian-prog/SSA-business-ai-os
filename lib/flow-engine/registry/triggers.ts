/**
 * Los tipos de trigger que sabe evaluar el sistema.
 *
 * Antes esto era una cascada de `if` adentro del matcher, con el orden de
 * resolucion escrito a mano. Ahora cada tipo declara su prioridad y el matcher
 * los recorre ordenados: un tipo nuevo elige su lugar sin reescribir la cascada.
 *
 * La prioridad va de mayor a menor. La escala deja huecos a proposito para que
 * un tipo nuevo pueda meterse en el medio sin renumerar todo.
 */

import { registerTrigger } from "./registry";
import type { TriggerMatchArgs } from "./types";

/** Un payload de boton o de respuesta rapida, comparado tal cual. */
function payloadMatches(args: TriggerMatchArgs, incoming: string | undefined): boolean {
  const expected = args.config.payload;
  return typeof expected === "string" && !!incoming && expected === incoming;
}

registerTrigger({
  type: "postback",
  label: "Clic en un boton",
  scope: "message",
  priority: 100,
  matches: (args) => payloadMatches(args, args.message.postbackPayload),
});

registerTrigger({
  type: "quick_reply",
  label: "Respuesta rapida",
  scope: "message",
  priority: 90,
  matches: (args) => payloadMatches(args, args.message.quickReplyPayload),
});

registerTrigger({
  type: "keyword",
  label: "Palabra clave",
  scope: "message",
  priority: 80,
  matches: keywordMatches,
});

registerTrigger({
  type: "welcome",
  label: "Primer mensaje",
  scope: "message",
  priority: 20,
  matches: (args) => args.isFirstMessage,
});

registerTrigger({
  type: "default",
  label: "Respuesta por defecto",
  scope: "message",
  priority: 10,
  // Sin `matches`: es el ultimo recurso, matchea siempre que se llegue hasta el.
});

registerTrigger({
  type: "comment_keyword",
  label: "Palabra clave en un comentario",
  scope: "comment",
  priority: 80,
  matches: keywordMatches,
});

/**
 * Compara el texto contra la lista de palabras clave del trigger.
 *
 * Acepta las dos formas de config que quedaron dando vueltas: una lista de
 * strings con un matchType general, o una lista de objetos con el suyo propio.
 */
export function keywordMatches(args: TriggerMatchArgs): boolean {
  const config = args.config as {
    keywords?: Array<string | { value: string; matchType?: string }>;
    matchType?: string;
  };
  if (!config.keywords?.length) return false;

  for (const kw of config.keywords) {
    const keyword = (typeof kw === "string" ? kw : kw.value)?.toLowerCase();
    if (!keyword) continue;

    const matchType =
      (typeof kw === "object" && kw.matchType) || config.matchType || "contains";

    if (matchType === "exact" && args.text === keyword) return true;
    if (matchType === "contains" && args.text.includes(keyword)) return true;
    if (matchType === "startsWith" && args.text.startsWith(keyword)) return true;
  }
  return false;
}
