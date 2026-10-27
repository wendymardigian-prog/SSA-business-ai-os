/**
 * La logica del constructor de condiciones (`components/automations/condition-builder.tsx`):
 * que operadores ofrece cada campo, que hay que pedir segun el operador, y como
 * se arma, se cambia y se revisa una condicion. PURO: sin React, sin Supabase.
 *
 * El componente solo compone esto. Lo usan dos cosas con formatos guardados
 * distintos (y por eso el constructor trabaja sobre un modelo comun y el que lo
 * usa traduce):
 *   - los caminos de "Condiciones" (`BranchCondition`, ver `condition-eval.ts`);
 *   - la visibilidad de un campo de formulario y el "Solo si…" del disparador
 *     (`VisibilityConfig`, ver `lib/forms/visibility-types.ts`), que NO cambian
 *     de formato.
 *
 * Regla de la casa: una seleccion SIEMPRE se elige de un desplegable con sus
 * opciones; nunca se escribe a mano.
 */

import {
  OPERATORS_BY_TYPE,
  type BranchCondition,
  type ConditionFieldSpec,
  type ConditionValueType,
  type FieldArgumentSpec,
  type FieldOption,
  describeCondition,
  isLegacyOperator,
} from "@/lib/flow-engine/condition-eval";
import { findFieldSpec, type ConditionFieldGroup } from "@/lib/flow-engine/condition-catalog";

// ------------------------------------------------------------
// Modelo comun del constructor
// ------------------------------------------------------------

/** Una condicion tal como la edita el constructor. Es un `BranchCondition` mas la clave de React. */
export type BuilderCondition = BranchCondition & { id?: string };

export interface BuilderGroup {
  id?: string;
  conjunction: "and" | "or";
  conditions: BuilderCondition[];
}

/** Reglas sueltas mas grupos, cada grupo con su propio "y / o". */
export interface BuilderValue {
  rootConjunction: "and" | "or";
  conditions: BuilderCondition[];
  groups: BuilderGroup[];
}

export const EMPTY_BUILDER_VALUE: BuilderValue = { rootConjunction: "and", conditions: [], groups: [] };

/** Que pide el constructor despues de elegir el operador. */
export type SlotKind = "text" | "number" | "date" | "boolean" | "options" | "options-multi" | "days";
export interface ValueSlot {
  kind: SlotKind;
  /** En que parte de la condicion se guarda. */
  target: "value" | "value2" | "values";
  /** La etiqueta accesible del campo ("Valor", "Hasta"). */
  label: string;
  placeholder?: string;
}

export interface OperatorChoice {
  id: string;
  label: string;
}

/** Un campo que se puede elegir en el constructor. */
export interface BuilderField {
  /** La ruta que se guarda. Con argumento, es el prefijo (`has_active_sale:`). */
  path: string;
  label: string;
  group?: string;
  type: ConditionValueType;
  options?: FieldOption[];
  argument?: FieldArgumentSpec;
  hint?: string;
  /** Si quien lo usa tiene sus propios operadores. Sin esto, los del tipo. */
  operators?: OperatorChoice[];
  /** Idem para como se pide el valor. Sin esto, el del tipo y el operador. */
  slots?: (operator: string) => ValueSlot[];
}

// ------------------------------------------------------------
// Operadores y valores
// ------------------------------------------------------------

export function operatorsOf(field: BuilderField): OperatorChoice[] {
  return field.operators ?? OPERATORS_BY_TYPE[field.type].map((o) => ({ id: o.id, label: o.label }));
}

export function defaultOperatorOf(field: BuilderField): string {
  return operatorsOf(field)[0]?.id ?? "is";
}

export function isOperatorValid(field: BuilderField, operator: string): boolean {
  return operatorsOf(field).some((o) => o.id === operator);
}

/** Que hay que pedir para este operador de este campo. Un operador sin valor (`is_empty`) pide nada. */
export function slotsOf(field: BuilderField, operator: string): ValueSlot[] {
  if (field.slots) return field.slots(operator);
  const info = OPERATORS_BY_TYPE[field.type].find((o) => o.id === operator);
  if (!info) return [];
  switch (info.arity) {
    case "none":
      return [];
    case "list":
      return [{ kind: "options-multi", target: "values", label: "Opciones" }];
    case "days":
      return [{ kind: "days", target: "value", label: "Cantidad de días" }];
    case "two": {
      const kind: SlotKind = field.type === "date" ? "date" : "number";
      return [
        { kind, target: "value", label: "Desde" },
        { kind, target: "value2", label: "Hasta" },
      ];
    }
    case "one":
      switch (field.type) {
        case "number":
          return [{ kind: "number", target: "value", label: "Valor" }];
        case "date":
          return [{ kind: "date", target: "value", label: "Fecha" }];
        case "single_select":
        case "multi_select":
          return [{ kind: "options", target: "value", label: "Valor" }];
        default:
          return [{ kind: "text", target: "value", label: "Valor" }];
      }
  }
}

/** Un campo del catalogo (`ConditionFieldSpec`) como lo ve el constructor. */
export function builderFieldFromSpec(spec: ConditionFieldSpec): BuilderField {
  return {
    path: spec.path,
    label: spec.label,
    ...(spec.group ? { group: spec.group } : {}),
    type: spec.type,
    ...(spec.options ? { options: spec.options } : {}),
    ...(spec.argument ? { argument: spec.argument } : {}),
    ...(spec.hint ? { hint: spec.hint } : {}),
  };
}

/**
 * Los campos que se ofrecen para ARMAR condiciones nuevas: los del catalogo menos
 * los que solo siguen valiendo para flujos viejos (`legacy`). Los viejos se
 * siguen reconociendo al leer (`fieldOfCondition` mira todos).
 */
export function offeredFields(groups: ConditionFieldGroup[]): BuilderField[] {
  return groups.flatMap((g) => g.fields.filter((f) => !f.legacy).map((f) => builderFieldFromSpec({ ...f, group: g.label })));
}

/** Todos los campos del catalogo (con los viejos), para reconocer una condicion ya guardada. */
export function recognizedFields(groups: ConditionFieldGroup[]): BuilderField[] {
  return groups.flatMap((g) => g.fields.map((f) => builderFieldFromSpec({ ...f, group: g.label })));
}

/** El campo al que apunta la ruta de una condicion guardada (los que piden argumento se reconocen por prefijo). */
export function fieldOfCondition(fields: BuilderField[], path: string): BuilderField | undefined {
  const exact = fields.find((f) => f.path === path);
  if (exact) return exact;
  return fields.find((f) => f.argument && path.startsWith(f.path));
}

/** Lo que va despues del prefijo (`has_active_sale:` + `prod-1` → `prod-1`). */
export function argumentOf(field: BuilderField, path: string): string {
  return field.argument && path.startsWith(field.path) ? path.slice(field.path.length) : "";
}

/** La ruta que se guarda: el prefijo mas lo que se escribio o eligio. */
export function joinPath(field: BuilderField, argument: string): string {
  return field.argument ? `${field.path}${argument.trim()}` : field.path;
}

// ------------------------------------------------------------
// Armar y cambiar una condicion
// ------------------------------------------------------------

export function newConditionId(random: () => number = Math.random): string {
  return `c_${random().toString(36).slice(2, 9)}`;
}

/** Una condicion en blanco sobre este campo (o sin campo, si no hay ninguno que ofrecer). */
export function blankCondition(field: BuilderField | undefined, random?: () => number): BuilderCondition {
  return {
    id: newConditionId(random),
    field: field ? joinPath(field, "") : "",
    operator: field ? defaultOperatorOf(field) : "is",
    ...(field ? { valueType: field.type } : {}),
    value: "",
  };
}

/** Cambiar de campo: el valor viejo no sirve (otro tipo, otras opciones) y el operador se conserva si sigue valiendo. */
export function changeField(condition: BuilderCondition, field: BuilderField): BuilderCondition {
  // Un operador que existe en los dos campos (`is`, `is_empty`...) dice lo mismo en ambos: se conserva.
  const keep = isOperatorValid(field, condition.operator);
  return {
    ...(condition.id !== undefined ? { id: condition.id } : {}),
    field: joinPath(field, ""),
    operator: keep ? condition.operator : defaultOperatorOf(field),
    valueType: field.type,
    value: "",
  };
}

/** Cambiar de operador: lo que ya no se pide se descarta (no queda un valor viejo escondido que igual se evalua). */
export function changeOperator(condition: BuilderCondition, field: BuilderField, operator: string): BuilderCondition {
  const slots = slotsOf(field, operator);
  const has = (target: ValueSlot["target"]) => slots.some((s) => s.target === target);
  const next: BuilderCondition = { ...condition, operator };
  // Un valor que la nueva forma no pide (de "entre" a "es mayor que") no se arrastra.
  delete next.value2;
  delete next.values;
  next.value = has("value") ? (condition.value ?? "") : "";
  if (has("value2")) next.value2 = condition.value2 ?? "";
  if (has("values")) next.values = condition.values ?? [];
  return next;
}

export function setArgument(condition: BuilderCondition, field: BuilderField, argument: string): BuilderCondition {
  return { ...condition, field: joinPath(field, argument) };
}

// ------------------------------------------------------------
// Revisar
// ------------------------------------------------------------

/** Una condicion del formato viejo (el nodo `condition`): se muestra como frase y no se edita campo por campo. */
export function isLegacyCondition(condition: BuilderCondition): boolean {
  return !condition.valueType && isLegacyOperator(condition.operator);
}

const NO_VALUE_OPERATORS = new Set(["is_empty", "is_not_empty", "is_true", "is_false"]);

/**
 * ¿Tiene pinta de estar a medio armar? Sin necesitar el catalogo (que puede no
 * haber cargado todavia): sin campo, o sin valor en un operador que lo pide. Sirve
 * para decidir si un camino nace abierto en el editor.
 */
export function looksIncomplete(condition: BuilderCondition): boolean {
  if (isLegacyCondition(condition)) return false;
  if (condition.field === "") return true;
  const hasValue = (condition.value ?? "") !== "" || (condition.values?.length ?? 0) > 0;
  return !hasValue && !NO_VALUE_OPERATORS.has(condition.operator);
}

/**
 * Que le falta a una condicion para poder cumplirse, o `null` si esta completa.
 * Una condicion a medio armar nunca se cumple, asi que conviene decirlo antes
 * de guardar.
 */
export function conditionProblem(condition: BuilderCondition, field: BuilderField | undefined): string | null {
  if (isLegacyCondition(condition)) return null;
  if (!field) return "Elegí un campo.";
  if (field.argument && argumentOf(field, condition.field).trim() === "") {
    if (field.argument.kind === "sequence") return "Elegí una secuencia.";
    // Un argumento de texto es obligatorio salvo que su etiqueta diga "(opcional)".
    if (!/opcional/i.test(field.argument.label ?? "")) return `Falta completar: ${field.argument.label ?? "el dato del campo"}.`;
  }
  for (const slot of slotsOf(field, condition.operator)) {
    if (slot.target === "values") {
      if (!condition.values || condition.values.length === 0) return "Elegí al menos una opción.";
    } else {
      const raw = slot.target === "value" ? condition.value : condition.value2;
      if (raw === undefined || raw.trim() === "") return slot.kind === "options" || slot.kind === "boolean" ? "Elegí una opción." : "Falta completar el valor.";
      if ((slot.kind === "number" || slot.kind === "days") && !Number.isFinite(Number(raw))) return "El valor tiene que ser un número.";
    }
  }
  return null;
}

/** La condicion en una frase, con el nombre del campo y las etiquetas de sus opciones. */
export function describeBuilderCondition(condition: BuilderCondition, fields: BuilderField[]): string {
  const field = fieldOfCondition(fields, condition.field);
  const optionLabels: Record<string, string> = {};
  for (const o of field?.options ?? []) optionLabels[o.value] = o.label;
  return describeCondition(condition, { fieldLabel: field ? fieldLabelFor(field, condition.field) : undefined, optionLabels });
}

/** Las condiciones de un camino en una frase: "Facturación es «Más de USD 10.000» y Edad es mayor que 30". Sin condiciones: "Siempre". */
export function describePathConditions(group: { logic: "and" | "or"; conditions: BuilderCondition[] }, fields: BuilderField[]): string {
  if (group.conditions.length === 0) return "Siempre";
  return group.conditions.map((c) => describeBuilderCondition(c, fields)).join(group.logic === "or" ? " o " : " y ");
}

function fieldLabelFor(field: BuilderField, path: string): string {
  const arg = argumentOf(field, path).trim();
  return arg ? `${field.label} ${arg}` : field.label;
}

/** Las opciones de un desplegable, sumando el valor guardado si ya no esta (una opcion que se borro). */
export function optionsWithCurrent(options: FieldOption[] | undefined, current: string[]): Array<FieldOption & { missing?: boolean }> {
  const list: Array<FieldOption & { missing?: boolean }> = [...(options ?? [])];
  for (const value of current) {
    if (value !== "" && !list.some((o) => o.value === value)) list.push({ value, label: value, missing: true });
  }
  return list;
}

/** Cuantas condiciones hay en total (sueltas mas las de los grupos). */
export function countConditions(value: BuilderValue): number {
  return value.conditions.length + value.groups.reduce((n, g) => n + g.conditions.length, 0);
}

/** Saca los grupos sin condiciones. Nunca toca las reglas sueltas. */
export function pruneGroups(value: BuilderValue): BuilderValue {
  return { ...value, groups: value.groups.filter((g) => g.conditions.length > 0) };
}

/** Busca un campo del catalogo por su ruta (para quien arma `BuilderField` desde otro lado). */
export function specToBuilderField(groups: ConditionFieldGroup[], path: string): BuilderField | undefined {
  const spec = findFieldSpec(groups, path);
  return spec ? builderFieldFromSpec(spec) : undefined;
}
