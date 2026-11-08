/**
 * Una base de datos EN MEMORIA para probar las operaciones del editor con lo que de verdad hace la base:
 * `UPDATE … WHERE rev = $rev` que no toca nada si la `rev` cambió, filas que se guardan y se leen, borrados.
 *
 * Solo implementa lo que usan `designs-core` y `designs-ops` (select, insert, update, delete, eq, is, order, limit,
 * maybeSingle, single y el conteo con `head`). No es una base: sirve para comprobar el COMPORTAMIENTO de las
 * operaciones, no la sintaxis de las consultas.
 *
 * Solo para tests.
 */

export type Row = Record<string, unknown>;

interface Filter {
  column: string;
  kind: "eq" | "is";
  value: unknown;
}

export interface MemoryDb {
  client: any;
  tables: Record<string, Row[]>;
  /** Cada escritura, en orden: para comprobar qué se escribió. */
  log: Array<{ table: string; op: "insert" | "update" | "delete"; values?: Row }>;
  /** Cada tabla que se tocó (lectura o escritura): para comprobar que NO se tocó la cola de jobs. */
  touched: Set<string>;
  /** Falla la próxima escritura a esa tabla con ese error. */
  failNext(table: string, error?: { code?: string; message: string }): void;
}

export function memoryDb(initial: Record<string, Row[]> = {}, clock: () => Date = () => new Date()): MemoryDb {
  const tables: Record<string, Row[]> = {};
  for (const [name, rows] of Object.entries(initial)) tables[name] = rows.map((r) => ({ ...r }));
  const log: MemoryDb["log"] = [];
  const touched = new Set<string>();
  const failures = new Map<string, { code?: string; message: string }>();
  let counter = 0;

  function builder(table: string) {
    touched.add(table);
    tables[table] ??= [];
    const state = {
      op: "select" as "select" | "insert" | "update" | "delete",
      values: undefined as Row | undefined,
      filters: [] as Filter[],
      order: null as { column: string; ascending: boolean } | null,
      limit: null as number | null,
      count: false,
      head: false,
      returning: false,
    };

    const matches = (row: Row) =>
      state.filters.every((f) => (f.kind === "is" ? (row[f.column] ?? null) === f.value : row[f.column] === f.value));

    function run(): { data: unknown; error: { code?: string; message: string } | null; count: number | null } {
      if (state.op !== "select") {
        const failure = failures.get(table);
        if (failure) {
          failures.delete(table);
          return { data: null, error: failure, count: null };
        }
      }
      if (state.op === "insert") {
        const row: Row = { id: `${table}-${++counter}`, created_at: clock().toISOString(), ...(state.values ?? {}) };
        tables[table].push(row);
        log.push({ table, op: "insert", values: state.values });
        return { data: state.returning ? [row] : null, error: null, count: null };
      }
      let rows = tables[table].filter(matches);
      if (state.op === "update") {
        for (const row of rows) Object.assign(row, state.values);
        log.push({ table, op: "update", values: state.values });
        return { data: state.returning ? rows.map((r) => ({ ...r })) : null, error: null, count: null };
      }
      if (state.op === "delete") {
        tables[table] = tables[table].filter((r) => !rows.includes(r));
        log.push({ table, op: "delete" });
        return { data: null, error: null, count: null };
      }
      if (state.order) {
        const { column, ascending } = state.order;
        rows = [...rows].sort((a, b) => (String(a[column]) < String(b[column]) ? -1 : String(a[column]) > String(b[column]) ? 1 : 0) * (ascending ? 1 : -1));
      }
      const count = state.count ? rows.length : null;
      if (state.head) return { data: null, error: null, count };
      if (state.limit !== null) rows = rows.slice(0, state.limit);
      return { data: rows.map((r) => ({ ...r })), error: null, count };
    }

    const single = (required: boolean) => {
      const result = run();
      const rows = Array.isArray(result.data) ? result.data : [];
      return Promise.resolve({ data: rows[0] ?? null, error: result.error ?? (required && rows.length === 0 ? { message: "sin filas" } : null), count: result.count });
    };

    const b: Record<string, unknown> = {
      select: (_columns?: string, options?: { count?: string; head?: boolean }) => {
        if (state.op === "insert" || state.op === "update") state.returning = true;
        if (options?.count) state.count = true;
        if (options?.head) state.head = true;
        return b;
      },
      insert: (values: Row) => ((state.op = "insert"), (state.values = values), b),
      update: (values: Row) => ((state.op = "update"), (state.values = values), b),
      delete: () => ((state.op = "delete"), b),
      eq: (column: string, value: unknown) => (state.filters.push({ column, kind: "eq", value }), b),
      is: (column: string, value: unknown) => (state.filters.push({ column, kind: "is", value }), b),
      order: (column: string, options?: { ascending?: boolean }) => ((state.order = { column, ascending: options?.ascending ?? true }), b),
      limit: (n: number) => ((state.limit = n), b),
      maybeSingle: () => single(false),
      single: () => single(true),
      then: (ok: (v: unknown) => unknown, bad?: (e: unknown) => unknown) => Promise.resolve(run()).then(ok, bad),
    };
    return b;
  }

  return {
    client: { from: (table: string) => builder(table) },
    tables,
    log,
    touched,
    failNext: (table, error = { message: "falló" }) => failures.set(table, error),
  };
}
