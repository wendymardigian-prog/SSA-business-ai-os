import { z } from "zod";
import type { TableInfo } from "./schema";

/**
 * La consulta guiada del MCP (`consultar`, docs/mcp.md): tabla, columnas, filtros, orden, agrupar y métricas. Pura
 * (salvo `runQuery`, que recibe el cliente): se valida TODO contra las columnas reales antes de armar nada, así un
 * nombre raro nunca llega al `select`. Corre con la sesión de la persona: la RLS decide qué filas ve.
 */

export const QUERY_MAX_LIMIT = 1000;
export const QUERY_MAX_SCAN = 50_000;

const ident = z.string().regex(/^[a-z_][a-z0-9_]*$/i, "Nombre de columna no válido");
const scalar = z.union([z.string(), z.number(), z.boolean(), z.null()]);

export const FILTER_OPS = ["eq", "neq", "gt", "gte", "lt", "lte", "ilike", "in", "is", "contains"] as const;
export const METRIC_OPS = ["count", "sum", "avg", "min", "max", "count_distinct"] as const;

export const queryInputShape = {
  tabla: z.string().min(1).max(120).describe("La tabla: «contacts» o «app_servicio.services». Mirá listar_tablas."),
  columnas: z.array(ident).min(1).max(60).optional().describe("Las columnas a traer. Sin agrupar, obligatorio."),
  filtros: z
    .array(z.object({ columna: ident, op: z.enum(FILTER_OPS), valor: z.union([scalar, z.array(scalar)]) }))
    .max(30)
    .optional()
    .describe("eq, neq, gt, gte, lt, lte, ilike (con %), in (lista), is (null/true/false), contains (lista o JSON)."),
  orden: z.array(z.object({ columna: ident, desc: z.boolean().optional() })).max(5).optional(),
  limite: z.number().int().min(1).max(QUERY_MAX_LIMIT).optional().describe("Filas a devolver (máx. 1000; por defecto 100)."),
  desde: z.number().int().min(0).optional().describe("Saltar las primeras N filas (para paginar)."),
  agrupar_por: z.array(ident).max(5).optional().describe("Agrupar por estas columnas (se cuentan hasta 50.000 filas)."),
  metricas: z
    .array(z.object({ op: z.enum(METRIC_OPS), columna: ident.optional() }))
    .max(10)
    .optional()
    .describe("count (sin columna = filas), sum, avg, min, max, count_distinct."),
  todos_los_negocios: z.boolean().optional().describe("Por defecto se filtra por el negocio activo si la tabla tiene workspace_id."),
};

const querySchema = z.object(queryInputShape);
export type QueryInput = z.infer<typeof querySchema>;

export type QueryPlan = {
  table: TableInfo;
  select: string[];
  filters: NonNullable<QueryInput["filtros"]>;
  order: NonNullable<QueryInput["orden"]>;
  limit: number;
  offset: number;
  groupBy: string[];
  metrics: NonNullable<QueryInput["metricas"]>;
  workspaceFilter: boolean;
};

/** Valida contra las columnas reales y arma el plan. Puro. */
export function planQuery(input: QueryInput, table: TableInfo): { ok: true; plan: QueryPlan } | { ok: false; error: string } {
  const cols = new Set(table.columns.map((c) => c.name));
  const unknown = (names: (string | undefined)[]) => names.filter((n): n is string => !!n && !cols.has(n));
  const groupBy = input.agrupar_por ?? [];
  const metrics = input.metricas ?? [];
  const grouped = groupBy.length > 0 || metrics.length > 0;
  const select = grouped ? [...new Set([...groupBy, ...metrics.map((m) => m.columna).filter((c): c is string => !!c)])] : (input.columnas ?? []);
  if (!grouped && select.length === 0) return { ok: false, error: "Decí qué columnas querés (columnas), o agrupa con agrupar_por / metricas." };
  const bad = unknown([...select, ...(input.filtros ?? []).map((f) => f.columna), ...(input.orden ?? []).map((o) => o.columna)]);
  if (bad.length > 0) return { ok: false, error: `La tabla ${table.ref} no tiene: ${[...new Set(bad)].join(", ")}. Mirá describir_tabla.` };
  for (const m of metrics) if (m.op !== "count" && !m.columna) return { ok: false, error: `La métrica ${m.op} necesita una columna.` };
  for (const f of input.filtros ?? []) {
    if (f.op === "in" && !Array.isArray(f.valor)) return { ok: false, error: `El filtro «in» de ${f.columna} necesita una lista.` };
    if (f.op === "is" && !(f.valor === null || f.valor === true || f.valor === false)) return { ok: false, error: `El filtro «is» de ${f.columna} es null, true o false.` };
  }
  return {
    ok: true,
    plan: {
      table,
      select: select.length > 0 ? select : [table.columns[0]?.name ?? "id"],
      filters: input.filtros ?? [],
      order: input.orden ?? [],
      limit: input.limite ?? 100,
      offset: input.desde ?? 0,
      groupBy,
      metrics,
      workspaceFilter: !input.todos_los_negocios && cols.has("workspace_id"),
    },
  };
}

type Row = Record<string, unknown>;

function num(v: unknown): number | null {
  if (typeof v === "number" && Number.isFinite(v)) return v;
  if (typeof v === "string" && v.trim() !== "" && Number.isFinite(Number(v))) return Number(v);
  return null;
}

/** Agrupa y calcula en memoria. Puro. */
export function aggregate(rows: readonly Row[], groupBy: readonly string[], metrics: NonNullable<QueryInput["metricas"]>): Row[] {
  const ms = metrics.length > 0 ? metrics : [{ op: "count" as const }];
  const groups = new Map<string, { key: Row; rows: Row[] }>();
  for (const r of rows) {
    const key: Row = Object.fromEntries(groupBy.map((g) => [g, r[g] ?? null]));
    const k = JSON.stringify(groupBy.map((g) => r[g] ?? null));
    const bucket = groups.get(k) ?? { key, rows: [] };
    bucket.rows.push(r);
    groups.set(k, bucket);
  }
  if (groups.size === 0 && groupBy.length === 0) groups.set("[]", { key: {}, rows: [] });
  const out: Row[] = [];
  for (const { key, rows: rs } of groups.values()) {
    const row: Row = { ...key };
    for (const m of ms) {
      const name = m.columna ? `${m.op}_${m.columna}` : m.op;
      const values = m.columna ? rs.map((r) => r[m.columna!]) : [];
      const nums = values.map(num).filter((n): n is number => n !== null);
      switch (m.op) {
        case "count":
          row[name] = m.columna ? values.filter((v) => v !== null && v !== undefined).length : rs.length;
          break;
        case "count_distinct":
          row[name] = new Set(values.filter((v) => v !== null && v !== undefined).map((v) => JSON.stringify(v))).size;
          break;
        case "sum":
          row[name] = nums.length ? nums.reduce((a, b) => a + b, 0) : null;
          break;
        case "avg":
          row[name] = nums.length ? nums.reduce((a, b) => a + b, 0) / nums.length : null;
          break;
        case "min":
        case "max": {
          const comparable = values.filter((v) => v !== null && v !== undefined) as (string | number)[];
          if (comparable.length === 0) row[name] = null;
          else row[name] = comparable.reduce((a, b) => ((m.op === "min" ? b < a : b > a) ? b : a));
          break;
        }
      }
    }
    out.push(row);
  }
  const firstMetric = ms[0].columna ? `${ms[0].op}_${ms[0].columna}` : ms[0].op;
  return out.sort((a, b) => (num(b[firstMetric]) ?? -Infinity) - (num(a[firstMetric]) ?? -Infinity));
}

/** El constructor de supabase-js cambia de tipo por esquema y tabla. */
type Builder = any;

function applyFilters(q: Builder, plan: QueryPlan, workspaceId: string): Builder {
  let out = q;
  if (plan.workspaceFilter) out = out.eq("workspace_id", workspaceId);
  for (const f of plan.filters) {
    switch (f.op) {
      case "in":
        out = out.in(f.columna, f.valor as unknown[]);
        break;
      case "is":
        out = out.is(f.columna, f.valor as null | boolean);
        break;
      case "contains":
        out = out.contains(f.columna, f.valor as unknown);
        break;
      default:
        out = out[f.op](f.columna, f.valor);
    }
  }
  return out;
}

export async function runQuery(session: Builder, plan: QueryPlan, workspaceId: string): Promise<{ ok: true; rows: Row[]; truncated: boolean; scanned?: number } | { ok: false; error: string }> {
  // Un constructor nuevo por pedido: el de supabase-js guarda la URL y los filtros se acumularían entre páginas.
  const from = () => (plan.table.schema === "public" ? session : session.schema(plan.table.schema)).from(plan.table.name);
  const grouped = plan.groupBy.length > 0 || plan.metrics.length > 0;
  if (!grouped) {
    let q = applyFilters(from().select(plan.select.join(",")), plan, workspaceId);
    for (const o of plan.order) q = q.order(o.columna, { ascending: !o.desc, nullsFirst: false });
    const { data, error } = await q.range(plan.offset, plan.offset + plan.limit - 1);
    if (error) return { ok: false, error: `La base respondió: ${error.message}` };
    return { ok: true, rows: (data ?? []) as Row[], truncated: (data ?? []).length === plan.limit };
  }
  const rows: Row[] = [];
  const page = 1000;
  for (let offset = 0; offset < QUERY_MAX_SCAN; offset += page) {
    const { data, error } = await applyFilters(from().select(plan.select.join(",")), plan, workspaceId).range(offset, offset + page - 1);
    if (error) return { ok: false, error: `La base respondió: ${error.message}` };
    rows.push(...((data ?? []) as Row[]));
    if ((data ?? []).length < page) {
      return { ok: true, rows: aggregate(rows, plan.groupBy, plan.metrics), truncated: false, scanned: rows.length };
    }
  }
  return { ok: true, rows: aggregate(rows, plan.groupBy, plan.metrics), truncated: true, scanned: rows.length };
}
