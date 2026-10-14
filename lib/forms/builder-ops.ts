/**
 * Operaciones del constructor que el lienzo necesita y `builder.ts` no tenia (plano formularios-ui, F9 y F11):
 * insertar en una posicion, mover a una posicion, duplicar y cambiar el tipo. PURAS: el lienzo solo las compone.
 *
 * Reusan `lib/forms/builder.ts` y `fields.ts`; las reglas (claves unicas, condiciones solo hacia atras, prellenado
 * sin repetidos) son las de siempre. Una operacion que no cambia nada devuelve EL MISMO arreglo.
 */
import { uniqueIdentifier } from "@/lib/scheduling/booking-fields";
import { addField, pruneInvalidConditions } from "./builder";
import { MAX_FIELDS, hasOptions, newField, newFieldId, supportsPrefill, type FormField, type FormFieldType } from "./fields";
import type { Condition, ConditionGroup, VisibilityConfig } from "./visibility-types";

/** Mueve el campo de `from` para que quede en `to` (posicion final). Mismo arreglo si no hay nada que mover. */
export function moveFieldTo(fields: FormField[], from: number, to: number): FormField[] {
  if (from === to || from < 0 || to < 0 || from >= fields.length || to >= fields.length) return fields;
  const next = [...fields];
  const [moved] = next.splice(from, 1);
  next.splice(to, 0, moved);
  return pruneInvalidConditions(next);
}

/**
 * Donde queda un campo que se arrastra y se suelta "antes" o "despues" de otro. `overIndex` es la tarjeta sobre la que se
 * suelta; el resultado es la posicion FINAL del campo arrastrado (lista para `moveFieldTo`).
 */
export function dropTargetIndex(from: number, overIndex: number, position: "before" | "after"): number {
  const insertBefore = position === "before" ? overIndex : overIndex + 1;
  return from < insertBefore ? insertBefore - 1 : insertBefore;
}

/** Agrega un campo nuevo de ese tipo en `index` (0 = arriba de todo; `fields.length` = al final). */
export function insertFieldAt(fields: FormField[], type: FormFieldType, index: number): FormField[] {
  if (fields.length >= MAX_FIELDS) return fields;
  const appended = addField(fields, type);
  if (appended === fields) return fields;
  const at = Math.max(0, Math.min(index, fields.length));
  return moveFieldTo(appended, appended.length - 1, at);
}

/**
 * Duplica el campo y deja la copia justo debajo. La copia tiene clave NUEVA (sin chocar), no hereda el prellenado
 * (los parametros no se repiten entre campos) y un oculto toma su clave nueva como parametro. Nunca se mapea al contacto
 * por heredar: el mapeo es por clave y la clave es otra.
 */
export function duplicateField(fields: FormField[], index: number): { fields: FormField[]; index: number } | null {
  const source = fields[index];
  if (!source || fields.length >= MAX_FIELDS) return null;
  const key = uniqueIdentifier(source.key, fields.map((f) => f.key));
  const { prefill: _prefill, ...rest } = source;
  const copy: FormField = {
    ...structuredCloneField(rest),
    id: newFieldId(),
    key,
    ...(source.hidden?.source === "url_param" ? { hidden: { ...source.hidden, param: key } } : {}),
  };
  const next = [...fields.slice(0, index + 1), copy, ...fields.slice(index + 1)];
  return { fields: pruneInvalidConditions(next), index: index + 1 };
}

function structuredCloneField<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

const TEXT_LIKE: readonly FormFieldType[] = ["short_text", "long_text", "email", "phone", "number", "social"];

function withoutConditionsOn(visibility: VisibilityConfig | undefined, key: string): VisibilityConfig | undefined {
  if (!visibility) return undefined;
  const keep = (c: Condition) => c.fieldKey !== key;
  const conditions = visibility.conditions.filter(keep);
  const groups = visibility.groups.map((g): ConditionGroup => ({ ...g, conditions: g.conditions.filter(keep) })).filter((g) => g.conditions.length > 0);
  if (conditions.length === 0 && groups.length === 0) return undefined;
  return { ...visibility, conditions, groups };
}

/**
 * Cambia el tipo de una pregunta conservando lo que se pueda: la etiqueta, la ayuda, el texto de ejemplo (en los de
 * texto), si es obligatoria, la condicion propia, el prellenado (si el tipo nuevo se puede prellenar) y las opciones
 * (entre tipos de opciones). Lo propio del tipo nuevo arranca con sus valores por defecto.
 *
 * Al dejar de ser de opciones (o pasar a archivo, que no se puede comparar), se quitan las condiciones de las preguntas
 * de abajo que dependian de esta.
 */
export function changeFieldType(fields: FormField[], index: number, type: FormFieldType): FormField[] {
  const old = fields[index];
  if (!old || old.type === type) return fields;

  const base = newField(type, old.key, old.label);
  const next: FormField = {
    ...base,
    id: old.id,
    required: type === "hidden" ? false : type === "consent" ? true : old.required,
    ...(old.visibility ? { visibility: old.visibility } : {}),
  };
  if (type !== "hidden" && type !== "consent" && old.help) next.help = old.help;
  if (TEXT_LIKE.includes(type) && old.placeholder) next.placeholder = old.placeholder;
  if (hasOptions(type) && hasOptions(old.type) && old.options) next.options = old.options;
  if (type === "number" && old.type === "number") {
    if (old.min !== undefined) next.min = old.min;
    if (old.max !== undefined) next.max = old.max;
  }
  if (type === "number") {
    if (old.step !== undefined) next.step = old.step;
    if (old.metricKey !== undefined) next.metricKey = old.metricKey;
  }
  if (old.prefill && supportsPrefill(type) && type !== "hidden") next.prefill = old.prefill;
  if (type === "hidden") next.hidden = { source: "url_param", param: old.key };
  if (type === "consent" && old.type === "consent" && old.consentText) next.consentText = old.consentText;

  let out = fields.map((f, i) => (i === index ? next : f));
  if ((hasOptions(old.type) && !hasOptions(type)) || type === "file") {
    out = out.map((f, i) => (i > index && f.visibility ? withVisibility(f, withoutConditionsOn(f.visibility, old.key)) : f));
  }
  return pruneInvalidConditions(out);
}

function withVisibility(field: FormField, visibility: VisibilityConfig | undefined): FormField {
  if (visibility === field.visibility) return field;
  const { visibility: _old, ...rest } = field;
  void _old;
  return visibility ? { ...rest, visibility } : rest;
}
