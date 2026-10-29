/**
 * Los filtros y columnas nuevos de la lista de contactos (pipeline, 00244-00246):
 * estado, producto de interés y campos personalizados.
 *
 * Puro: lo usan la página (para armar la consulta) y la vista (para los
 * controles). Todo viene de la URL, así que se valida contra lo que existe:
 * un valor inventado se ignora en vez de romper la consulta.
 */
import { normalizeCustomValue } from "@/lib/custom-fields";
import { STATUS_KEY_RE, parseLastStatusParam, type StatusRole } from "./statuses";

// ---------------------------------------------------------------------------
// Estado y producto
// ---------------------------------------------------------------------------

export interface PipelineFilters {
  /** `?estado=setter:calificado`: el ÚLTIMO estado. */
  lastStatus: { role: StatusRole; key: string } | null;
  /** `?estado_setter=` y `?estado_vendedor=`: el estado de cada rol. "ninguno" = sin estado. */
  setterStatus: string;
  closerStatus: string;
  /** `?producto=<id>` o "ninguno". */
  productId: string;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const NONE = "ninguno";

const first = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) ?? "";
const statusParam = (raw: string) => (raw === NONE || STATUS_KEY_RE.test(raw) ? raw : "");

export function parsePipelineFilters(params: Record<string, string | string[] | undefined>): PipelineFilters {
  const product = first(params.producto);
  return {
    lastStatus: parseLastStatusParam(first(params.estado)),
    setterStatus: statusParam(first(params.estado_setter)),
    closerStatus: statusParam(first(params.estado_vendedor)),
    productId: product === NONE || UUID.test(product) ? product : "",
  };
}

/** Las condiciones para la consulta de contactos: `eq` o `is null` sobre una columna. */
export function pipelineClauses(f: PipelineFilters): Array<{ column: string; op: "eq" | "is_null"; value?: string }> {
  const out: Array<{ column: string; op: "eq" | "is_null"; value?: string }> = [];
  if (f.lastStatus) {
    out.push({ column: "last_status_role", op: "eq", value: f.lastStatus.role });
    out.push({ column: "last_status", op: "eq", value: f.lastStatus.key });
  }
  const byRole = (column: string, value: string) => {
    if (!value) return;
    out.push(value === NONE ? { column, op: "is_null" } : { column, op: "eq", value });
  };
  byRole("setter_status", f.setterStatus);
  byRole("closer_status", f.closerStatus);
  byRole("interest_product_id", f.productId);
  return out;
}

// ---------------------------------------------------------------------------
// Campos personalizados
// ---------------------------------------------------------------------------

export const CUSTOM_FILTER_OPS = ["eq", "contains", "gt", "lt", "before", "after", "empty", "filled"] as const;
export type CustomFilterOp = (typeof CUSTOM_FILTER_OPS)[number];

export const CUSTOM_FILTER_OP_LABELS: Record<CustomFilterOp, string> = {
  eq: "es igual a",
  contains: "contiene",
  gt: "mayor que",
  lt: "menor que",
  before: "antes del",
  after: "después del",
  empty: "está vacío",
  filled: "tiene un valor",
};

/** Qué operadores tiene sentido ofrecer para cada tipo. */
export function opsForType(type: string): CustomFilterOp[] {
  switch (type) {
    case "number":
      return ["eq", "gt", "lt", "filled", "empty"];
    case "date":
      return ["eq", "before", "after", "filled", "empty"];
    case "boolean":
      return ["eq", "filled", "empty"];
    default:
      return ["contains", "eq", "filled", "empty"];
  }
}

export interface CustomFieldRef {
  id: string;
  slug: string;
  name: string;
  type: string;
}

export interface CustomFilter {
  field: CustomFieldRef;
  op: CustomFilterOp;
  /** Ya normalizado por tipo (número con punto, fecha AAAA-MM-DD, "true"/"false"). Vacío en empty/filled. */
  value: string;
}

/**
 * `?campo=<slug>&op=gt&valor=3`. Devuelve null si el campo no existe, el
 * operador no corresponde al tipo, o el valor no sirve para el tipo.
 */
export function parseCustomFilter(params: Record<string, string | string[] | undefined>, fields: readonly CustomFieldRef[]): CustomFilter | null {
  const slug = first(params.campo);
  if (!slug) return null;
  const field = fields.find((f) => f.slug === slug);
  if (!field) return null;
  const opRaw = first(params.op);
  const op = (CUSTOM_FILTER_OPS as readonly string[]).includes(opRaw) ? (opRaw as CustomFilterOp) : opsForType(field.type)[0];
  if (!opsForType(field.type).includes(op)) return null;
  if (op === "empty" || op === "filled") return { field, op, value: "" };
  const raw = first(params.valor).trim();
  if (!raw) return null;
  if (op === "contains") return { field, op, value: raw.slice(0, 100) };
  const normalized = normalizeCustomValue(field.type, raw);
  if (!normalized.ok) return null;
  return { field, op, value: normalized.value };
}

/**
 * Cómo se aplica a la consulta. "empty" es un anti-join (el contacto NO tiene
 * fila para ese campo); el resto, un join interno con su condición sobre la
 * columna que corresponde al tipo (`value_number` / `value_date`, 00244).
 */
export type CustomFilterPlan =
  | { join: "anti"; fieldId: string }
  | { join: "inner"; fieldId: string; column: "value" | "value_number" | "value_date"; op: "eq" | "ilike" | "gt" | "lt" | "not_null"; value?: string | number };

export function customFilterPlan(f: CustomFilter): CustomFilterPlan {
  const fieldId = f.field.id;
  if (f.op === "empty") return { join: "anti", fieldId };
  if (f.op === "filled") return { join: "inner", fieldId, column: "value", op: "not_null" };
  if (f.op === "contains") return { join: "inner", fieldId, column: "value", op: "ilike", value: `%${f.value.replace(/[%_]/g, (c) => `\\${c}`)}%` };
  if (f.field.type === "number") {
    const n = Number(f.value);
    return { join: "inner", fieldId, column: "value_number", op: f.op === "gt" ? "gt" : f.op === "lt" ? "lt" : "eq", value: n };
  }
  if (f.field.type === "date") {
    return { join: "inner", fieldId, column: "value_date", op: f.op === "after" ? "gt" : f.op === "before" ? "lt" : "eq", value: f.value };
  }
  return { join: "inner", fieldId, column: "value", op: "eq", value: f.value };
}

// ---------------------------------------------------------------------------
// Las columnas elegidas (localStorage, por persona)
// ---------------------------------------------------------------------------

export const COLUMNS_STORAGE_KEY = "contacts-columns";

/** Las columnas opcionales fijas; las de campos personalizados son `cf:<id>`. */
export const OPTIONAL_COLUMNS = ["status", "product", "email_status"] as const;
export type OptionalColumn = (typeof OPTIONAL_COLUMNS)[number] | `cf:${string}`;

/** Por defecto se ven Estado y Producto; el estado de email y los campos personalizados se suman a mano. */
export const DEFAULT_VISIBLE_COLUMNS: OptionalColumn[] = ["status", "product"];

/** Lee lo guardado. Nunca lanza: algo roto o vacío vuelve a las de por defecto. */
export function parseVisibleColumns(raw: string | null | undefined, fieldIds: readonly string[]): OptionalColumn[] {
  if (!raw) return [...DEFAULT_VISIBLE_COLUMNS];
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [...DEFAULT_VISIBLE_COLUMNS];
    const ids = new Set(fieldIds);
    const out = parsed.filter(
      (c): c is OptionalColumn =>
        typeof c === "string" && ((OPTIONAL_COLUMNS as readonly string[]).includes(c) || (c.startsWith("cf:") && ids.has(c.slice(3)))),
    );
    return [...new Set(out)];
  } catch {
    return [...DEFAULT_VISIBLE_COLUMNS];
  }
}
