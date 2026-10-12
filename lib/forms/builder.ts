/**
 * Operaciones puras del builder de campos (F4). La interfaz solo las compone.
 *
 * Reglas que cuidan acá:
 *  - La `key` de un campo es la clave de las respuestas y de `{{answer.<key>}}`:
 *    NO cambia cuando se edita la etiqueta de un formulario ya publicado. Mientras
 *    nunca se publicó y la clave sigue siendo la automática de la etiqueta, acompaña.
 *  - Una condición solo puede mirar campos ANTERIORES: al mover o borrar, las que
 *    quedan apuntando a algo que ya no es anterior se sacan (si no, no se podría
 *    publicar).
 *  - Los parámetros de prellenado no se repiten entre campos.
 */
import { identifierFromLabel, uniqueIdentifier } from "@/lib/scheduling/booking-fields";
import { MAX_FIELDS, newField, type FormField, type FormFieldType } from "./fields";
import { prefillAliasesFor } from "./prefill";
import type { Condition, ConditionGroup, VisibilityConfig } from "./visibility-types";

/** La clave automática que corresponde a una etiqueta, sin chocar con otras. */
export function autoKey(label: string, otherKeys: string[]): string {
  return uniqueIdentifier(identifierFromLabel(label), otherKeys);
}

export function addField(fields: FormField[], type: FormFieldType): FormField[] {
  if (fields.length >= MAX_FIELDS) return fields;
  const base = newField(type, "tmp");
  const key = autoKey(base.label, fields.map((f) => f.key));
  const created = type === "hidden" ? { ...newField(type, key, base.label), hidden: { source: "url_param" as const, param: key } } : { ...newField(type, key, base.label) };
  // Un campo de email, teléfono o red social también se llena con el nombre corto de su tipo (?email=…), si nadie lo usa.
  const aliases = prefillAliasesFor(created, fields);
  const field: FormField = aliases.length > 0 ? { ...created, prefill: { params: [key, ...aliases], behavior: "editable" } } : created;
  return [...fields, field];
}

function dropConditionsOn(visibility: VisibilityConfig | undefined, allowed: Set<string>): VisibilityConfig | undefined {
  if (!visibility) return undefined;
  const keep = (c: Condition) => allowed.has(c.fieldKey);
  const conditions = visibility.conditions.filter(keep);
  const groups = visibility.groups
    .map((g): ConditionGroup => ({ ...g, conditions: g.conditions.filter(keep) }))
    .filter((g) => g.conditions.length > 0);
  if (conditions.length === 0 && groups.length === 0) return undefined;
  return { ...visibility, conditions, groups };
}

/** Saca las condiciones que miran un campo que ya no es anterior (movido o borrado). */
export function pruneInvalidConditions(fields: FormField[]): FormField[] {
  return fields.map((field, index) => {
    if (!field.visibility) return field;
    const allowed = new Set(fields.slice(0, index).map((f) => f.key));
    const visibility = dropConditionsOn(field.visibility, allowed);
    if (visibility === field.visibility) return field;
    const { visibility: _old, ...rest } = field;
    void _old;
    return visibility ? { ...rest, visibility } : rest;
  });
}

export function removeField(fields: FormField[], index: number): FormField[] {
  if (index < 0 || index >= fields.length) return fields;
  return pruneInvalidConditions(fields.filter((_, i) => i !== index));
}

export function moveField(fields: FormField[], index: number, delta: -1 | 1): FormField[] {
  const target = index + delta;
  if (index < 0 || index >= fields.length || target < 0 || target >= fields.length) return fields;
  const next = [...fields];
  [next[index], next[target]] = [next[target], next[index]];
  return pruneInvalidConditions(next);
}

export function updateField(fields: FormField[], index: number, patch: Partial<FormField>): FormField[] {
  if (index < 0 || index >= fields.length) return fields;
  return fields.map((f, i) => (i === index ? { ...f, ...patch } : f));
}

/** Reescribe las referencias a una clave (condiciones de los siguientes y su propio prellenado). */
function renameKeyReferences(fields: FormField[], from: string, to: string): FormField[] {
  const swap = (c: Condition): Condition => (c.fieldKey === from ? { ...c, fieldKey: to } : c);
  return fields.map((field) => {
    let next = field;
    if (field.visibility) {
      next = {
        ...next,
        visibility: {
          ...field.visibility,
          conditions: field.visibility.conditions.map(swap),
          groups: field.visibility.groups.map((g) => ({ ...g, conditions: g.conditions.map(swap) })),
        },
      };
    }
    if (field.key === to && field.prefill) {
      next = { ...next, prefill: { ...field.prefill, params: field.prefill.params.map((p) => (p === from ? to : p)) } };
    }
    if (field.key === to && field.hidden?.source === "url_param" && field.hidden.param === from) {
      next = { ...next, hidden: { ...field.hidden, param: to } };
    }
    return next;
  });
}

/**
 * Cambia la etiqueta. La clave acompaña SOLO si el formulario nunca se publicó y
 * la clave todavía es la automática de la etiqueta anterior (no se editó a mano).
 */
export function relabelField(fields: FormField[], index: number, label: string, neverPublished: boolean): FormField[] {
  const field = fields[index];
  if (!field) return fields;
  const others = fields.filter((_, i) => i !== index).map((f) => f.key);
  const followsLabel = neverPublished && field.key === autoKey(field.label, others);

  const updated = updateField(fields, index, { label });
  if (!followsLabel) return updated;

  const newKey = autoKey(label, others);
  if (newKey === field.key) return updated;
  return renameKeyReferences(updateField(updated, index, { key: newKey }), field.key, newKey);
}

/** Cambia la clave a mano (solo mientras nunca se publicó). */
export function setFieldKey(fields: FormField[], index: number, key: string): { fields: FormField[]; error?: string } {
  const field = fields[index];
  if (!field) return { fields };
  const clean = key.trim().toLowerCase();
  if (!/^[a-z][a-z0-9_]{0,39}$/.test(clean)) return { fields, error: "Usá minúsculas, números y guión bajo, empezando con una letra" };
  if (fields.some((f, i) => i !== index && f.key === clean)) return { fields, error: "Ya hay otro campo con esa clave" };
  return { fields: renameKeyReferences(updateField(fields, index, { key: clean }), field.key, clean) };
}

/** Los campos anteriores a uno, con su etiqueta y tipo, para el constructor de condiciones. */
export function conditionSources(fields: FormField[], index: number): Array<{ key: string; label: string; type: FormFieldType; options?: string[] }> {
  return fields
    .slice(0, index)
    // Un archivo no se puede comparar con nada; todo lo demás sí.
    .filter((f) => f.type !== "file")
    .map((f) => ({ key: f.key, label: f.label, type: f.type, options: f.options }));
}
