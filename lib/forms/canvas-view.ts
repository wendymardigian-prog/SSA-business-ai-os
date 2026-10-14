/**
 * Lo que dice cada tarjeta del lienzo (plano formularios-ui, F9): los chips de condicion y de mapeo, como se ven
 * las opciones, la nota de un campo oculto, los tipos del selector y los atajos del formulario vacio. Puro.
 */
import { FIXED_TARGET_LABELS, isCustomTarget, targetLabel, type ContactConfig, type CustomFieldDef, type FixedTarget } from "./contact-config";
import { EOD_FIELD_TYPES, FIELD_TYPE_LABELS, FORM_FIELD_TYPES, type FormField, type FormFieldType, type FormType } from "./fields";
import { OPERATOR_LABELS, UNARY_OPERATORS, type Condition } from "./visibility-types";

/** Una frase corta para la condicion de una pregunta: "Si ¿Qué negocio tenés? = Otro" (con "+N" si hay mas de una). */
export function conditionChip(field: FormField, fields: FormField[]): string | null {
  const vis = field.visibility;
  if (!vis) return null;
  const all: Condition[] = [...vis.conditions, ...vis.groups.flatMap((g) => g.conditions)];
  if (all.length === 0) return null;
  const first = all[0];
  const source = fields.find((f) => f.key === first.fieldKey);
  const name = source ? source.label || source.key : first.fieldKey;
  const op = first.operator === "is" ? "=" : OPERATOR_LABELS[first.operator];
  const value = UNARY_OPERATORS.includes(first.operator) ? "" : ` ${first.value}`;
  const extra = all.length > 1 ? ` +${all.length - 1}` : "";
  return `Si ${name} ${op}${value}${extra}`;
}

/** "→ Email" para una pregunta que se guarda en el contacto; null si no. */
export function mappingChip(field: FormField, config: ContactConfig, customFields: CustomFieldDef[]): string | null {
  const entry = config.map.find((m) => m.fieldKey === field.key);
  if (!entry) return null;
  if (isCustomTarget(entry.target)) return `→ ${targetLabel(entry.target, customFields).replace(/^Campo personalizado: /, "")}`;
  return `→ ${FIXED_TARGET_LABELS[entry.target as FixedTarget] ?? entry.target}`;
}

/** Las primeras 6 opciones y cuantas quedan afuera ("y 3 más"). Una opcion sin texto se marca. */
export function shownOptions(options: string[] | undefined, limit = 6): { shown: Array<{ text: string; empty: boolean }>; more: number } {
  const all = options ?? [];
  return { shown: all.slice(0, limit).map((text) => ({ text, empty: text.trim() === "" })), more: Math.max(0, all.length - limit) };
}

/** La nota de un campo oculto: de donde toma el valor. */
export function hiddenNote(field: FormField): string {
  const hidden = field.hidden;
  if (!hidden) return "No lo ve quien responde.";
  if (hidden.source === "fixed") return "No lo ve quien responde. Guarda un valor fijo.";
  if (hidden.source === "attribution") return "No lo ve quien responde. Guarda un dato de la visita (ya se guarda solo).";
  return `No lo ve quien responde. Toma ${hidden.param || field.key} de la dirección de la página.`;
}

/** Los tipos del selector, agrupados como en el prototipo. En un reporte de fin de dia, solo los que acepta. */
export const PICKER_GROUPS: Array<{ title: string; types: FormFieldType[] }> = [
  { title: "Datos de contacto", types: ["email", "phone", "social"] },
  { title: "Texto", types: ["short_text", "long_text", "number", "date"] },
  { title: "Opciones", types: ["single_select", "multi_select", "rating", "nps"] },
  { title: "Otros", types: ["file", "consent", "hidden"] },
];

export function pickerGroups(formType: FormType): Array<{ title: string; types: Array<{ type: FormFieldType; label: string }> }> {
  const allowed: readonly FormFieldType[] = formType === "eod" ? EOD_FIELD_TYPES : FORM_FIELD_TYPES;
  return PICKER_GROUPS.map((g) => ({
    title: g.title,
    types: g.types.filter((t) => allowed.includes(t)).map((type) => ({ type, label: FIELD_TYPE_LABELS[type] })),
  })).filter((g) => g.types.length > 0);
}

/** Los cinco tipos comunes que se ofrecen como atajo en un formulario vacio. */
export function emptyShortcuts(formType: FormType): Array<{ type: FormFieldType; label: string }> {
  const allowed: readonly FormFieldType[] = formType === "eod" ? EOD_FIELD_TYPES : FORM_FIELD_TYPES;
  return (["short_text", "email", "phone", "single_select", "long_text"] as const)
    .filter((t) => allowed.includes(t))
    .map((type) => ({ type, label: FIELD_TYPE_LABELS[type] }));
}
