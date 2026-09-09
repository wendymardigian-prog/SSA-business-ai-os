/**
 * Catalogo de campos del nodo Condition, compartido entre el panel y el motor.
 *
 * El panel guardaba `field: "tag"` y el registro busca `"tag:"` — con los dos
 * puntos y el nombre del tag detras. Nunca coincidian, asi que **ninguna**
 * condicion dibujada a mano resolvia: todas caian al fallback de campo
 * personalizado y devolvian undefined. Encima el panel no tenia donde escribir
 * el argumento (que tag, que variable, que secuencia).
 *
 * Este modulo es la unica fuente de esos prefijos. Es puro y sin Supabase, asi
 * que lo importan el panel (cliente) y los tests de consistencia.
 */

/** Que hay que pedirle al usuario despues de elegir el campo. */
export type ConditionArgumentKind =
  /** Nada: el campo se llama exactamente asi. */
  | "none"
  /** Texto libre (nombre de un tag, de una variable, slug de un campo). */
  | "text"
  /** Una secuencia del workspace, elegida de una lista. */
  | "sequence";

/** Que forma tiene el valor a comparar. */
export type ConditionValueKind = "text" | "boolean";

export interface ConditionFieldOption {
  /** Prefijo con dos puntos ("tag:") o nombre exacto ("platform"). */
  prefix: string;
  label: string;
  argument: ConditionArgumentKind;
  argumentLabel?: string;
  argumentPlaceholder?: string;
  valueKind: ConditionValueKind;
  hint?: string;
}

export const CONDITION_FIELDS: ConditionFieldOption[] = [
  {
    prefix: "tag:",
    label: "Tiene el tag",
    argument: "text",
    argumentLabel: "Nombre del tag",
    argumentPlaceholder: "interesado",
    valueKind: "boolean",
  },
  {
    prefix: "sequence:",
    label: "Está en la secuencia",
    argument: "sequence",
    argumentLabel: "Secuencia",
    valueKind: "boolean",
    hint: "Cuenta si la inscripción sigue viva, aunque esté pausada porque respondió.",
  },
  {
    prefix: "sequence_ever:",
    label: "Estuvo alguna vez en la secuencia",
    argument: "sequence",
    argumentLabel: "Secuencia",
    valueKind: "boolean",
    hint: "Cuenta también las que ya terminaron o se cancelaron.",
  },
  {
    prefix: "platform",
    label: "Canal",
    argument: "none",
    valueKind: "text",
  },
  {
    prefix: "is_subscribed",
    label: "Está suscripto",
    argument: "none",
    valueKind: "boolean",
  },
  {
    prefix: "variable:",
    label: "Variable del flow",
    argument: "text",
    argumentLabel: "Nombre de la variable",
    argumentPlaceholder: "ai_response",
    valueKind: "text",
  },
  {
    // Sin prefijo: el campo es el slug del campo personalizado tal cual.
    prefix: "",
    label: "Campo personalizado",
    argument: "text",
    argumentLabel: "Identificador del campo",
    argumentPlaceholder: "presupuesto",
    valueKind: "text",
  },
];

export function findConditionField(prefix: string): ConditionFieldOption | undefined {
  return CONDITION_FIELDS.find((f) => f.prefix === prefix);
}

/**
 * Parte un `field` guardado en prefijo + argumento.
 *
 * Se prueban los prefijos mas largos primero: sin eso "sequence_ever:abc"
 * podria caer en "sequence:" y evaluar la condicion equivocada.
 */
export function splitConditionField(field: string): { prefix: string; argument: string } {
  const withColon = CONDITION_FIELDS.filter((f) => f.prefix.endsWith(":")).sort(
    (a, b) => b.prefix.length - a.prefix.length
  );

  for (const option of withColon) {
    if (field.startsWith(option.prefix)) {
      return { prefix: option.prefix, argument: field.slice(option.prefix.length) };
    }
  }

  const exact = CONDITION_FIELDS.find((f) => f.prefix !== "" && !f.prefix.endsWith(":") && f.prefix === field);
  if (exact) return { prefix: exact.prefix, argument: "" };

  // Cualquier otra cosa es el slug de un campo personalizado.
  return { prefix: "", argument: field };
}

export function joinConditionField(prefix: string, argument: string): string {
  if (prefix.endsWith(":")) return `${prefix}${argument.trim()}`;
  if (prefix === "") return argument.trim();
  return prefix;
}
