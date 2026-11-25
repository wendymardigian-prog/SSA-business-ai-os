import "server-only";

/**
 * Las tablas y columnas que se pueden consultar por el MCP (docs/mcp.md). Solo servidor.
 *
 * Salen de la descripción OpenAPI de PostgREST de cada esquema expuesto (`supabase/config.toml` → `[api].schemas`):
 * solo nombres y tipos de columnas, nunca datos. Se pide con la service role (la descripción completa) y se guarda
 * 10 minutos en memoria. Qué FILAS ve cada persona lo sigue decidiendo la RLS al consultar con su sesión.
 */

export const QUERY_SCHEMAS = ["public", "app_servicio"] as const;
export type QuerySchema = (typeof QUERY_SCHEMAS)[number];

export interface ColumnInfo {
  name: string;
  type: string;
  format: string | null;
  required: boolean;
  description: string | null;
}

export interface TableInfo {
  schema: QuerySchema;
  name: string;
  /** «contacts» en public; «app_servicio.services» en los demás. */
  ref: string;
  description: string | null;
  columns: ColumnInfo[];
}

const TTL_MS = 10 * 60_000;
let cache: { at: number; tables: TableInfo[] } | null = null;

type OpenApiDoc = { definitions?: Record<string, { description?: string; required?: string[]; properties?: Record<string, { type?: string; format?: string; description?: string }> }> };

async function fetchSchema(schema: QuerySchema): Promise<TableInfo[]> {
  const url = `${process.env.NEXT_PUBLIC_SUPABASE_URL!.replace(/\/+$/, "")}/rest/v1/`;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY!;
  const res = await fetch(url, { headers: { apikey: key, Authorization: `Bearer ${key}`, "Accept-Profile": schema, Accept: "application/openapi+json" }, cache: "no-store" });
  if (!res.ok) throw new Error(`OpenAPI ${schema}: ${res.status}`);
  const doc = (await res.json()) as OpenApiDoc;
  return Object.entries(doc.definitions ?? {}).map(([name, def]) => ({
    schema,
    name,
    ref: schema === "public" ? name : `${schema}.${name}`,
    description: def.description?.trim() || null,
    columns: Object.entries(def.properties ?? {}).map(([col, p]) => ({
      name: col,
      type: p.type ?? "unknown",
      format: p.format ?? null,
      required: (def.required ?? []).includes(col),
      description: p.description?.replace(/\s*Note:\s*\nThis is a (Primary|Foreign) Key\.?<[^>]+>\s*/g, " ($1 key)").trim() || null,
    })),
  }));
}

export async function loadTables(now = Date.now()): Promise<TableInfo[]> {
  if (cache && now - cache.at < TTL_MS) return cache.tables;
  const parts = await Promise.all(QUERY_SCHEMAS.map((s) => fetchSchema(s).catch((err) => {
    console.error("[mcp] no pude leer las tablas de", s, err instanceof Error ? err.message : "");
    return [] as TableInfo[];
  })));
  const tables = parts.flat().sort((a, b) => a.ref.localeCompare(b.ref));
  if (tables.length > 0) cache = { at: now, tables };
  return tables;
}

/** «contacts» o «app_servicio.services» → la tabla. Pura. */
export function findTable(tables: readonly TableInfo[], ref: string): TableInfo | null {
  const clean = ref.trim().toLowerCase().replace(/^public\./, "");
  return tables.find((t) => t.ref === clean) ?? null;
}
