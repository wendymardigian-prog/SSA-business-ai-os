/**
 * Lista cerrada de campos, operadores y etapas para las reglas de respuesta
 * (§10.3, F8). Es la fuente ÚNICA: la usan el editor, el validador del servidor
 * y el evaluador. Un campo fuera de esta lista no existe.
 */

export type RuleAction = "send" | "draft" | "skip";
export type RuleStage = "before_generation" | "after_generation";
/** "previa" mira el mensaje/contacto/conversación; "final" mira la respuesta del agente. */
export type FieldStage = "pre" | "final";
export type RuleOperator =
  | "contains_any"
  | "not_contains_any"
  | "is"
  | "is_not"
  | "gt"
  | "lt"
  | "has_any"
  | "has_none";
export type ValueType = "words" | "number" | "bool" | "temperature" | "channel" | "user" | "tags" | "intent";

export interface FieldDef {
  field: string;
  label: string;
  stage: FieldStage;
  operators: RuleOperator[];
  valueType: ValueType;
}

export const RULE_FIELDS: FieldDef[] = [
  { field: "inbound.text", label: "El mensaje del lead", stage: "pre", operators: ["contains_any", "not_contains_any"], valueType: "words" },
  { field: "inbound.is_known_button", label: "Es un texto de botón conocido", stage: "pre", operators: ["is"], valueType: "bool" },
  { field: "inbound.length", label: "Largo del mensaje del lead", stage: "pre", operators: ["gt", "lt"], valueType: "number" },
  { field: "inbound.burst_count", label: "Mensajes en la ráfaga", stage: "pre", operators: ["gt", "lt"], valueType: "number" },
  { field: "contact.temperature", label: "Temperatura del contacto", stage: "pre", operators: ["is", "is_not"], valueType: "temperature" },
  { field: "contact.tags", label: "Etiquetas del contacto", stage: "pre", operators: ["has_any", "has_none"], valueType: "tags" },
  { field: "contact.is_new", label: "Es contacto nuevo", stage: "pre", operators: ["is"], valueType: "bool" },
  { field: "contact.previous_episodes", label: "Conversaciones previas", stage: "pre", operators: ["gt", "lt"], valueType: "number" },
  { field: "conversation.assigned", label: "Está asignada", stage: "pre", operators: ["is"], valueType: "bool" },
  { field: "conversation.window_hours_left", label: "Ventana restante", stage: "pre", operators: ["gt", "lt"], valueType: "number" },
  { field: "conversation.is_episode_start", label: "Primer mensaje del episodio", stage: "pre", operators: ["is"], valueType: "bool" },
  { field: "conversation.channel", label: "Canal", stage: "pre", operators: ["is"], valueType: "channel" },
  { field: "time.in_business_hours", label: "Dentro del horario de atención", stage: "pre", operators: ["is"], valueType: "bool" },
  { field: "response.text", label: "La respuesta del agente", stage: "final", operators: ["contains_any", "not_contains_any"], valueType: "words" },
  { field: "response.has_link", label: "Incluye un link", stage: "final", operators: ["is"], valueType: "bool" },
  { field: "response.parts", label: "Mensajes de la respuesta", stage: "final", operators: ["gt", "lt"], valueType: "number" },
  { field: "agent.wants_escalate", label: "Quiere derivar", stage: "final", operators: ["is"], valueType: "bool" },
  { field: "agent.kb_miss", label: "No encontró en Conocimiento", stage: "final", operators: ["is"], valueType: "bool" },
  { field: "agent.used_tool", label: "Usó la herramienta", stage: "final", operators: ["is"], valueType: "words" },
  // La intención se suma en el Bloque 5 (F26); la condición ya vive acá.
  { field: "intent.category", label: "La intención del mensaje", stage: "final", operators: ["is", "is_not"], valueType: "intent" },
];

const BY_FIELD = new Map(RULE_FIELDS.map((f) => [f.field, f]));

export function fieldDef(field: string): FieldDef | undefined {
  return BY_FIELD.get(field);
}

/** Un campo es de la etapa previa (se puede evaluar antes de generar). */
export function isPreField(field: string): boolean {
  return fieldDef(field)?.stage === "pre";
}

export const RULE_ACTIONS: RuleAction[] = ["send", "draft", "skip"];
export const TEMPERATURES = ["cold", "warm", "hot"] as const;
