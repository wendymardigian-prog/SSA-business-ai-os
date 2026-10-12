/**
 * El evaluador tipado de condiciones: el UNICO que usa el nodo `branch`
 * ("Condiciones"), el simulador y "Probar condiciones".
 *
 * Puro: sin Supabase, sin React, sin `Date.now()` suelto (el reloj entra por
 * parametro). Corre igual en el servidor y en el navegador.
 *
 * Reglas que no se discuten:
 *  - Se compara por TIPO, con el valor real: "12" > 9, no "12" > "9" como texto.
 *  - Mayusculas y espacios no cuentan (texto y selecciones).
 *  - Un valor que no se puede leer como el tipo (un "abc" donde va un numero)
 *    no cumple NINGUNA condicion de ese tipo, ni siquiera "es distinto de".
 *  - Una condicion incompleta (una lista sin elementos, una fecha sin fecha)
 *    no se cumple: una regla a medio armar nunca deja pasar a nadie.
 *  - Que un campo no se pueda resolver (la pregunta ya no existe, un error)
 *    significa "no se cumple" y se sigue: evaluar NUNCA lanza.
 *  - Los seis operadores viejos del nodo `condition` (`equals`, `not_equals`,
 *    `contains`, `exists`, `gt`, `lt`) se evaluan con la semantica de siempre
 *    (`legacy-operators.ts`, la misma funcion que usa el registro), asi
 *    "Convertir a Condiciones" se comporta idéntico.
 *  - Un grupo vacio: `and` se cumple, `or` no (igual que el nodo viejo).
 */

import { getLegacyOperator } from "./legacy-operators";

// ------------------------------------------------------------
// Tipos
// ------------------------------------------------------------

/** El tipo de dato de un campo comparable. */
export type ConditionValueType = "text" | "number" | "single_select" | "multi_select" | "date" | "boolean";

/** Lo que un campo puede valer cuando se lo resuelve. */
export type FieldValue = string | number | boolean | string[] | null | undefined;

/** Una condicion tal como se guarda en el camino de un `branch`. */
export interface BranchCondition {
  /** La ruta del campo: `answer.facturacion`, `contact.tags`, `tag:vip`, `variable:x`... */
  field: string;
  /** Un operador tipado (`is`, `gt`, `includes_any`...) o uno de los seis viejos (`equals`...). */
  operator: string;
  /** El valor de comparacion (y la fecha/numero "desde" de `between`). */
  value?: string;
  /** El "hasta" de `between`. */
  value2?: string;
  /** Los valores de `is_any_of`, `includes_any` e `includes_all`. */
  values?: string[];
  /**
   * El tipo con el que se armo la condicion. Si falta se deduce del operador;
   * si el operador existe en varios tipos (`is`, `is_empty`...), se usa texto.
   */
  valueType?: ConditionValueType;
}

export interface ConditionGroup {
  logic: "and" | "or";
  conditions: BranchCondition[];
}

/** Un camino del nodo `branch`. El id es la salida (`handle:<id>`) y no cambia nunca. */
export interface BranchPath extends ConditionGroup {
  id: string;
  label: string;
}

/** Lo que guarda el nodo `branch`. El "Si no" no se guarda: es siempre `handle:else`. */
export interface BranchNodeData {
  label?: string;
  paths: BranchPath[];
}

/** Para saber cuando el valor viene de un campo que ya no existe. */
export class MissingFieldError extends Error {
  constructor(public readonly field: string) {
    super(`El campo ${field} ya no existe`);
    this.name = "MissingFieldError";
  }
}

/**
 * Devuelve el valor de un campo. Puede lanzar (un campo que ya no existe, un
 * fallo al leerlo): el evaluador lo toma como "no se cumple".
 */
export type FieldResolver = (field: string) => FieldValue;

export interface EvalOptions {
  /** El reloj, para las fechas relativas. Por defecto, ahora. */
  now?: Date;
}

// ------------------------------------------------------------
// Operadores por tipo (para la pantalla y para explicar)
// ------------------------------------------------------------

/** Cuantos valores pide un operador. `days` es un entero de dias. */
export type OperatorArity = "none" | "one" | "two" | "list" | "days";

export interface OperatorInfo {
  id: string;
  label: string;
  arity: OperatorArity;
}

export const OPERATORS_BY_TYPE: Record<ConditionValueType, OperatorInfo[]> = {
  text: [
    { id: "is", label: "es", arity: "one" },
    { id: "is_not", label: "no es", arity: "one" },
    { id: "contains", label: "contiene", arity: "one" },
    { id: "not_contains", label: "no contiene", arity: "one" },
    { id: "is_empty", label: "está vacío", arity: "none" },
    { id: "is_not_empty", label: "tiene un valor", arity: "none" },
  ],
  number: [
    { id: "eq", label: "es igual a", arity: "one" },
    { id: "neq", label: "es distinto de", arity: "one" },
    { id: "gt", label: "es mayor que", arity: "one" },
    { id: "gte", label: "es mayor o igual que", arity: "one" },
    { id: "lt", label: "es menor que", arity: "one" },
    { id: "lte", label: "es menor o igual que", arity: "one" },
    { id: "between", label: "está entre", arity: "two" },
    { id: "is_empty", label: "está vacío", arity: "none" },
  ],
  single_select: [
    { id: "is", label: "es", arity: "one" },
    { id: "is_not", label: "no es", arity: "one" },
    { id: "is_any_of", label: "es alguna de", arity: "list" },
    { id: "is_empty", label: "está vacío", arity: "none" },
  ],
  multi_select: [
    { id: "includes", label: "incluye", arity: "one" },
    { id: "includes_any", label: "incluye alguna de", arity: "list" },
    { id: "includes_all", label: "incluye todas", arity: "list" },
    { id: "not_includes", label: "no incluye", arity: "one" },
    { id: "is_empty", label: "está vacío", arity: "none" },
  ],
  date: [
    { id: "before", label: "es antes de", arity: "one" },
    { id: "after", label: "es después de", arity: "one" },
    { id: "between", label: "está entre", arity: "two" },
    { id: "within_last_days", label: "fue en los últimos", arity: "days" },
    { id: "older_than_days", label: "fue hace más de", arity: "days" },
    { id: "is_empty", label: "está vacío", arity: "none" },
  ],
  boolean: [
    { id: "is_true", label: "es sí", arity: "none" },
    { id: "is_false", label: "es no", arity: "none" },
  ],
};

/** Los seis de siempre, solo para explicarlos (el nodo `condition` viejo). */
export const LEGACY_OPERATOR_INFO: OperatorInfo[] = [
  { id: "equals", label: "es igual a", arity: "one" },
  { id: "not_equals", label: "no es igual a", arity: "one" },
  { id: "contains", label: "contiene", arity: "one" },
  { id: "exists", label: "tiene algún valor", arity: "none" },
  { id: "gt", label: "es mayor que", arity: "one" },
  { id: "lt", label: "es menor que", arity: "one" },
];

/** Los operadores de un tipo, o la lista vieja si no se conoce. */
export function operatorInfo(operator: string, type?: ConditionValueType): OperatorInfo | undefined {
  if (type) {
    const own = OPERATORS_BY_TYPE[type].find((o) => o.id === operator);
    if (own) return own;
  }
  const legacy = LEGACY_OPERATOR_INFO.find((o) => o.id === operator);
  if (legacy) return legacy;
  for (const list of Object.values(OPERATORS_BY_TYPE)) {
    const found = list.find((o) => o.id === operator);
    if (found) return found;
  }
  return undefined;
}

/**
 * El tipo de un operador, cuando la condicion no lo trae. Los que existen en
 * varios tipos (`is`, `is_not`, `is_empty`, `between`) dan texto o numero segun
 * el caso mas comun; una condicion armada por la pantalla siempre trae su tipo.
 */
export function inferValueType(operator: string): ConditionValueType | null {
  for (const type of ["text", "number", "single_select", "multi_select", "date", "boolean"] as const) {
    if (OPERATORS_BY_TYPE[type].some((o) => o.id === operator)) return type;
  }
  return null;
}

export function isLegacyOperator(operator: string): boolean {
  return getLegacyOperator(operator) !== undefined;
}

// ------------------------------------------------------------
// Normalizacion de valores
// ------------------------------------------------------------

function isBlank(value: FieldValue): boolean {
  if (value === null || value === undefined) return true;
  if (Array.isArray(value)) return value.length === 0;
  return typeof value === "string" ? value.trim() === "" : false;
}

const norm = (text: string): string => text.trim().toLowerCase();

function asText(value: FieldValue): string {
  if (value === null || value === undefined) return "";
  if (Array.isArray(value)) return value.join(", ").trim();
  return String(value).trim();
}

function asList(value: FieldValue): string[] {
  if (value === null || value === undefined) return [];
  const items = Array.isArray(value) ? value : String(value).split(",");
  return items.map((v) => norm(String(v))).filter((v) => v !== "");
}

function asNumber(value: FieldValue): number {
  if (typeof value === "number") return Number.isFinite(value) ? value : Number.NaN;
  if (typeof value === "boolean" || value === null || value === undefined || Array.isArray(value)) return Number.NaN;
  const text = value.trim();
  if (text === "") return Number.NaN;
  const n = Number(text);
  return Number.isFinite(n) ? n : Number.NaN;
}

function asBoolean(value: FieldValue): boolean | null {
  if (typeof value === "boolean") return value;
  if (value === null || value === undefined || Array.isArray(value)) return null;
  const text = norm(String(value));
  if (["true", "1", "si", "sí", "yes", "y"].includes(text)) return true;
  if (["false", "0", "no", "n"].includes(text)) return false;
  return null;
}

const DAY_MS = 86_400_000;
const ISO_DAY = /^\d{4}-\d{2}-\d{2}$/;

/** Una fecha (`2026-10-12` o un ISO completo) a milisegundos; NaN si no es una fecha. */
function asTime(value: FieldValue): number {
  if (value === null || value === undefined || Array.isArray(value) || typeof value === "boolean") return Number.NaN;
  const text = String(value).trim();
  if (text === "") return Number.NaN;
  // `2026-10-12` es UTC a medianoche en toda la plataforma (como lo guardan los formularios).
  const time = ISO_DAY.test(text) ? Date.parse(`${text}T00:00:00Z`) : Date.parse(text);
  return Number.isNaN(time) ? Number.NaN : time;
}

/** El dia (`YYYY-MM-DD`, UTC) de una fecha; null si no es una fecha. */
function dayOf(value: FieldValue): string | null {
  const time = asTime(value);
  return Number.isNaN(time) ? null : new Date(time).toISOString().slice(0, 10);
}

// ------------------------------------------------------------
// Evaluacion de una condicion
// ------------------------------------------------------------

function evalText(op: string, actual: FieldValue, c: BranchCondition): boolean {
  const empty = isBlank(actual);
  const have = norm(asText(actual));
  const want = norm(c.value ?? "");
  switch (op) {
    case "is_empty":
      return empty;
    case "is_not_empty":
      return !empty;
    case "is":
      return !empty && have === want;
    case "is_not":
      return empty || have !== want;
    case "contains":
      return !empty && have.includes(want);
    case "not_contains":
      return empty || !have.includes(want);
    default:
      return false;
  }
}

function evalNumber(op: string, actual: FieldValue, c: BranchCondition): boolean {
  if (op === "is_empty") return isBlank(actual);
  const n = asNumber(actual);
  if (Number.isNaN(n)) return false;
  const a = asNumber(c.value);
  switch (op) {
    case "eq":
      return !Number.isNaN(a) && n === a;
    case "neq":
      return !Number.isNaN(a) && n !== a;
    case "gt":
      return !Number.isNaN(a) && n > a;
    case "gte":
      return !Number.isNaN(a) && n >= a;
    case "lt":
      return !Number.isNaN(a) && n < a;
    case "lte":
      return !Number.isNaN(a) && n <= a;
    case "between": {
      const b = asNumber(c.value2);
      if (Number.isNaN(a) || Number.isNaN(b)) return false;
      // El orden en que se escribieron los extremos no importa.
      return n >= Math.min(a, b) && n <= Math.max(a, b);
    }
    default:
      return false;
  }
}

function evalSingle(op: string, actual: FieldValue, c: BranchCondition): boolean {
  const empty = isBlank(actual);
  const have = norm(asText(actual));
  switch (op) {
    case "is_empty":
      return empty;
    case "is":
      return !empty && have === norm(c.value ?? "");
    case "is_not":
      return empty || have !== norm(c.value ?? "");
    case "is_any_of": {
      const wanted = asList(c.values ?? []);
      return !empty && wanted.length > 0 && wanted.includes(have);
    }
    default:
      return false;
  }
}

function evalMulti(op: string, actual: FieldValue, c: BranchCondition): boolean {
  const have = asList(actual);
  switch (op) {
    case "is_empty":
      return have.length === 0;
    case "includes":
      return have.includes(norm(c.value ?? ""));
    case "not_includes":
      return !have.includes(norm(c.value ?? ""));
    case "includes_any": {
      const wanted = asList(c.values ?? []);
      return wanted.length > 0 && wanted.some((w) => have.includes(w));
    }
    case "includes_all": {
      const wanted = asList(c.values ?? []);
      return wanted.length > 0 && wanted.every((w) => have.includes(w));
    }
    default:
      return false;
  }
}

function evalDate(op: string, actual: FieldValue, c: BranchCondition, now: Date): boolean {
  if (op === "is_empty") return isBlank(actual);
  const time = asTime(actual);
  const day = dayOf(actual);
  if (Number.isNaN(time) || day === null) return false;

  switch (op) {
    case "before":
    case "after": {
      const wantDay = dayOf(c.value);
      if (wantDay === null) return false;
      return op === "before" ? day < wantDay : day > wantDay;
    }
    case "between": {
      const from = dayOf(c.value);
      const to = dayOf(c.value2);
      if (from === null || to === null) return false;
      const [lo, hi] = from <= to ? [from, to] : [to, from];
      return day >= lo && day <= hi;
    }
    case "within_last_days": {
      const days = asNumber(c.value);
      if (Number.isNaN(days) || days < 0) return false;
      // Pasado reciente: no cuentan las fechas futuras.
      return time <= now.getTime() && time >= now.getTime() - days * DAY_MS;
    }
    case "older_than_days": {
      const days = asNumber(c.value);
      if (Number.isNaN(days) || days < 0) return false;
      return time < now.getTime() - days * DAY_MS;
    }
    default:
      return false;
  }
}

function evalBoolean(op: string, actual: FieldValue): boolean {
  const value = asBoolean(actual);
  // Sin un si/no claro (no se respondio, o es otra cosa) no se cumple ni uno ni otro.
  if (value === null) return false;
  if (op === "is_true") return value;
  if (op === "is_false") return !value;
  return false;
}

/**
 * ¿Se cumple esta condicion con este valor? Nunca lanza.
 *
 * Primero los seis operadores viejos (semantica de siempre, con el valor como
 * texto); despues el tipo, que sale de la condicion o del operador.
 */
export function evaluateCondition(condition: BranchCondition, actual: FieldValue, options: EvalOptions = {}): boolean {
  try {
    const legacy = getLegacyOperator(condition.operator);
    if (legacy && !condition.valueType) {
      const text = actual === null || actual === undefined ? undefined : Array.isArray(actual) ? actual.join(", ") : String(actual);
      return legacy.evaluate(text, condition.value ?? "");
    }

    const type = condition.valueType ?? inferValueType(condition.operator);
    const now = options.now ?? new Date();
    switch (type) {
      case "text":
        return evalText(condition.operator, actual, condition);
      case "number":
        return evalNumber(condition.operator, actual, condition);
      case "single_select":
        return evalSingle(condition.operator, actual, condition);
      case "multi_select":
        return evalMulti(condition.operator, actual, condition);
      case "date":
        return evalDate(condition.operator, actual, condition, now);
      case "boolean":
        return evalBoolean(condition.operator, actual);
      default:
        return false;
    }
  } catch {
    // Un valor raro no puede tumbar un flujo: no se cumple y se sigue.
    return false;
  }
}

// ------------------------------------------------------------
// Grupos y caminos
// ------------------------------------------------------------

/** Lo que paso con cada condicion. NUNCA lleva el valor (pueden ser datos personales). */
export interface CheckResult {
  field: string;
  operator: string;
  ok: boolean;
  /** El campo ya no existe (por ejemplo, una pregunta que se saco del formulario). */
  missing?: boolean;
  /** Al leer el campo hubo un error. */
  error?: boolean;
}

export interface GroupResult {
  passed: boolean;
  checks: CheckResult[];
}

/** Evalua un grupo y dice que paso con cada condicion. Nunca lanza. */
export function evaluateGroupDetailed(group: ConditionGroup, resolve: FieldResolver, options: EvalOptions = {}): GroupResult {
  const conditions = Array.isArray(group?.conditions) ? group.conditions : [];
  const checks: CheckResult[] = conditions.map((condition) => {
    const base = { field: String(condition?.field ?? ""), operator: String(condition?.operator ?? "") };
    try {
      const value = resolve(base.field);
      return { ...base, ok: evaluateCondition(condition, value, options) };
    } catch (error) {
      // Una pregunta que ya no existe o un fallo al leer el campo: no se cumple.
      return error instanceof MissingFieldError ? { ...base, ok: false, missing: true } : { ...base, ok: false, error: true };
    }
  });

  const oks = checks.map((c) => c.ok);
  const passed = group?.logic === "or" ? oks.some(Boolean) : oks.every(Boolean);
  return { passed, checks };
}

/** ¿Se cumple el grupo? Vacio: `and` si, `or` no (igual que el nodo viejo). */
export function evaluateGroup(group: ConditionGroup, resolve: FieldResolver, options: EvalOptions = {}): boolean {
  return evaluateGroupDetailed(group, resolve, options).passed;
}

export interface PathPick {
  /** El primer camino que se cumple, o null: va por "Si no". */
  path: BranchPath | null;
  /** Su posicion, o -1. */
  index: number;
  /** Lo que paso en cada camino mirado, en orden, hasta el que se cumplio. */
  evaluated: Array<{ pathId: string; passed: boolean; checks: CheckResult[] }>;
}

/**
 * El primer camino, EN ORDEN, cuyas condiciones se cumplen. Si ninguno, `null`
 * (el "Si no"). En cuanto uno se cumple, los siguientes ni se miran.
 */
export function pickPath(paths: BranchPath[], resolve: FieldResolver, options: EvalOptions = {}): PathPick {
  const evaluated: PathPick["evaluated"] = [];
  const list = Array.isArray(paths) ? paths : [];
  for (let index = 0; index < list.length; index++) {
    const path = list[index];
    const { passed, checks } = evaluateGroupDetailed(path, resolve, options);
    evaluated.push({ pathId: path.id, passed, checks });
    if (passed) return { path, index, evaluated };
  }
  return { path: null, index: -1, evaluated };
}

// ------------------------------------------------------------
// Explicar con palabras
// ------------------------------------------------------------

export interface DescribeContext {
  /** Como se llama el campo para la persona ("Facturación"). Sin esto, la ruta tal cual. */
  fieldLabel?: string;
  /** Para mostrar la etiqueta de una opcion en vez de su valor. */
  optionLabels?: Record<string, string>;
}

const quote = (text: string) => `«${text}»`;

function joinOr(items: string[]): string {
  if (items.length <= 1) return items.join("");
  return `${items.slice(0, -1).join(", ")} o ${items[items.length - 1]}`;
}

function joinAnd(items: string[]): string {
  if (items.length <= 1) return items.join("");
  return `${items.slice(0, -1).join(", ")} y ${items[items.length - 1]}`;
}

/** "Facturación es «Más de USD 10.000»". Para el resumen, el log y "Probar condiciones". */
export function describeCondition(condition: BranchCondition, context: DescribeContext = {}): string {
  const field = context.fieldLabel ?? condition.field;
  const type = condition.valueType ?? inferValueType(condition.operator) ?? undefined;
  const info = operatorInfo(condition.operator, type);
  const label = (v: string | undefined) => quote(context.optionLabels?.[v ?? ""] ?? (v ?? ""));
  if (!info) return `${field} ${condition.operator}`;

  switch (info.arity) {
    case "none":
      return `${field} ${info.label}`;
    case "one":
      return `${field} ${info.label} ${type === "number" || type === "date" ? (condition.value ?? "") : label(condition.value)}`;
    case "two":
      return `${field} ${info.label} ${condition.value ?? ""} y ${condition.value2 ?? ""}`;
    case "days":
      return `${field} ${info.label} ${condition.value ?? ""} días`;
    case "list": {
      const items = (condition.values ?? []).map(label);
      return `${field} ${info.label} ${condition.operator === "includes_all" ? joinAnd(items) : joinOr(items)}`;
    }
  }
}

/** "Facturación es «Más de USD 10.000» y Edad es mayor que 30". */
export function describeGroup(group: ConditionGroup, contextFor: (condition: BranchCondition) => DescribeContext = () => ({})): string {
  const parts = (group.conditions ?? []).map((c) => describeCondition(c, contextFor(c)));
  if (parts.length === 0) return "Siempre";
  return parts.join(group.logic === "or" ? " o " : " y ");
}
