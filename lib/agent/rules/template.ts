import type { Rule } from "./evaluate";

/**
 * Plantilla inicial de reglas (§10.4). Se ofrece la primera vez que se elige
 * "Según reglas". La acción por defecto de la plantilla es "draft".
 */
export function defaultRulesTemplate(): { rules: Rule[]; defaultAction: "draft" } {
  return {
    defaultAction: "draft",
    rules: [
      { id: "r_1", name: "Texto de botón conocido", enabled: true, action: "skip",
        conditions: [{ field: "inbound.is_known_button", op: "is", value: true }] },
      { id: "r_2", name: "Autorespuesta recibida", enabled: true, action: "skip",
        conditions: [{ field: "inbound.text", op: "contains_any", value: ["gracias por ponerte en contacto", "recibimos tu mensaje", "te responderemos a la brevedad"] }] },
      { id: "r_3", name: "Menciona precio", enabled: true, action: "draft",
        conditions: [{ field: "response.text", op: "contains_any", value: ["precio", "$", "usd", "cuotas", "link de pago", "descuento", "inversion"] }] },
      { id: "r_4", name: "El agente quiere derivar", enabled: true, action: "draft",
        conditions: [{ field: "agent.wants_escalate", op: "is", value: true }] },
      { id: "r_5", name: "No encontró en Conocimiento", enabled: true, action: "draft",
        conditions: [{ field: "agent.kb_miss", op: "is", value: true }] },
      { id: "r_6", name: "Contacto caliente", enabled: true, action: "draft",
        conditions: [{ field: "contact.temperature", op: "is", value: "hot" }] },
      { id: "r_7", name: "Alumno o soporte", enabled: true, action: "draft",
        conditions: [{ field: "contact.tags", op: "has_any", value: ["alumno-actual", "soporte-alumno"] }] },
      { id: "r_8", name: "Mensaje largo", enabled: true, action: "draft",
        conditions: [{ field: "inbound.length", op: "gt", value: 200 }] },
      { id: "r_9", name: "Mensaje corto y respuesta simple", enabled: true, action: "send",
        conditions: [
          { field: "inbound.length", op: "lt", value: 25 },
          { field: "response.parts", op: "lt", value: 2 },
          { field: "response.has_link", op: "is", value: false },
        ] },
    ],
  };
}
