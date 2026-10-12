/**
 * Agregar preguntas a un EOD con los valores de un EOD: el número arranca en 0 y
 * suma de a 1. Puro; reusa el builder de Formularios.
 */
import { addField } from "@/lib/forms/builder";
import { EOD_FIELD_TYPES, type FormField, type FormFieldType } from "@/lib/forms/fields";

export function addEodField(fields: FormField[], type: FormFieldType): FormField[] {
  if (!(EOD_FIELD_TYPES as readonly string[]).includes(type)) return fields;
  const next = addField(fields, type);
  if (next.length === fields.length) return fields;
  const created = next[next.length - 1];
  const { prefill: _prefill, ...rest } = created;
  const field: FormField = type === "number" ? { ...rest, min: 0, step: 1 } : rest;
  return [...fields, field];
}
