/**
 * Las variables que el selector ofrece en cada paso (auditoria de automatizaciones, oct 2026). Puro: lo usa el panel
 * lateral del lienzo.
 *
 * Antes el selector ofrecia `{{message}}` en TODOS los flujos (en uno de agenda o de webhook no existe) y nunca
 * mostraba las de agenda, formularios, ventas, llamadas, tareas, webhooks ni las del contacto. Ahora sale de tres
 * fuentes:
 *  1. lo que trae el disparador: lo fijo (`staticTriggerVariables`) y lo que el servidor sabe (el esquema de campos
 *     de `getConditionCatalogInputs`: las preguntas de un formulario, los datos de la reunion…);
 *  2. los datos del contacto y del negocio, que el motor siembra al arrancar (`seedContactVariables`);
 *  3. lo que escriben los pasos ANTERIORES (`ai_response`, la respuesta de una Llamada HTTP, `contact_result`).
 *
 * `variable-catalog.test.ts` comprueba que cada variable que se ofrece de forma fija se resuelve con un contexto de
 * ejemplo de su disparador.
 */

/** Los disparadores de mensaje: el texto del mensaje y su origen. */
const MESSAGE_VARIABLES = ["message", "message_origin.ad_id", "message_origin.ad_title", "message_origin.is_story_mention"];

/** Lo que el motor siembra cuando el flujo tiene contacto (y el negocio, siempre). */
export const CONTACT_VARIABLES = ["contact.display_name", "contact.first_name", "contact.email", "contact.phone"] as const;
export const WORKSPACE_VARIABLES = ["workspace.name"] as const;

/** Las variables fijas que trae cada disparador (las que dependen de la base vienen del esquema del servidor). */
export function staticTriggerVariables(triggerType: string | null | undefined): string[] {
  switch (triggerType) {
    case "keyword":
    case "welcome":
    case "default":
    case "postback":
    case "quick_reply":
      return [...MESSAGE_VARIABLES];
    case "comment_keyword":
      return ["message", "comment_id", "comment_text", "commenter_name", "post_id", "content.title", "content.code"];
    case "email_received":
      return ["message", "email_subject"];
    case "inactivity":
      return ["inactivity_hours"];
    case "new_contact":
      return ["event_type", "event_source"];
    case "crm_event":
      return ["event_type", "event_tag_name", "event_value", "event_role", "event_reason"];
    default:
      return [];
  }
}

/** Disparadores cuyos flujos no tienen contacto al arrancar (las variables del contacto no aplican al principio). */
const NO_CONTACT_AT_START = new Set<string>([
  "webhook_received", // @plantilla-quitar(webhooks)
  "eod_submitted", // @plantilla-quitar(formularios)
]);

export interface PickerVariablesInput {
  triggerType: string | null | undefined;
  /** Las rutas del esquema del disparador que devolvio el servidor (`ConditionFieldSpec.path`). */
  schemaPaths?: string[];
  /** Las variables que escriben los pasos ANTERIORES a este. */
  upstreamOutputs?: string[];
  /** Hay un «Crear o actualizar contacto» antes de este paso (en un flujo que arranca sin contacto). */
  contactBefore?: boolean;
}

/** Una ruta del esquema como variable: sin el prefijo `variable:` y sin las que no son variables (`tag:`, campos sueltos). */
function schemaPathToVariable(path: string): string | null {
  if (path.startsWith("variable:")) return path.slice("variable:".length) || null;
  return /^[a-z_]+\./i.test(path) ? path : null;
}

/** La lista final del selector, sin repetidas y en un orden que se lee: disparador, pasos anteriores, contacto, negocio. */
export function pickerVariables(input: PickerVariablesInput): string[] {
  const out: string[] = [];
  const push = (v: string | null | undefined) => {
    if (v && !out.includes(v)) out.push(v);
  };
  for (const v of staticTriggerVariables(input.triggerType)) push(v);
  for (const path of input.schemaPaths ?? []) push(schemaPathToVariable(path));
  for (const v of input.upstreamOutputs ?? []) push(v);
  const hasContact = !NO_CONTACT_AT_START.has(input.triggerType ?? "") || input.contactBefore === true;
  if (hasContact && input.triggerType !== "eod_submitted") for (const v of CONTACT_VARIABLES) push(v);
  for (const v of WORKSPACE_VARIABLES) push(v);
  return out;
}

/** El nombre de pila: la primera palabra del nombre visible. */
export function firstNameOf(displayName: string | null | undefined): string {
  return (displayName ?? "").trim().split(/\s+/)[0] ?? "";
}

/**
 * Las variables del contacto y del negocio que el motor siembra (sin pisar lo que ya vino del disparador: Ventas trae
 * sus propias `contact.*`). Puro: el motor le pasa lo que leyo.
 */
export function seedContactVariables(
  variables: Record<string, unknown>,
  contact: { display_name?: string | null; email?: string | null; phone?: string | null } | null,
  workspace: { name?: string | null } | null,
): Record<string, unknown> {
  const next = { ...variables };
  if (contact) {
    const existing = next.contact && typeof next.contact === "object" && !Array.isArray(next.contact) ? (next.contact as Record<string, unknown>) : {};
    const displayName = contact.display_name ?? "";
    next.contact = {
      display_name: displayName,
      // `contact.name` lo usaban algunos ejemplos: queda como alias del nombre visible.
      name: displayName,
      first_name: firstNameOf(displayName),
      email: contact.email ?? "",
      phone: contact.phone ?? "",
      ...existing,
    };
  }
  if (workspace) {
    const existing = next.workspace && typeof next.workspace === "object" && !Array.isArray(next.workspace) ? (next.workspace as Record<string, unknown>) : {};
    next.workspace = { name: workspace.name ?? "", ...existing };
  }
  return next;
}
