import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/types/database";

/**
 * Cliente de Supabase en memoria, para los tests del agente.
 *
 * El turno del agente toca una docena de tablas; mockear cada consulta a mano
 * dejaba tests que probaban el mock y no el codigo. Esto aplica los filtros de
 * verdad (eq, is, not, gt, order, limit...) sobre filas en memoria, asi el test
 * afirma sobre lo que quedo escrito, igual que contra la base.
 *
 * No es PostgREST: no hay RLS, ni joins salvo el que se declara en `joins`, ni
 * privilegios de columna. Lo que se prueba aca es la logica del motor; las
 * policies se prueban contra la base real con scripts/verify-rls.mjs.
 */

type Row = Record<string, unknown>;
type Filter = (row: Row) => boolean;

export interface MemoryDb {
  client: SupabaseClient<Database>;
  tables: Record<string, Row[]>;
  rpcCalls: Array<{ name: string; args: Record<string, unknown> }>;
  rows(table: string): Row[];
}

let seq = 0;
export const newId = (prefix = "id") => `${prefix}-${++seq}`;

export function memoryDb(
  seed: Record<string, Row[]> = {},
  options: {
    rpc?: Record<string, (args: Record<string, unknown>, db: MemoryDb) => unknown>;
    /** Relaciones embebidas simples: "tabla.relacion" -> resolver(row, db). */
    joins?: Record<string, (row: Row, db: MemoryDb) => unknown>;
    now?: () => Date;
    /**
     * Indices unicos parciales: "tabla" -> una funcion que dice si dos filas
     * chocan. Un insert o update que choca devuelve el error 23505, igual que
     * Postgres. Sin esto, la garantia de "un solo borrador vivo" no se podria
     * probar en memoria.
     */
    unique?: Record<string, (a: Row, b: Row) => boolean>;
  } = {},
): MemoryDb {
  const tables: Record<string, Row[]> = {};
  for (const [name, rows] of Object.entries(seed)) tables[name] = rows.map((r) => ({ ...r }));
  const rpcCalls: MemoryDb["rpcCalls"] = [];
  const clock = options.now ?? (() => new Date());

  const db: MemoryDb = {
    client: null as unknown as SupabaseClient<Database>,
    tables,
    rpcCalls,
    rows: (table) => (tables[table] ??= []),
  };

  const cmp = (a: unknown, b: unknown) => {
    const na = typeof a === "string" && /^\d{4}-\d{2}-\d{2}T/.test(a) ? new Date(a).getTime() : a;
    const nb = typeof b === "string" && /^\d{4}-\d{2}-\d{2}T/.test(b) ? new Date(b).getTime() : b;
    return (na as number) < (nb as number) ? -1 : (na as number) > (nb as number) ? 1 : 0;
  };

  function builder(table: string) {
    const filters: Filter[] = [];
    let mode: "select" | "insert" | "update" | "delete" | "upsert" = "select";
    /** Columnas de `onConflict` del upsert, ya separadas. */
    let conflictCols: string[] = [];
    let payload: Row | Row[] | null = null;
    let selectCols: string | null = null;
    let countMode = false;
    let head = false;
    let orderBy: { col: string; asc: boolean } | null = null;
    let limitN: number | null = null;

    const clash = options.unique?.[table];
    const duplicate = { data: null, error: { code: "23505", message: `duplicate key value violates unique constraint on ${table}` } };

    const apply = (): { data: unknown; error: null | { code: string; message: string }; count?: number } => {
      const rows = db.rows(table);
      if (mode === "insert") {
        const list = (Array.isArray(payload) ? payload : [payload]) as Row[];
        const candidates = list.map((r) => ({ id: newId(table), created_at: clock().toISOString(), ...r }) as Row);
        if (clash && candidates.some((c, i) => rows.some((r) => clash(c, r)) || candidates.some((o, j) => j !== i && clash(c, o)))) {
          return duplicate;
        }
        candidates.forEach((row) => rows.push(row));
        return { data: candidates, error: null };
      }
      if (mode === "upsert") {
        // Como PostgREST: si hay una fila que coincide en las columnas de
        // onConflict, se actualiza; si no, se inserta. `undefined` no pisa,
        // igual que en la base (connected_at: undefined es "no lo toques").
        const list = (Array.isArray(payload) ? payload : [payload]) as Row[];
        const result: Row[] = [];
        for (const values of list) {
          const defined = Object.fromEntries(
            Object.entries(values).filter(([, v]) => v !== undefined),
          ) as Row;
          const existing = conflictCols.length
            ? rows.find((r) => conflictCols.every((col) => r[col] === values[col]))
            : undefined;
          if (existing) {
            Object.assign(existing, defined);
            result.push(existing);
          } else {
            const row = { id: newId(table), created_at: clock().toISOString(), ...defined } as Row;
            rows.push(row);
            result.push(row);
          }
        }
        return { data: result, error: null };
      }
      let matched = rows.filter((r) => filters.every((f) => f(r)));
      if (mode === "update") {
        if (clash) {
          const after = matched.map((r) => ({ ...r, ...(payload as Row) }));
          const others = rows.filter((r) => !matched.includes(r));
          if (after.some((a, i) => others.some((o) => clash(a, o)) || after.some((o, j) => j !== i && clash(a, o)))) {
            return duplicate;
          }
        }
        matched.forEach((r) => Object.assign(r, payload));
        return { data: matched, error: null };
      }
      if (mode === "delete") {
        tables[table] = rows.filter((r) => !matched.includes(r));
        return { data: matched, error: null };
      }
      if (orderBy) {
        const { col, asc } = orderBy;
        matched = [...matched].sort((a, b) => (asc ? cmp(a[col], b[col]) : cmp(b[col], a[col])));
      }
      const count = matched.length;
      if (limitN !== null) matched = matched.slice(0, limitN);
      if (selectCols && options.joins) {
        matched = matched.map((r) => {
          const extra: Row = {};
          for (const [key, resolve] of Object.entries(options.joins!)) {
            const [t, rel] = key.split(".");
            if (t === table && selectCols!.includes(rel)) extra[rel] = resolve(r, db);
          }
          return { ...r, ...extra };
        });
      }
      if (countMode && head) return { data: null, error: null, count };
      return { data: matched, error: null, count };
    };

    const b: Record<string, unknown> = {
      select: (cols?: string, opts?: { count?: string; head?: boolean }) => {
        selectCols = cols ?? "*";
        if (opts?.count) countMode = true;
        if (opts?.head) head = true;
        return b;
      },
      insert: (values: Row | Row[]) => {
        mode = "insert";
        payload = values;
        return b;
      },
      upsert: (values: Row | Row[], opts?: { onConflict?: string }) => {
        mode = "upsert";
        payload = values;
        conflictCols = (opts?.onConflict ?? "").split(",").map((c) => c.trim()).filter(Boolean);
        return b;
      },
      update: (values: Row) => {
        mode = "update";
        payload = values;
        return b;
      },
      delete: () => {
        mode = "delete";
        return b;
      },
      // Un filtro sobre una relacion embebida ("flows.status") no se simula: pasa.
      eq: (col: string, val: unknown) => (filters.push((r) => col.includes(".") || r[col] === val), b),
      // .or() de PostgREST tampoco se simula: pasa todo.
      or: () => b,
      neq: (col: string, val: unknown) => (filters.push((r) => r[col] !== val), b),
      is: (col: string, val: unknown) => (filters.push((r) => (r[col] ?? null) === val), b),
      not: (col: string, op: string, val: unknown) => {
        if (op === "is") filters.push((r) => (r[col] ?? null) !== val);
        return b;
      },
      in: (col: string, vals: unknown[]) => (filters.push((r) => vals.includes(r[col])), b),
      gt: (col: string, val: unknown) => (filters.push((r) => r[col] != null && cmp(r[col], val) > 0), b),
      gte: (col: string, val: unknown) => (filters.push((r) => r[col] != null && cmp(r[col], val) >= 0), b),
      lt: (col: string, val: unknown) => (filters.push((r) => r[col] != null && cmp(r[col], val) < 0), b),
      lte: (col: string, val: unknown) => (filters.push((r) => r[col] != null && cmp(r[col], val) <= 0), b),
      contains: (col: string, val: Row) =>
        (filters.push((r) => Object.entries(val).every(([k, v]) => (r[col] as Row | undefined)?.[k] === v)), b),
      order: (col: string, opts?: { ascending?: boolean }) => ((orderBy = { col, asc: opts?.ascending !== false }), b),
      limit: (n: number) => ((limitN = n), b),
      single: async () => {
        const res = apply();
        const list = res.data as Row[];
        if (res.error) return { data: null, error: res.error };
        return list?.length === 1 ? { data: list[0], error: null } : { data: null, error: { message: "no single row" } };
      },
      maybeSingle: async () => {
        const res = apply();
        if (res.error) return { data: null, error: res.error };
        const list = (res.data as Row[]) ?? [];
        return { data: list[0] ?? null, error: null };
      },
      then: (resolve: (v: unknown) => unknown, reject?: (e: unknown) => unknown) => {
        try {
          return Promise.resolve(apply()).then(resolve, reject);
        } catch (err) {
          return reject ? reject(err) : Promise.reject(err);
        }
      },
    };
    return b;
  }

  db.client = {
    from: (table: string) => builder(table),
    rpc: async (name: string, args: Record<string, unknown>) => {
      rpcCalls.push({ name, args });
      const handler = options.rpc?.[name];
      if (!handler) return { data: null, error: { message: `rpc ${name} no simulada` } };
      try {
        return { data: await handler(args, db), error: null };
      } catch (err) {
        return { data: null, error: { message: err instanceof Error ? err.message : String(err) } };
      }
    },
  } as unknown as SupabaseClient<Database>;

  return db;
}
