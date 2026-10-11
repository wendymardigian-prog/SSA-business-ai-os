/**
 * Condiciones de mostrar u ocultar un campo (F5).
 *
 * Portado de `src/lib/visibility-utils.ts` de prevxcrm (el modelo
 * `{ rootConjunction, conditions, groups }`), con tres diferencias:
 *  - sin `service.*` ni `contact.*`: acá no aplican;
 *  - evaluación propia y pura, sin el evaluador de filtros del CRM;
 *  - ENCADENADA, y se vuelve a calcular en el servidor: un campo cuya condición
 *    mira un campo oculto ve ese valor como vacío. Así no se puede "colar" una
 *    respuesta por un campo que nunca se mostró.
 */
import type { FormField } from "./fields";
import type { Condition, ConditionGroup, VisibilityConfig } from "./visibility-types";

export type AnswerValue = string | number | boolean | string[] | null | undefined;
export type Answers = Record<string, AnswerValue>;

const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

function isEmpty(value: AnswerValue): boolean {
  if (value === null || value === undefined) return true;
  if (Array.isArray(value)) return value.length === 0;
  return String(value).trim() === "";
}

function asList(value: AnswerValue): string[] {
  if (value === null || value === undefined) return [];
  if (Array.isArray(value)) return value.map((v) => String(v).trim().toLowerCase());
  return [String(value).trim().toLowerCase()];
}

function asText(value: AnswerValue): string {
  if (value === null || value === undefined) return "";
  if (Array.isArray(value)) return value.join(",");
  return String(value).trim();
}

function norm(text: string): string {
  return text.trim().toLowerCase();
}

function compare(answer: AnswerValue, expected: string, test: (cmp: number) => boolean): boolean {
  const a = asText(answer);
  const b = expected.trim();
  if (a === "" || b === "") return false;
  if (ISO_DATE_RE.test(a) && ISO_DATE_RE.test(b)) return test(a < b ? -1 : a > b ? 1 : 0);
  const na = Number(a);
  const nb = Number(b);
  if (Number.isNaN(na) || Number.isNaN(nb)) return false;
  return test(na < nb ? -1 : na > nb ? 1 : 0);
}

export function evaluateCondition(condition: Condition, answers: Answers): boolean {
  const answer = answers[condition.fieldKey];
  const expected = condition.value ?? "";

  switch (condition.operator) {
    case "is_empty":
      return isEmpty(answer);
    case "is_not_empty":
      return !isEmpty(answer);
    case "is":
      if (isEmpty(answer)) return false;
      return asList(answer).includes(norm(expected));
    case "is_not":
      if (isEmpty(answer)) return true;
      return !asList(answer).includes(norm(expected));
    case "contains": {
      if (isEmpty(answer)) return false;
      if (Array.isArray(answer)) return asList(answer).includes(norm(expected));
      return norm(asText(answer)).includes(norm(expected));
    }
    case "not_contains": {
      if (isEmpty(answer)) return true;
      if (Array.isArray(answer)) return !asList(answer).includes(norm(expected));
      return !norm(asText(answer)).includes(norm(expected));
    }
    case "includes_any": {
      if (isEmpty(answer)) return false;
      const wanted = expected.split(",").map(norm).filter(Boolean);
      const given = asList(answer);
      return wanted.some((w) => given.includes(w));
    }
    case "gt":
      return compare(answer, expected, (c) => c > 0);
    case "lt":
      return compare(answer, expected, (c) => c < 0);
    case "gte":
      return compare(answer, expected, (c) => c >= 0);
    case "lte":
      return compare(answer, expected, (c) => c <= 0);
    default:
      return false;
  }
}

function evaluateGroup(group: ConditionGroup, answers: Answers): boolean | null {
  if (!group.conditions?.length) return null; // un grupo vacío no decide nada
  const results = group.conditions.map((c) => evaluateCondition(c, answers));
  return group.conjunction === "or" ? results.some(Boolean) : results.every(Boolean);
}

/** ¿Se cumple la regla con estas respuestas? Sin reglas, siempre. */
export function evaluateVisibility(visibility: VisibilityConfig | null | undefined, answers: Answers): boolean {
  if (!visibility) return true;
  const conditions = visibility.conditions ?? [];
  const groups = visibility.groups ?? [];
  if (conditions.length === 0 && groups.length === 0) return true;

  const results: boolean[] = conditions.map((c) => evaluateCondition(c, answers));
  for (const group of groups) {
    const r = evaluateGroup(group, answers);
    if (r !== null) results.push(r);
  }
  if (results.length === 0) return true;
  return visibility.rootConjunction === "or" ? results.some(Boolean) : results.every(Boolean);
}

/** Un campo suelto contra unas respuestas (sin encadenar: para una sola pregunta). */
export function isFieldVisible(field: Pick<FormField, "visibility">, answers: Answers): boolean {
  return evaluateVisibility(field.visibility, answers);
}

/**
 * Las claves que se muestran, en orden y ENCADENADAS: lo que dice un campo
 * oculto no cuenta para decidir los siguientes.
 */
export function visibleFieldKeys(fields: Array<Pick<FormField, "key" | "visibility">>, answers: Answers): string[] {
  const seen: Answers = {};
  const visible: string[] = [];
  for (const field of fields) {
    if (!evaluateVisibility(field.visibility, seen)) continue;
    visible.push(field.key);
    if (field.key in answers) seen[field.key] = answers[field.key];
  }
  return visible;
}

/** Descarta de las respuestas todo lo que no se muestra. */
export function pickVisibleAnswers(
  fields: Array<Pick<FormField, "key" | "visibility">>,
  answers: Answers,
): Answers {
  const keys = new Set(visibleFieldKeys(fields, answers));
  const out: Answers = {};
  for (const [key, value] of Object.entries(answers)) {
    if (keys.has(key)) out[key] = value;
  }
  return out;
}

/** Las claves de campos anteriores que una condición puede mirar. */
export function previousFieldKeys(fields: Array<Pick<FormField, "key">>, index: number): string[] {
  return fields.slice(0, index).map((f) => f.key);
}

/** Todas las claves que mira una configuración (para validar que sean anteriores). */
export function referencedKeys(visibility: VisibilityConfig | null | undefined): string[] {
  if (!visibility) return [];
  const keys = new Set<string>();
  for (const c of visibility.conditions ?? []) keys.add(c.fieldKey);
  for (const g of visibility.groups ?? []) for (const c of g.conditions ?? []) keys.add(c.fieldKey);
  return [...keys];
}
