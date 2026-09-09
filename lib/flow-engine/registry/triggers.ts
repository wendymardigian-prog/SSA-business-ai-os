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
  matches: (args) => {
    // F6: filtro adicional de respuesta a historia. Con storyReply en true, el
    // trigger solo corre para respuestas a historias; un DM comun con la misma
    // palabra no lo dispara. Es un filtro, no un tipo aparte: la palabra clave
    // se compara igual, solo se acota cuando aplica.
    const config = args.config as { storyReply?: boolean };
    if (config.storyReply === true && !args.message.isStoryReply) return false;
    return keywordMatches(args);
  },
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

// ------------------------------------------------------------
// Triggers que no nacen de un mensaje
// ------------------------------------------------------------
// Estos tres no tienen `matches`: no los evalua el matcher del inbox, los
// dispara un cron o un evento del CRM. Se registran igual para que el editor
// los ofrezca, para que la prioridad valga si alguna vez se cruzan, y para que
// el sistema tenga una sola lista de que tipos existen.

registerTrigger({
  type: "new_contact",
  label: "Contacto nuevo",
  scope: "event",
  priority: 60,
});

registerTrigger({
  type: "crm_event",
  label: "Evento del CRM",
  scope: "event",
  priority: 50,
});

registerTrigger({
  type: "inactivity",
  label: "Inactividad",
  scope: "scheduled",
  priority: 40,
});

/**
 * Decide si un evento del CRM le corresponde a un trigger.
 *
 * La config del trigger dice que evento espera y, opcionalmente, con que valor:
 * "cuando se agrega el tag interesado" es `{ event: "tag_added", value:
 * "interesado" }`. Sin valor, alcanza con que coincida el tipo de evento.
 *
 * Vive aca y no en el cron para que el cron no sepa de reglas: recorre eventos
 * y pregunta.
 */
export function crmEventMatches(
  config: Record<string, unknown>,
  event: { event_type: string; payload: Record<string, unknown> }
): boolean {
  if (config.event !== event.event_type) return false;

  const expected = config.value;
  if (expected === undefined || expected === null || expected === "") return true;

  const actual = valueForEvent(event.event_type, event.payload);
  if (actual === undefined) return false;

  return String(actual).toLowerCase().trim() === String(expected).toLowerCase().trim();
}

/** Que valor del payload se compara, segun el tipo de evento. */
function valueForEvent(
  eventType: string,
  payload: Record<string, unknown>
): unknown {
  switch (eventType) {
    case "tag_added":
    case "tag_removed":
      return payload.tag_name;
    case "field_changed":
      // Se filtra por que campo cambio, no por su valor: "cuando cambia el
      // presupuesto" es lo que se quiere automatizar, no "cuando el presupuesto
      // vale exactamente 5000".
      return payload.field_slug;
    case "assignment_changed":
      return payload.role;
    case "contact_created":
      return payload.source;
    case "do_not_contact":
      return payload.reason;
    default:
      return undefined;
  }
}
