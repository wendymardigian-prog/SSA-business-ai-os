/**
 * Los nombres «grupo.campo» de las variables que antes no lo seguían (traído de RER el 25/11/2026). PURO: lo usan el motor
 * (`interpolate.ts`) y el simulador del navegador (`simulator.ts`), así que no puede importar nada de servidor.
 *
 * Las variables viejas siguen funcionando igual: el selector ofrece solo los nombres nuevos y cada nombre nuevo apunta a
 * la ruta de siempre. La regla al resolver es «primero la ruta tal cual y, solo si no existe, la del alias»: nunca cambia
 * algo que hoy ya se resuelve (en un grupo de WhatsApp, `message` es un objeto y `message.text` se lee directo).
 *
 *   {{form.answer.x}}       → {{answer.x}}            {{form.answer_raw.x}} → {{answer_raw.x}}
 *   {{booking.answer.x}}    → {{booking.answers.x}}
 *   {{message.text}}        → {{message}}             {{message.origin.x}}  → {{message_origin.x}}
 *   {{comment.text}}        → {{comment_text}}        (y comment.id, comment.author_name, comment.post_id)
 *   {{email.subject}}       → {{email_subject}}       {{inactivity.hours}}  → {{inactivity_hours}}
 *   {{event.type}}          → {{event_type}}          (y el resto de event_*)
 *   {{ai.response}}         → {{ai_response}}
 *   {{contact.result}}      → {{contact_result}}      {{contact.fail_reason}} → {{contact_fail_reason}}
 */

/** Nombre nuevo exacto → ruta real. */
const EXACT: Record<string, string> = {
  "message.text": "message",
  "comment.text": "comment_text",
  "comment.id": "comment_id",
  "comment.author_name": "commenter_name",
  "comment.post_id": "post_id",
  "email.subject": "email_subject",
  "inactivity.hours": "inactivity_hours",
  "event.type": "event_type",
  "event.source": "event_source",
  "event.tag_name": "event_tag_name",
  "event.value": "event_value",
  "event.role": "event_role",
  "event.reason": "event_reason",
  "event.level": "event_level",
  "event.previous_level": "event_previous_level",
  "ai.response": "ai_response",
  "contact.result": "contact_result",
  "contact.fail_reason": "contact_fail_reason",
};

/** Prefijo nuevo → prefijo real (lo que sigue se copia igual). */
const PREFIXES: ReadonlyArray<readonly [string, string]> = [
  ["form.answer_raw.", "answer_raw."],
  ["form.answer.", "answer."],
  ["booking.answer.", "booking.answers."],
  ["message.origin.", "message_origin."],
];

/** La ruta real de un nombre nuevo, o null si no es un alias. */
export function aliasFor(path: string): string | null {
  const exact = EXACT[path];
  if (exact) return exact;
  for (const [from, to] of PREFIXES) {
    if (path.startsWith(from) && path.length > from.length) return to + path.slice(from.length);
  }
  return null;
}

/** Todos los nombres nuevos exactos (para la documentación y los tests). */
export const EXACT_ALIASES: Readonly<Record<string, string>> = EXACT;

/** El nombre nuevo de una ruta vieja, para que el selector ofrezca solo los nuevos. Lo que no tiene alias queda igual. */
export function preferredName(path: string): string {
  for (const [alias, real] of Object.entries(EXACT)) if (real === path) return alias;
  for (const [from, to] of PREFIXES) {
    if (path.startsWith(to) && path.length > to.length) return from + path.slice(to.length);
  }
  return path;
}
